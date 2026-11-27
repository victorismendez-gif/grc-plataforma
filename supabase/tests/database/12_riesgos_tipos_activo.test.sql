-- Escenarios de riesgo ↔ tipos de activo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

insert into auth.users (id, email, aud, role) values
  ('d2000000-0000-4000-8000-000000000001', 'admin@rta.test', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-000000000002', 'empleado@rta.test', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-000000000003', 'otro@rtb.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Rta SA', 'rta', 'd2000000-0000-4000-8000-000000000001', 'Admin');
select app.bootstrap_organization('Rtb SA', 'rtb', 'd2000000-0000-4000-8000-000000000003', 'Otro');
insert into public.profiles (id, organization_id, email, full_name)
select 'd2000000-0000-4000-8000-000000000002', o.id, 'empleado@rta.test', 'Empleado' from public.organizations o where o.slug = 'rta';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, 'd2000000-0000-4000-8000-000000000002', r.id
  from public.roles r join public.organizations o on o.id = r.organization_id where o.slug = 'rta' and r.code = 'empleado';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d2000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@rta.test"}', true);

select ok((select count(*) from public.catalog_items where catalog = 'asset_type' and code in ('portatil', 'servidor')) = 2, 'Hay tipos de activo en el catálogo');

select lives_ok($$ select public.risk_import('[
  {"line":2,"risk_code":"R1","risk_name":"Divulgación","cause_code":"CAU01","cause":"Errores","asset_types":["portatil","servidor"]},
  {"line":3,"risk_code":"R1","risk_name":"Divulgación","cause_code":"CAU02","cause":"Malware"}
]'::jsonb, true) $$, 'Carga escenarios con tipos de activo');
select is((select string_agg(c.code, ',' order by c.code) from public.risk_entry_asset_types t
             join public.catalog_items c on c.id = t.asset_type_id
             join public.risk_entries e on e.id = t.entry_id where e.code = 'RG-0001'), 'portatil,servidor', 'Vincula los dos tipos');
select is((select count(*)::int from public.risk_entry_asset_types t join public.risk_entries e on e.id = t.entry_id where e.code = 'RG-0002'), 0,
          'Sin columna o celda vacía no vincula');

select is(jsonb_array_length(public.risk_import('[{"line":2,"code":"RG-0001","asset_types":["nevera"]}]'::jsonb, false) -> 'errores'), 1,
          'Detecta tipos de activo que no existen');
select is((public.risk_import('[{"line":2,"code":"RG-0001","asset_types":["servidor"]}]'::jsonb, true) ->> 'actualizados')::int, 1,
          'Cambiar los tipos cuenta como actualización');
select is((select count(*)::int from public.risk_entry_asset_types t join public.risk_entries e on e.id = t.entry_id where e.code = 'RG-0001'), 1,
          'Reemplaza el conjunto de tipos');
select is((public.risk_import('[{"line":2,"code":"RG-0001","asset_types":["servidor"]}]'::jsonb, true) ->> 'sin_cambios')::int, 1,
          'Los mismos tipos no cuentan como cambio');
select throws_ok($$ insert into public.risk_entry_asset_types (organization_id, entry_id, asset_type_id)
                    select app.current_org_id(), e.id, c.id from public.risk_entries e, public.catalog_items c
                     where e.code = 'RG-0002' and c.catalog <> 'asset_type' limit 1 $$,
                 '23503', null, 'Solo admite ítems del catálogo de tipos de activo');

select lives_ok($$ select public.risk_import('[{"line":2,"code":"RG-0001","owner":"Oficial de seguridad"},{"line":3,"code":"RG-0002","owner":"admin@rta.test"}]'::jsonb, true) $$,
                'Carga el responsable');
select is((select owner_text from public.risk_entries where code = 'RG-0001'), 'Oficial de seguridad', 'Responsable como texto');
select ok((select owner_id is not null and owner_text is null from public.risk_entries where code = 'RG-0002'), 'Responsable vinculado al usuario por correo');

-- Otra organización no ve los vínculos
select set_config('request.jwt.claims', '{"sub":"d2000000-0000-4000-8000-000000000003","aal":"aal2","email":"otro@rtb.test"}', true);
select is((select count(*)::int from public.risk_entry_asset_types), 0, 'Aislamiento entre organizaciones');

-- Empleado (sin permiso de riesgos) no carga
select set_config('request.jwt.claims', '{"sub":"d2000000-0000-4000-8000-000000000002","aal":"aal2","email":"empleado@rta.test"}', true);
select throws_ok($$ select public.risk_import('[{"line":2,"code":"RG-0001","asset_types":["portatil"]}]'::jsonb, true) $$, '42501', null,
                 'Sin permiso de riesgos no se carga');

select * from finish();
rollback;
