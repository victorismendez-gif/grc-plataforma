-- =====================================================================
-- Activos: correo del custodio (solicitud del 20-nov-2026)
-- Nuevo campo junto a «Custodio»; se muestra en todos los tipos que tienen
-- custodio. La plantilla pasa a usar «Responsable» y «Correo custodio».
-- =====================================================================

alter table public.assets
  add column custodian_email text
    check (custodian_email is null or (length(custodian_email) <= 200
           and custodian_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
grant update (custodian_email) on public.assets to authenticated;

-- Perfiles por defecto con el nuevo campo después de «custodian»
create or replace function app.default_asset_type_settings(p_code text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when p_code in ('portatil', 'escritorio') then
      '{"identifier":{"kind":"placa","label":"Placa","required":true},
        "fields":["name","status","brand","model","operating_system","serial_number","owner_id","custodian","custodian_email","location","acquired_on","description"]}'::jsonb
    when p_code in ('celular', 'tableta') then
      '{"identifier":{"kind":"imei","label":"IMEI","required":true},
        "fields":["status","brand","model","operating_system","serial_number","owner_id","custodian","custodian_email"]}'::jsonb
    when p_code = 'servidor' then
      '{"identifier":{"kind":"serial","label":"Serial","required":true},"name_label":"Nombre (hostname)",
        "fields":["name","ip_address","status","brand","model","operating_system","owner_id","custodian","custodian_email"]}'::jsonb
    when p_code = 'persona' then
      '{"identifier":{"kind":"documento","label":"Documento de identidad","required":true},"name_label":"Nombre completo",
        "fields":["name","status","owner_id","description"]}'::jsonb
    else
      '{"identifier":{"kind":"etiqueta","label":"Etiqueta o número","required":false},
        "fields":["name","status","owner_id","custodian","custodian_email","location","description"]}'::jsonb
  end
$$;


-- Tipos existentes: agregar el campo después de «custodian» si lo tienen
update public.catalog_items c
   set settings = jsonb_set(c.settings, '{fields}', (
         select jsonb_agg(x order by ord)
           from (select f.value as x, f.ord * 10 as ord
                   from jsonb_array_elements(c.settings -> 'fields') with ordinality as f(value, ord)
                 union all
                 select to_jsonb('custodian_email'::text),
                        (select g.ord * 10 + 5 from jsonb_array_elements_text(c.settings -> 'fields') with ordinality as g(value, ord)
                          where g.value = 'custodian')) s))
 where c.catalog = 'asset_type'
   and c.settings -> 'fields' ? 'custodian'
   and not c.settings -> 'fields' ? 'custodian_email';

-- Importación con el nuevo campo
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
                               'custodian_email'];
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
                                   ip_address, operating_system, custodian_email)
        select v_org, x.code, x.name, x.asset_type_id, x.description, x.owner_id,
               x.custodian, x.unit_id, x.location, x.classification_id, x.confidentiality, x.integrity,
               x.availability, coalesce(x.status, 'activo'), x.brand, x.model, x.serial_number, x.acquired_on,
               coalesce(x.attributes, '{}'::jsonb), v_import, x.ip_address, x.operating_system, x.custodian_email
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
