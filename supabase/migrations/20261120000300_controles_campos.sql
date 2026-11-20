-- =====================================================================
-- Controles: campos solicitados (20-nov-2026)
-- ID, Control, Descripción, Responsable, Tipo, Clase, Periodicidad,
-- Documentación, Evidencia, Diseño, Aplicación, Efectividad, Estado.
--   ID → code · Control → name · Tipo → control_type · Clase → nature
--   Periodicidad → frequency · Estado → implementation_status
--   Diseño / Aplicación / Efectividad → *_rating (1 Débil, 2 Moderado, 3 Fuerte)
-- Responsable: usuario de la plataforma (owner_id) o texto (owner_text)
-- cuando la persona aún no es usuaria.
-- =====================================================================

alter table public.controls
  add column documentation text check (documentation in ('documentado', 'sin_documentar')),
  add column evidence text check (evidence in ('con_registro', 'sin_registro')),
  add column application_rating smallint check (application_rating between 1 and 3),
  add column owner_text text check (owner_text is null or length(owner_text) <= 120);

-- ---------------------------------------------------------------------
-- Importación masiva de controles con cálculo de diferencias (por ID)
-- ---------------------------------------------------------------------
create or replace function public.import_controls(p_fields text[], p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org        uuid := app.current_org_id();
  v_allowed    text[] := array['name','description','owner_id','owner_text','control_type','nature','frequency',
                               'documentation','evidence','design_rating','application_rating',
                               'effectiveness_rating','implementation_status'];
  r            jsonb;
  v_old        jsonb;
  v_changes    jsonb;
  f            text;
  n_created    int := 0;
  n_updated    int := 0;
  n_unchanged  int := 0;
  v_created    jsonb := '[]'::jsonb;
  v_updated    jsonb := '[]'::jsonb;
  v_missing    jsonb;
  n_missing    int;
  v_dupes      text;
begin
  if v_org is null or not app.has_permission('controls.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then
    raise exception 'El archivo debe tener entre 1 y 3.000 controles' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_fields) x where x <> all (v_allowed)) then
    raise exception 'Columnas no permitidas' using errcode = '22023';
  end if;
  select string_agg(code, ', ') into v_dupes from (
    select e ->> 'code' as code from jsonb_array_elements(p_rows) e group by 1 having count(*) > 1 limit 20) d;
  if v_dupes is not null then
    raise exception 'ID repetidos en el archivo: %', v_dupes using errcode = '22023';
  end if;

  for r in select e from jsonb_array_elements(p_rows) e loop
    if coalesce(trim(r ->> 'code'), '') = '' then
      raise exception 'Hay controles sin ID' using errcode = '22023';
    end if;
    select to_jsonb(c) into v_old from public.controls c where c.organization_id = v_org and c.code = r ->> 'code';

    if v_old is null then
      n_created := n_created + 1;
      if n_created <= 500 then v_created := v_created || to_jsonb(r ->> 'code'); end if;
      if p_apply then
        insert into public.controls (organization_id, code, name, description, owner_id, owner_text, control_type,
                                     nature, frequency, documentation, evidence, design_rating, application_rating,
                                     effectiveness_rating, implementation_status)
        select v_org, x.code, x.name, x.description, x.owner_id, x.owner_text,
               coalesce(x.control_type, 'preventivo'), coalesce(x.nature, 'manual'), coalesce(x.frequency, 'continuo'),
               x.documentation, x.evidence, x.design_rating, x.application_rating, x.effectiveness_rating,
               coalesce(x.implementation_status, 'planeado')
          from jsonb_populate_record(null::public.controls, r) x;
      end if;
    else
      v_changes := '{}'::jsonb;
      foreach f in array p_fields loop
        if f = 'name' and coalesce(trim(r ->> 'name'), '') = '' then continue; end if;
        if (v_old -> f) is distinct from coalesce(r -> f, 'null'::jsonb)
           and not (coalesce(v_old -> f, 'null'::jsonb) = 'null'::jsonb and coalesce(r -> f, 'null'::jsonb) = 'null'::jsonb) then
          v_changes := v_changes || jsonb_build_object(f, jsonb_build_object('antes', v_old -> f, 'ahora', r -> f));
        end if;
      end loop;
      if v_changes = '{}'::jsonb then
        n_unchanged := n_unchanged + 1;
      else
        n_updated := n_updated + 1;
        if n_updated <= 500 then
          v_updated := v_updated || jsonb_build_object('code', r ->> 'code', 'cambios', v_changes);
        end if;
        if p_apply then
          update public.controls c set
            name                  = case when v_changes ? 'name' then x.name else c.name end,
            description           = case when v_changes ? 'description' then x.description else c.description end,
            owner_id              = case when v_changes ? 'owner_id' then x.owner_id else c.owner_id end,
            owner_text            = case when v_changes ? 'owner_text' then x.owner_text else c.owner_text end,
            control_type          = case when v_changes ? 'control_type' then coalesce(x.control_type, c.control_type) else c.control_type end,
            nature                = case when v_changes ? 'nature' then coalesce(x.nature, c.nature) else c.nature end,
            frequency             = case when v_changes ? 'frequency' then coalesce(x.frequency, c.frequency) else c.frequency end,
            documentation         = case when v_changes ? 'documentation' then x.documentation else c.documentation end,
            evidence              = case when v_changes ? 'evidence' then x.evidence else c.evidence end,
            design_rating         = case when v_changes ? 'design_rating' then x.design_rating else c.design_rating end,
            application_rating    = case when v_changes ? 'application_rating' then x.application_rating else c.application_rating end,
            effectiveness_rating  = case when v_changes ? 'effectiveness_rating' then x.effectiveness_rating else c.effectiveness_rating end,
            implementation_status = case when v_changes ? 'implementation_status' then coalesce(x.implementation_status, c.implementation_status) else c.implementation_status end
          from jsonb_populate_record(null::public.controls, r) x
          where c.organization_id = v_org and c.code = r ->> 'code';
        end if;
      end if;
    end if;
  end loop;

  select count(*)::int, coalesce(jsonb_agg(code) filter (where rn <= 500), '[]'::jsonb)
    into n_missing, v_missing
    from (select c.code, row_number() over (order by c.code) rn
            from public.controls c
           where c.organization_id = v_org and c.active
             and not exists (select 1 from jsonb_array_elements(p_rows) e where e ->> 'code' = c.code)) m;

  return jsonb_build_object(
    'import_id', null,
    'total', jsonb_array_length(p_rows),
    'nuevos', n_created, 'modificados', n_updated, 'sin_cambios', n_unchanged, 'ausentes', n_missing,
    'lista_nuevos', v_created, 'lista_modificados', v_updated, 'lista_ausentes', v_missing);
end;
$$;
revoke execute on function public.import_controls(text[], jsonb, boolean) from public, anon;
grant execute on function public.import_controls(text[], jsonb, boolean) to authenticated;
