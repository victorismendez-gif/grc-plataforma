-- =====================================================================
-- Responsable editable y Proceso en todo el sistema (20-nov-2026)
--  * Responsable: usuario de la plataforma (…_id) o texto libre (…_text).
--  * Proceso: activos, controles y documentos enlazan a un proceso del
--    catálogo; si se escribe uno nuevo, ensure_process() lo crea.
-- =====================================================================

alter table public.assets
  add column owner_text text check (owner_text is null or length(owner_text) <= 120),
  add column process_id uuid;
alter table public.assets
  add constraint assets_process_fkey foreign key (organization_id, process_id)
  references public.processes(organization_id, id) on delete set null (process_id);
create index assets_process_idx on public.assets(organization_id, process_id);
grant update (owner_text, process_id) on public.assets to authenticated;

alter table public.processes add column owner_text text check (owner_text is null or length(owner_text) <= 120);
alter table public.org_units add column manager_text text check (manager_text is null or length(manager_text) <= 120);
alter table public.documents add column owner_text text check (owner_text is null or length(owner_text) <= 120);
grant update (owner_text) on public.documents to authenticated;

-- El proceso principal de los activos ya registrados viene de asset_processes
update public.assets a
   set process_id = (select ap.process_id from public.asset_processes ap where ap.asset_id = a.id limit 1)
 where a.process_id is null;

-- ---------------------------------------------------------------------
-- Busca un proceso por nombre o código; si no existe, lo crea.
-- Lo puede usar quien escribe activos, controles o documentos.
-- ---------------------------------------------------------------------
create or replace function public.ensure_process(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid := app.current_org_id();
  v_name text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 160);
  v_id   uuid;
begin
  if v_org is null or not (app.has_permission('assets.write') or app.has_permission('controls.write')
                           or app.has_permission('documents.write')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_name) < 2 then
    raise exception 'El nombre del proceso debe tener al menos 2 caracteres' using errcode = '22023';
  end if;
  select p.id into v_id from public.processes p
   where p.organization_id = v_org and (lower(p.name) = lower(v_name) or lower(p.code) = lower(v_name))
   order by p.active desc limit 1;
  if v_id is null then
    insert into public.processes (organization_id, name) values (v_org, v_name) returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.ensure_process(text) from public, anon;
grant execute on function public.ensure_process(text) to authenticated;

-- ---------------------------------------------------------------------
-- Importaciones con responsable en texto y proceso
-- ---------------------------------------------------------------------
create or replace function public.import_assets(p_file_name text, p_fields text[], p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org        uuid := app.current_org_id();
  v_allowed    text[] := array['name','asset_type_id','description','owner_id','custodian','unit_id','location',
                               'classification_id','confidentiality','integrity','availability','status','brand',
                               'model','serial_number','acquired_on','attributes','ip_address','operating_system',
                               'custodian_email','owner_text','process_id'];
  v_import     uuid := gen_random_uuid();
  r            jsonb;
  v_old        jsonb;
  v_changes    jsonb;
  v_code       text;
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
  if v_org is null or not app.has_permission('assets.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'El archivo debe tener entre 1 y 5.000 filas' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_fields) x where x <> all (v_allowed)) then
    raise exception 'Columnas no permitidas' using errcode = '22023';
  end if;
  select string_agg(code, ', ') into v_dupes from (
    select e ->> 'code' as code from jsonb_array_elements(p_rows) e
     where coalesce(trim(e ->> 'code'), '') <> ''
     group by 1 having count(*) > 1 limit 20) d;
  if v_dupes is not null then
    raise exception 'Identificadores repetidos en el archivo: %', v_dupes using errcode = '22023';
  end if;

  for r in select e from jsonb_array_elements(p_rows) e loop
    v_old := null;
    if coalesce(trim(r ->> 'code'), '') <> '' then
      select to_jsonb(a) into v_old from public.assets a where a.organization_id = v_org and a.code = r ->> 'code';
    end if;

    if v_old is null then
      n_created := n_created + 1;
      v_code := nullif(trim(coalesce(r ->> 'code', '')), '');
      if p_apply then
        insert into public.assets (organization_id, code, name, asset_type_id, description, owner_id, custodian,
                                   unit_id, location, classification_id, confidentiality, integrity, availability,
                                   status, brand, model, serial_number, acquired_on, attributes, last_import_id,
                                   ip_address, operating_system, custodian_email,
                                   owner_text, process_id)
        select v_org, x.code, x.name, x.asset_type_id, x.description, x.owner_id,
               x.custodian, x.unit_id, x.location, x.classification_id, x.confidentiality, x.integrity,
               x.availability, coalesce(x.status, 'activo'), x.brand, x.model, x.serial_number, x.acquired_on,
               coalesce(x.attributes, '{}'::jsonb), v_import, x.ip_address, x.operating_system, x.custodian_email,
               x.owner_text, x.process_id
          from jsonb_populate_record(null::public.assets, r) x
        returning code into v_code;
      end if;
      if n_created <= 500 then v_created := v_created || to_jsonb(coalesce(v_code, '(número automático)')); end if;
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
          update public.assets a set
            name              = case when v_changes ? 'name' then x.name else a.name end,
            asset_type_id     = case when v_changes ? 'asset_type_id' then x.asset_type_id else a.asset_type_id end,
            description       = case when v_changes ? 'description' then x.description else a.description end,
            owner_id          = case when v_changes ? 'owner_id' then x.owner_id else a.owner_id end,
            custodian         = case when v_changes ? 'custodian' then x.custodian else a.custodian end,
            unit_id           = case when v_changes ? 'unit_id' then x.unit_id else a.unit_id end,
            location          = case when v_changes ? 'location' then x.location else a.location end,
            classification_id = case when v_changes ? 'classification_id' then x.classification_id else a.classification_id end,
            confidentiality   = case when v_changes ? 'confidentiality' then x.confidentiality else a.confidentiality end,
            integrity         = case when v_changes ? 'integrity' then x.integrity else a.integrity end,
            availability      = case when v_changes ? 'availability' then x.availability else a.availability end,
            status            = case when v_changes ? 'status' then coalesce(x.status, a.status) else a.status end,
            brand             = case when v_changes ? 'brand' then x.brand else a.brand end,
            model             = case when v_changes ? 'model' then x.model else a.model end,
            serial_number     = case when v_changes ? 'serial_number' then x.serial_number else a.serial_number end,
            acquired_on       = case when v_changes ? 'acquired_on' then x.acquired_on else a.acquired_on end,
            attributes        = case when v_changes ? 'attributes' then coalesce(x.attributes, '{}'::jsonb) else a.attributes end,
            ip_address        = case when v_changes ? 'ip_address' then x.ip_address else a.ip_address end,
            operating_system  = case when v_changes ? 'operating_system' then x.operating_system else a.operating_system end,
            custodian_email   = case when v_changes ? 'custodian_email' then x.custodian_email else a.custodian_email end,
            owner_text        = case when v_changes ? 'owner_text' then x.owner_text else a.owner_text end,
            process_id        = case when v_changes ? 'process_id' then x.process_id else a.process_id end,
            last_import_id    = v_import
          from jsonb_populate_record(null::public.assets, r) x
          where a.organization_id = v_org and a.code = r ->> 'code';
        end if;
      end if;
    end if;
  end loop;

  select count(*)::int, coalesce(jsonb_agg(code) filter (where rn <= 500), '[]'::jsonb)
    into n_missing, v_missing
    from (select a.code, row_number() over (order by a.code) rn
            from public.assets a
           where a.organization_id = v_org and a.status <> 'dado_de_baja'
             and not exists (select 1 from jsonb_array_elements(p_rows) e where e ->> 'code' = a.code)
             and (a.last_import_id is null or a.last_import_id <> v_import)) m;

  if p_apply then
    insert into public.asset_imports (id, organization_id, file_name, imported_by, total_rows, created_count,
                                      updated_count, unchanged_count, missing_count, details)
    values (v_import, v_org, left(coalesce(p_file_name, 'archivo'), 200), auth.uid(), jsonb_array_length(p_rows),
            n_created, n_updated, n_unchanged, n_missing,
            jsonb_build_object('nuevos', v_created, 'modificados', v_updated, 'ausentes', v_missing, 'columnas', to_jsonb(p_fields)));
  end if;

  return jsonb_build_object(
    'import_id', case when p_apply then v_import end,
    'total', jsonb_array_length(p_rows),
    'nuevos', n_created, 'modificados', n_updated, 'sin_cambios', n_unchanged, 'ausentes', n_missing,
    'lista_nuevos', v_created, 'lista_modificados', v_updated, 'lista_ausentes', v_missing);
end;
$$;
revoke execute on function public.import_assets(text, text[], jsonb, boolean) from public, anon;
grant execute on function public.import_assets(text, text[], jsonb, boolean) to authenticated;

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
                               'effectiveness_rating','implementation_status','process_id'];
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
                                     effectiveness_rating, implementation_status, process_id)
        select v_org, x.code, x.name, x.description, x.owner_id, x.owner_text,
               coalesce(x.control_type, 'preventivo'), coalesce(x.nature, 'manual'), coalesce(x.frequency, 'continuo'),
               x.documentation, x.evidence, x.design_rating, x.application_rating, x.effectiveness_rating,
               coalesce(x.implementation_status, 'planeado'), x.process_id
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
            implementation_status = case when v_changes ? 'implementation_status' then coalesce(x.implementation_status, c.implementation_status) else c.implementation_status end,
            process_id            = case when v_changes ? 'process_id' then x.process_id else c.process_id end
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
