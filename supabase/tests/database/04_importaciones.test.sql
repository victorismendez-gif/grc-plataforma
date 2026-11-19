-- Pruebas de las importaciones masivas: diferencias mes a mes de activos y
-- jerarquía de requisitos a partir de la numeración de cláusulas.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

insert into auth.users (id, email, aud, role) values
  ('c0000000-0000-4000-8000-000000000001', 'admin@imp.test', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-000000000002', 'consulta@imp.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Importadora', 'importadora', 'c0000000-0000-4000-8000-000000000001', 'Admin');
insert into public.profiles (id, organization_id, email, full_name)
select 'c0000000-0000-4000-8000-000000000002', id, 'consulta@imp.test', 'Consulta' from public.organizations where slug = 'importadora';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, 'c0000000-0000-4000-8000-000000000002', r.id
  from public.roles r join public.organizations o on o.id = r.organization_id
 where o.slug = 'importadora' and r.code = 'consulta';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@imp.test"}', true);

create temp table t on commit drop as
select (select id from public.catalog_items where code = 'portatil') as portatil,
       (select id from public.catalog_items where code = 'celular') as celular;

-- Mes 1: tres activos
create temp table mes1 on commit drop as
select jsonb_build_array(
  jsonb_build_object('code', 'A-1', 'name', 'Portátil 1', 'asset_type_id', portatil, 'confidentiality', 2, 'status', 'activo'),
  jsonb_build_object('code', 'A-2', 'name', 'Portátil 2', 'asset_type_id', portatil, 'confidentiality', 1, 'status', 'activo'),
  jsonb_build_object('code', 'A-3', 'name', 'Celular 1',  'asset_type_id', celular,  'confidentiality', 3, 'status', 'activo')
) as rows from t;

select is((public.import_assets('mes1.xlsx', array['name','asset_type_id','confidentiality','status'], (select rows from mes1), false) ->> 'nuevos')::int,
          3, 'La vista previa detecta 3 activos nuevos');
select is((select count(*)::int from public.assets), 0, 'La vista previa no escribe nada');
select is((public.import_assets('mes1.xlsx', array['name','asset_type_id','confidentiality','status'], (select rows from mes1), true) ->> 'nuevos')::int,
          3, 'Al aplicar se crean los 3 activos');
select is((select count(*)::int from public.asset_imports), 1, 'La carga queda en el historial');

-- Mes 2: A-1 sin cambios, A-2 cambia confidencialidad y estado, A-3 no viene, A-4 es nuevo
create temp table mes2 on commit drop as
select jsonb_build_array(
  jsonb_build_object('code', 'A-1', 'name', 'Portátil 1', 'asset_type_id', portatil, 'confidentiality', 2, 'status', 'activo'),
  jsonb_build_object('code', 'A-2', 'name', 'Portátil 2', 'asset_type_id', portatil, 'confidentiality', 3, 'status', 'en_reparacion'),
  jsonb_build_object('code', 'A-4', 'name', 'Celular 2',  'asset_type_id', celular,  'confidentiality', 1, 'status', 'activo')
) as rows from t;
create temp table res2 on commit drop as
select public.import_assets('mes2.xlsx', array['name','asset_type_id','confidentiality','status'], (select rows from mes2), true) as r;

select is((select (r ->> 'nuevos')::int from res2), 1, 'Mes 2: un activo nuevo');
select is((select (r ->> 'modificados')::int from res2), 1, 'Mes 2: un activo modificado');
select is((select (r ->> 'sin_cambios')::int from res2), 1, 'Mes 2: un activo sin cambios');
select is((select r -> 'lista_ausentes' from res2), '["A-3"]'::jsonb, 'Mes 2: reporta el activo que ya no aparece');
select is((select (r -> 'lista_modificados' -> 0 -> 'cambios' -> 'confidentiality' ->> 'ahora')::int from res2), 3,
          'Mes 2: muestra el valor anterior y el nuevo de cada campo');
select is((select status from public.assets where code = 'A-2'), 'en_reparacion', 'El cambio se aplicó');
select is((select confidentiality::int from public.assets where code = 'A-3'), 3, 'El activo ausente no se borra ni se altera');

-- Requisitos: jerarquía por numeración
insert into public.frameworks (organization_id, code, name, version) values (app.current_org_id(), 'ISO9001', 'ISO 9001', '2015');
select public.import_requirements((select id from public.frameworks where code = 'ISO9001'),
  '[{"clause":"4","title":"Contexto"},{"clause":"4.1","title":"Comprensión"},{"clause":"4.4.1","title":"Procesos"},{"clause":"4.4","title":"Sistema"}]'::jsonb);
select is((select p.clause from public.requirements r join public.requirements p on p.id = r.parent_id where r.clause = '4.4.1'),
          '4.4', 'La jerarquía se deduce de la numeración');

-- Consulta no puede importar
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","aal":"aal2","email":"consulta@imp.test"}', true);
select throws_ok($$ select public.import_assets('x', array['name'], '[{"code":"Z"}]'::jsonb, true) $$, '42501', null,
                 'Consulta no puede importar activos');
select throws_ok($$ select public.import_requirements((select id from public.frameworks where code = 'ISO9001'), '[]'::jsonb) $$,
                 '42501', null, 'Consulta no puede importar requisitos');

select * from finish();
rollback;
