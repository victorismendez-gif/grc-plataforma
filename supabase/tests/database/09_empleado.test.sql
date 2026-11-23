-- Rol Empleado: solo ve y actualiza sus equipos asignados.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (id, email, aud, role) values
  ('b1000000-0000-4000-8000-000000000001', 'admin@emp.test', 'authenticated', 'authenticated'),
  ('b1000000-0000-4000-8000-000000000002', 'ana@emp.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Emp SA', 'emp', 'b1000000-0000-4000-8000-000000000001', 'Admin');
insert into public.profiles (id, organization_id, email, full_name)
select 'b1000000-0000-4000-8000-000000000002', id, 'ana@emp.test', 'Ana Pérez' from public.organizations where slug = 'emp';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, 'b1000000-0000-4000-8000-000000000002', r.id
  from public.roles r join public.organizations o on o.id = r.organization_id
 where o.slug = 'emp' and r.code = 'empleado';

select is((select array_agg(permission_code)::text from public.role_permissions rp join public.roles r on r.id = rp.role_id
            join public.organizations o on o.id = r.organization_id where o.slug = 'emp' and r.code = 'empleado'),
          '{assets.self}', 'El rol Empleado solo tiene assets.self');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@emp.test"}', true);
insert into public.assets (organization_id, asset_type_id, code, custodian_email, owner_text)
select app.current_org_id(), id, 'PC-ANA', 'Ana@Emp.test', 'Gestión de activos' from public.catalog_items where code = 'portatil';
insert into public.assets (organization_id, asset_type_id, code, custodian_email)
select app.current_org_id(), id, 'PC-OTRO', 'otro@emp.test' from public.catalog_items where code = 'portatil';
insert into public.assets (organization_id, asset_type_id, code, custodian_email)
select app.current_org_id(), id, 'SRV-1', 'ana@emp.test' from public.catalog_items where code = 'servidor';

select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000002","aal":"aal2","email":"ana@emp.test"}', true);
select is((select string_agg(code, ',' order by code) from public.assets), 'PC-ANA',
          'La empleada ve solo su equipo (por correo del custodio, sin servidores)');

select lives_ok($$ update public.assets set brand = 'Lenovo', owner_text = 'Yo', classification_id = null where code = 'PC-ANA' $$,
                'Actualiza los datos de su equipo');
select is((select brand from public.assets where code = 'PC-ANA'), 'Lenovo', 'Cambia la marca');
select is((select owner_text from public.assets where code = 'PC-ANA'), 'Gestión de activos', 'No cambia el responsable');

select lives_ok($$ update public.assets set status = 'dado_de_baja' where code = 'PC-ANA' $$, 'Da de baja su equipo');
select is((select status from public.assets where code = 'PC-ANA'), 'dado_de_baja', 'Queda dado de baja');

update public.assets set brand = 'X' where code = 'PC-OTRO';
select is((select count(*)::int from public.assets where brand = 'X'), 0, 'No modifica equipos de otros');

select lives_ok($$ insert into public.assets (organization_id, asset_type_id, code, custodian_email)
                   select app.current_org_id(), id, '351234567890123', 'otro@emp.test' from public.catalog_items where code = 'celular' $$,
                'Registra un celular nuevo');
select is((select custodian_email || ' / ' || custodian from public.assets where code = '351234567890123'), 'ana@emp.test / Ana Pérez',
          'El equipo nuevo queda asignado a quien lo registra');
select throws_ok($$ insert into public.assets (organization_id, asset_type_id, code)
                    select app.current_org_id(), id, 'SRV-2' from public.catalog_items where code = 'servidor' $$,
                 '42501', null, 'No registra tipos distintos a sus equipos');
select throws_ok($$ select public.import_assets('x.xlsx', array['name'], '[]'::jsonb, false) $$, '42501', null,
                 'No usa la carga masiva');

select * from finish();
rollback;
