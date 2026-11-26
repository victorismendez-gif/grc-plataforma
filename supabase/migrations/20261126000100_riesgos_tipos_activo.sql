-- Escenarios de riesgo ↔ tipos de activo (varios por escenario).
-- La ficha de cada activo muestra los escenarios de su tipo, y la plantilla de
-- riesgos trae la columna «Tipo de activo» (varios separados por «;»).

create table public.risk_entry_asset_types (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  entry_id         uuid not null,
  asset_type_id    uuid not null,
  unique (entry_id, asset_type_id),
  foreign key (organization_id, entry_id) references public.risk_entries(organization_id, id) on delete cascade,
  foreign key (organization_id, asset_type_id) references public.catalog_items(organization_id, id) on delete cascade
);
create index risk_entry_asset_types_type_idx on public.risk_entry_asset_types(organization_id, asset_type_id);

-- Solo ítems del catálogo de tipos de activo
create or replace function app.risk_entry_asset_types_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.catalog_items c
                  where c.id = new.asset_type_id and c.organization_id = new.organization_id and c.catalog = 'asset_type') then
    raise exception 'El tipo de activo no existe' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function app.risk_entry_asset_types_check() from public, anon;
create trigger risk_entry_asset_types_check before insert on public.risk_entry_asset_types
  for each row execute function app.risk_entry_asset_types_check();

-- El campo único anterior pasa a la tabla de vínculos
insert into public.risk_entry_asset_types (organization_id, entry_id, asset_type_id)
select e.organization_id, e.id, e.asset_type_id
  from public.risk_entries e
  join public.catalog_items c on c.id = e.asset_type_id and c.catalog = 'asset_type'
 where e.asset_type_id is not null
on conflict do nothing;

alter table public.risk_entry_asset_types enable row level security;
revoke all on public.risk_entry_asset_types from anon;
revoke truncate, update on public.risk_entry_asset_types from authenticated;
create policy risk_entry_asset_types_select on public.risk_entry_asset_types for select to authenticated
  using (organization_id = (select app.current_org_id())
         and ((select app.has_permission('risks.read')) or (select app.has_permission('assets.read'))));
create policy risk_entry_asset_types_insert on public.risk_entry_asset_types for insert to authenticated
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('risks.write')));
create policy risk_entry_asset_types_delete on public.risk_entry_asset_types for delete to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('risks.write')));
create trigger risk_entry_asset_types_audit after insert or update or delete on public.risk_entry_asset_types
  for each row execute function app.audit_trigger();

-- Carga desde Excel: columna «Tipo de activo». Se ejecuta como definer porque
-- validar RLS fila a fila con cientos de vínculos excede el límite de 8 s; la
-- función verifica organización y permiso al inicio y filtra por organization_id.
create or replace function public.risk_import(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid := app.current_org_id();
  r         jsonb;
  v_line    int := 0;
  v_errors  jsonb := '[]'::jsonb;
  v_new     int := 0;
  v_upd     int := 0;
  v_same    int := 0;
  v_eval    int := 0;
  v_risk    uuid;
  v_cause   uuid;
  v_cat     uuid;
  v_factor  uuid;
  v_proc    uuid;
  v_entry   public.risk_entries;
  v_key     text;
  v_ctrls   uuid[];
  v_missing text[];
  v_types   uuid[];
  v_old_types uuid[];
  v_changed boolean;
  m         public.risk_methodologies;
  v_p       int;
  v_i       int;
begin
  if v_org is null or not app.has_permission('risks.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'El archivo debe tener entre 1 y 5.000 filas' using errcode = '22023';
  end if;
  m := public.risk_methodology_current();

  for r in select e from jsonb_array_elements(p_rows) e loop
    v_line := coalesce((r ->> 'line')::int, v_line + 1);
    v_entry := null;
    v_p := nullif(r ->> 'probability', '')::int;
    v_i := nullif(r ->> 'impact', '')::int;
    if (v_p is null) <> (v_i is null) then
      v_errors := v_errors || to_jsonb(format('Fila %s: indica probabilidad e impacto juntos.', v_line));
      continue;
    end if;
    if v_p is not null and (v_p > jsonb_array_length(m.probability_levels) or v_i > jsonb_array_length(m.impact_levels) or v_p < 1 or v_i < 1) then
      v_errors := v_errors || to_jsonb(format('Fila %s: probabilidad o impacto fuera de la escala vigente.', v_line));
      continue;
    end if;

    -- Registro existente por código RG-…
    if coalesce(r ->> 'code', '') <> '' then
      select * into v_entry from public.risk_entries where organization_id = v_org and code = r ->> 'code';
      if v_entry.id is null then
        v_errors := v_errors || to_jsonb(format('Fila %s: el código %s no existe en el registro.', v_line, r ->> 'code'));
        continue;
      end if;
    end if;

    if v_entry.id is null then
      if coalesce(r ->> 'risk_code', '') = '' then
        v_errors := v_errors || to_jsonb(format('Fila %s: falta el código del riesgo.', v_line));
        continue;
      end if;
      select id into v_risk from public.risks where organization_id = v_org and lower(code) = lower(r ->> 'risk_code');
      if v_risk is null and coalesce(r ->> 'risk_name', '') = '' then
        v_errors := v_errors || to_jsonb(format('Fila %s: el riesgo %s no existe; incluye su descripción para crearlo.', v_line, r ->> 'risk_code'));
        continue;
      end if;
      if coalesce(r ->> 'cause_code', '') <> '' then
        select id into v_cause from public.risk_causes where organization_id = v_org and lower(code) = lower(r ->> 'cause_code');
        if v_cause is null and coalesce(r ->> 'cause', '') = '' then
          v_errors := v_errors || to_jsonb(format('Fila %s: la causa %s no existe; incluye su descripción.', v_line, r ->> 'cause_code'));
          continue;
        end if;
      else
        v_cause := null;
      end if;
    end if;

    -- Controles: todos deben existir
    select array_agg(c.id), array_agg(x) filter (where c.id is null)
      into v_ctrls, v_missing
      from jsonb_array_elements_text(coalesce(r -> 'controls', '[]'::jsonb)) x
      left join public.controls c on c.organization_id = v_org and lower(c.code) = lower(x);
    if v_missing is not null then
      v_errors := v_errors || to_jsonb(format('Fila %s: controles que no existen: %s.', v_line, array_to_string(v_missing, ', ')));
      continue;
    end if;

    -- Tipos de activo: todos deben existir en el catálogo
    v_types := null;
    if jsonb_array_length(coalesce(r -> 'asset_types', '[]'::jsonb)) > 0 then
      select array_agg(distinct ci.id order by ci.id), array_agg(x) filter (where ci.id is null)
        into v_types, v_missing
        from jsonb_array_elements_text(r -> 'asset_types') x
        left join public.catalog_items ci on ci.organization_id = v_org and ci.catalog = 'asset_type' and ci.code = x;
      if v_missing is not null then
        v_errors := v_errors || to_jsonb(format('Fila %s: tipos de activo que no existen: %s.', v_line, array_to_string(v_missing, ', ')));
        continue;
      end if;
    end if;

    if not p_apply then
      -- vista previa: cuenta nuevos o existentes sin escribir
      if v_entry.id is null then
        v_key := lower(concat_ws('|', r ->> 'risk_code', r ->> 'cause_code', r ->> 'category', r ->> 'event'));
        if exists (select 1 from public.risk_entries where organization_id = v_org and natural_key = v_key) then v_upd := v_upd + 1;
        else v_new := v_new + 1; end if;
      else
        v_upd := v_upd + 1;
      end if;
      if v_p is not null then v_eval := v_eval + 1; end if;
      continue;
    end if;

    -- Escritura
    if v_entry.id is null then
      if v_risk is null then
        insert into public.risks (organization_id, code, name, dimension)
        values (v_org, trim(r ->> 'risk_code'), left(trim(r ->> 'risk_name'), 500), nullif(r ->> 'dimension', ''))
        returning id into v_risk;
      end if;
      if coalesce(r ->> 'factor', '') <> '' then
        select id into v_factor from public.risk_factors where organization_id = v_org and lower(name) = lower(trim(r ->> 'factor'));
        if v_factor is null then
          insert into public.risk_factors (organization_id, name) values (v_org, left(trim(r ->> 'factor'), 160)) returning id into v_factor;
        end if;
      else
        v_factor := null;
      end if;
      if v_cause is null and coalesce(r ->> 'cause_code', '') <> '' then
        insert into public.risk_causes (organization_id, code, description, factor_id)
        values (v_org, trim(r ->> 'cause_code'), left(trim(r ->> 'cause'), 1000), v_factor)
        returning id into v_cause;
      end if;
      if coalesce(r ->> 'category', '') <> '' then
        select id into v_cat from public.risk_categories where organization_id = v_org and lower(name) = lower(trim(r ->> 'category'));
        if v_cat is null then
          insert into public.risk_categories (organization_id, name) values (v_org, left(trim(r ->> 'category'), 160)) returning id into v_cat;
        end if;
      else
        v_cat := null;
      end if;
      v_key := lower(concat_ws('|', r ->> 'risk_code', r ->> 'cause_code', r ->> 'category', r ->> 'event'));
      select * into v_entry from public.risk_entries where organization_id = v_org and natural_key = v_key;
    end if;

    v_proc := null;
    if coalesce(r ->> 'process', '') <> '' then
      v_proc := public.ensure_process(r ->> 'process');
    end if;

    if v_entry.id is null then
      insert into public.risk_entries (organization_id, natural_key, risk_id, cause_id, category_id, threat_event,
                                       treatment_strategy, treatment_description, process_id)
      values (v_org, v_key, v_risk, v_cause, v_cat, nullif(r ->> 'event', ''),
              nullif(r ->> 'strategy', ''), nullif(r ->> 'treatment', ''), v_proc)
      returning * into v_entry;
      v_new := v_new + 1;
    else
      v_changed := (v_entry.threat_event, v_entry.treatment_strategy, v_entry.treatment_description)
                   is distinct from (coalesce(nullif(r ->> 'event', ''), v_entry.threat_event),
                                     coalesce(nullif(r ->> 'strategy', ''), v_entry.treatment_strategy),
                                     coalesce(nullif(r ->> 'treatment', ''), v_entry.treatment_description))
                   or (v_proc is not null and v_proc is distinct from v_entry.process_id);
      update public.risk_entries
         set threat_event = coalesce(nullif(r ->> 'event', ''), threat_event),
             treatment_strategy = coalesce(nullif(r ->> 'strategy', ''), treatment_strategy),
             treatment_description = coalesce(nullif(r ->> 'treatment', ''), treatment_description),
             process_id = coalesce(v_proc, process_id)
       where id = v_entry.id;
      if v_types is not null then
        select array_agg(t.asset_type_id order by t.asset_type_id) into v_old_types
          from public.risk_entry_asset_types t where t.entry_id = v_entry.id;
        v_changed := v_changed or v_old_types is distinct from v_types;
      end if;
      if v_changed then v_upd := v_upd + 1; else v_same := v_same + 1; end if;
    end if;

    if v_types is not null then
      delete from public.risk_entry_asset_types where entry_id = v_entry.id and asset_type_id <> all (v_types);
      insert into public.risk_entry_asset_types (organization_id, entry_id, asset_type_id)
      select v_org, v_entry.id, unnest(v_types)
      on conflict (entry_id, asset_type_id) do nothing;
    end if;

    if r ? 'controls' and jsonb_array_length(r -> 'controls') > 0 then
      delete from public.risk_entry_controls where entry_id = v_entry.id and control_id <> all (v_ctrls);
      insert into public.risk_entry_controls (organization_id, entry_id, control_id)
      select v_org, v_entry.id, unnest(v_ctrls)
      on conflict (entry_id, control_id) do nothing;
    end if;

    if v_p is not null and (v_entry.inherent_probability, v_entry.inherent_impact, v_entry.methodology_id)
                           is distinct from (v_p, v_i, m.id) then
      perform public.risk_evaluate(v_entry.id, v_p, v_i);
      v_eval := v_eval + 1;
    end if;
  end loop;

  if p_apply and jsonb_array_length(v_errors) > 0 then
    raise exception 'El archivo tiene errores; no se aplicó ningún cambio' using errcode = '22023';
  end if;
  return jsonb_build_object('nuevos', v_new, 'actualizados', v_upd, 'sin_cambios', v_same, 'valorados', v_eval, 'errores', v_errors);
end;
$$;
revoke execute on function public.risk_import(jsonb, boolean) from public, anon;
grant execute on function public.risk_import(jsonb, boolean) to authenticated;
