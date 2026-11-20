-- =====================================================================
-- Ajustes al módulo de activos (solicitud del 20-nov-2026)
--  * Cada tipo de activo define su identificador único (placa, IMEI,
--    serial, documento de identidad o etiqueta) y los campos que muestra.
--  * Tipos sin identificador propio reciben un número aleatorio único.
--  * Valoración de confidencialidad, integridad y disponibilidad de 1 a 5,
--    con definiciones parametrizables por organización.
--  * Nuevos campos: IP y sistema operativo. Nombre del activo: máx. 80.
--  * Nuevo tipo de activo: Empleado (identificador: documento de identidad).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Activos: nuevos campos y escala 1-5
-- ---------------------------------------------------------------------
alter table public.assets
  add column ip_address inet,
  add column operating_system text check (operating_system is null or length(operating_system) <= 120);

alter table public.assets drop constraint assets_name_check;
alter table public.assets add constraint assets_name_check check (length(trim(name)) between 1 and 80);
alter table public.assets drop constraint assets_confidentiality_check;
alter table public.assets drop constraint assets_integrity_check;
alter table public.assets drop constraint assets_availability_check;
alter table public.assets
  add constraint assets_confidentiality_check check (confidentiality between 1 and 5),
  add constraint assets_integrity_check check (integrity between 1 and 5),
  add constraint assets_availability_check check (availability between 1 and 5);

grant update (ip_address, operating_system) on public.assets to authenticated;

-- ---------------------------------------------------------------------
-- Perfil de cada tipo de activo (en catalog_items.settings)
-- {
--   "identifier": {"kind": "placa|imei|serial|documento|etiqueta", "label": "Placa", "required": true},
--   "fields": ["name", "ip_address", "status", ...],   -- campos visibles, en orden
--   "name_label": "Nombre (hostname)"                    -- opcional
-- }
-- ---------------------------------------------------------------------
alter table public.catalog_items add column settings jsonb not null default '{}'::jsonb
  check (jsonb_typeof(settings) = 'object');
revoke update on public.catalog_items from authenticated;
grant update (label, active, settings, sort_order) on public.catalog_items to authenticated;

create or replace function app.default_asset_type_settings(p_code text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when p_code in ('portatil', 'escritorio') then
      '{"identifier":{"kind":"placa","label":"Placa","required":true},
        "fields":["name","status","brand","model","operating_system","serial_number","owner_id","custodian","location","acquired_on","description"]}'::jsonb
    when p_code in ('celular', 'tableta') then
      '{"identifier":{"kind":"imei","label":"IMEI","required":true},
        "fields":["status","brand","model","operating_system","serial_number","owner_id","custodian"]}'::jsonb
    when p_code = 'servidor' then
      '{"identifier":{"kind":"serial","label":"Serial","required":true},"name_label":"Nombre (hostname)",
        "fields":["name","ip_address","status","brand","model","operating_system","owner_id","custodian"]}'::jsonb
    when p_code = 'persona' then
      '{"identifier":{"kind":"documento","label":"Documento de identidad","required":true},"name_label":"Nombre completo",
        "fields":["name","status","owner_id","description"]}'::jsonb
    else
      '{"identifier":{"kind":"etiqueta","label":"Etiqueta o número","required":false},
        "fields":["name","status","owner_id","custodian","location","description"]}'::jsonb
  end
$$;

create or replace function app.seed_catalogs(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.catalog_items (organization_id, catalog, code, label, sort_order, settings)
  select p_org, v.catalog, v.code, v.label, v.sort_order,
         case when v.catalog = 'asset_type' then app.default_asset_type_settings(v.code) else '{}'::jsonb end
  from (values
    ('asset_type', 'portatil', 'Computador portátil', 10),
    ('asset_type', 'escritorio', 'Computador de escritorio', 20),
    ('asset_type', 'tableta', 'Tableta', 30),
    ('asset_type', 'celular', 'Celular', 40),
    ('asset_type', 'servidor', 'Servidor', 50),
    ('asset_type', 'persona', 'Empleado', 55),
    ('asset_type', 'repositorio', 'Repositorio', 60),
    ('asset_type', 'aplicacion', 'Software o aplicación', 70),
    ('asset_type', 'base_datos', 'Base de datos', 80),
    ('asset_type', 'nube', 'Servicio en la nube', 90),
    ('asset_type', 'red', 'Red y comunicaciones', 100),
    ('asset_type', 'informacion', 'Información o documento', 110),
    ('asset_type', 'instalacion', 'Instalación física', 120),
    ('asset_type', 'otro', 'Otro', 999),
    ('info_classification', 'publica', 'Pública', 10),
    ('info_classification', 'uso_interno', 'Uso Interno', 20),
    ('info_classification', 'confidencial', 'Confidencial', 30)
  ) as v(catalog, code, label, sort_order)
  on conflict (organization_id, catalog, code) do nothing
$$;

-- Organizaciones existentes: nuevo tipo Empleado y perfiles por defecto
do $$ begin perform app.seed_catalogs(id) from public.organizations; end $$;
update public.catalog_items
   set settings = app.default_asset_type_settings(code)
 where catalog = 'asset_type' and settings = '{}'::jsonb;
update public.catalog_items set label = 'Uso Interno'
 where catalog = 'info_classification' and code = 'uso_interno' and label = 'Uso interno';

-- ---------------------------------------------------------------------
-- Identificador único y nombre por defecto
-- ---------------------------------------------------------------------
create or replace function app.assets_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
  v_label    text;
  v_code     text;
  i          int := 0;
begin
  select c.settings, c.label into v_settings, v_label
    from public.catalog_items c
   where c.id = new.asset_type_id and c.organization_id = new.organization_id;

  new.code := nullif(trim(coalesce(new.code, '')), '');
  if new.code is null then
    if coalesce((v_settings -> 'identifier' ->> 'required')::boolean, false) then
      raise exception 'Falta el identificador del activo (%)', coalesce(v_settings -> 'identifier' ->> 'label', 'código')
        using errcode = '23502';
    end if;
    -- Número aleatorio único de 8 dígitos
    loop
      v_code := lpad(floor(random() * 100000000)::bigint::text, 8, '0');
      exit when not exists (select 1 from public.assets a where a.organization_id = new.organization_id and a.code = v_code);
      i := i + 1;
      if i > 50 then raise exception 'No se pudo generar un número único'; end if;
    end loop;
    new.code := v_code;
  end if;

  if coalesce(trim(new.name), '') = '' then
    new.name := left(trim(concat_ws(' ', v_label, new.brand, new.model)), 80);
    if new.name = '' then new.name := new.code; end if;
  end if;
  return new;
end;
$$;
create trigger assets_defaults before insert or update of code, name, asset_type_id on public.assets
  for each row execute function app.assets_defaults();
revoke execute on function app.assets_defaults() from public, anon;

-- ---------------------------------------------------------------------
-- Escala de valoración C-I-D (1 a 5) parametrizable
-- ---------------------------------------------------------------------
create table public.valuation_levels (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  dimension        text not null check (dimension in ('confidentiality', 'integrity', 'availability')),
  level            smallint not null check (level between 1 and 5),
  label            text not null check (length(trim(label)) between 1 and 60),
  description      text check (description is null or length(description) <= 1000),
  updated_at       timestamptz not null default now(),
  primary key (organization_id, dimension, level)
);

create or replace function app.seed_valuation_levels(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.valuation_levels (organization_id, dimension, level, label, description)
  values
    (p_org, 'confidentiality', 1, 'Muy bajo', 'Información pública: su divulgación no causa daño.'),
    (p_org, 'confidentiality', 2, 'Bajo', 'Información de uso interno: su divulgación causa molestias menores.'),
    (p_org, 'confidentiality', 3, 'Medio', 'Su divulgación afecta a un área o proceso.'),
    (p_org, 'confidentiality', 4, 'Alto', 'Información confidencial: su divulgación causa daño legal, financiero o reputacional significativo.'),
    (p_org, 'confidentiality', 5, 'Muy alto', 'Información crítica o datos personales sensibles: su divulgación causa daño grave.'),
    (p_org, 'integrity', 1, 'Muy bajo', 'Una alteración no afecta la operación.'),
    (p_org, 'integrity', 2, 'Bajo', 'Los errores son fáciles de detectar y corregir.'),
    (p_org, 'integrity', 3, 'Medio', 'Una alteración afecta los resultados de un proceso.'),
    (p_org, 'integrity', 4, 'Alto', 'Una alteración lleva a decisiones erróneas o incumplimientos.'),
    (p_org, 'integrity', 5, 'Muy alto', 'Una alteración causa daño grave a clientes, finanzas o cumplimiento legal.'),
    (p_org, 'availability', 1, 'Muy bajo', 'Puede estar fuera de servicio más de una semana sin impacto.'),
    (p_org, 'availability', 2, 'Bajo', 'Tolera estar fuera de servicio hasta una semana.'),
    (p_org, 'availability', 3, 'Medio', 'Tolera estar fuera de servicio hasta un día.'),
    (p_org, 'availability', 4, 'Alto', 'Tolera estar fuera de servicio solo algunas horas.'),
    (p_org, 'availability', 5, 'Muy alto', 'No tolera interrupciones: afecta la operación de inmediato.')
  on conflict do nothing
$$;
revoke execute on function app.seed_valuation_levels(uuid) from public, anon, authenticated;
do $$ begin perform app.seed_valuation_levels(id) from public.organizations; end $$;

create or replace function app.on_organization_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_system_roles(new.id);
  perform app.seed_catalogs(new.id);
  perform app.seed_valuation_levels(new.id);
  return null;
end;
$$;

alter table public.valuation_levels enable row level security;
revoke all on public.valuation_levels from anon;
revoke insert, delete, truncate, update on public.valuation_levels from authenticated;
grant update (label, description) on public.valuation_levels to authenticated;
create policy valuation_levels_select on public.valuation_levels for select to authenticated
  using (organization_id = (select app.current_org_id()));
create policy valuation_levels_update on public.valuation_levels for update to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('org.manage')))
  with check (organization_id = (select app.current_org_id()));
create trigger valuation_levels_touch before update on public.valuation_levels
  for each row execute function app.touch_updated_at();
create trigger valuation_levels_audit after insert or update or delete on public.valuation_levels
  for each row execute function app.audit_trigger();

-- Identificador legible en la traza para la escala
create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
  v_id  text;
begin
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return null; -- sin cambios reales
  end if;
  v_org := case when tg_table_name = 'organizations'
                then (v_row ->> 'id')::uuid
                else (v_row ->> 'organization_id')::uuid end;
  v_id := coalesce(
    v_row ->> 'id',
    case tg_table_name
      when 'role_permissions'      then (v_row ->> 'role_id') || ':' || (v_row ->> 'permission_code')
      when 'process_units'         then (v_row ->> 'process_id') || ':' || (v_row ->> 'unit_id')
      when 'asset_processes'       then (v_row ->> 'asset_id') || ':' || (v_row ->> 'process_id')
      when 'requirement_links'     then (v_row ->> 'requirement_a') || ':' || (v_row ->> 'requirement_b')
      when 'control_requirements'  then (v_row ->> 'control_id') || ':' || (v_row ->> 'requirement_id')
      when 'control_assets'        then (v_row ->> 'control_id') || ':' || (v_row ->> 'asset_id')
      when 'document_requirements' then (v_row ->> 'document_id') || ':' || (v_row ->> 'requirement_id')
      when 'valuation_levels'      then (v_row ->> 'dimension') || ':' || (v_row ->> 'level')
    end);
  if tg_op = 'DELETE' and tg_table_name <> 'organizations'
     and not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  perform app.write_audit(v_org, tg_op, tg_table_name, v_id, v_old, v_new);
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Importación: filas sin identificador (tipos que lo permiten) reciben
-- número automático; nuevos campos IP y sistema operativo.
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
                               'model','serial_number','acquired_on','attributes','ip_address','operating_system'];
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
                                   ip_address, operating_system)
        select v_org, x.code, x.name, x.asset_type_id, x.description, x.owner_id,
               x.custodian, x.unit_id, x.location, x.classification_id, x.confidentiality, x.integrity,
               x.availability, coalesce(x.status, 'activo'), x.brand, x.model, x.serial_number, x.acquired_on,
               coalesce(x.attributes, '{}'::jsonb), v_import, x.ip_address, x.operating_system
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
