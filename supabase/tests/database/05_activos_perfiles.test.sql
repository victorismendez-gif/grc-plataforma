-- Pruebas de los ajustes de activos: identificador por tipo, número
-- automático, escala 1-5 parametrizable, nombre por defecto.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

insert into auth.users (id, email, aud, role) values
  ('d0000000-0000-4000-8000-000000000001', 'admin@perf.test', 'authenticated', 'authenticated'),
  ('d0000000-0000-4000-8000-000000000002', 'consulta@perf.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Perfiles SA', 'perfiles', 'd0000000-0000-4000-8000-000000000001', 'Admin');
insert into public.profiles (id, organization_id, email, full_name)
select 'd0000000-0000-4000-8000-000000000002', id, 'consulta@perf.test', 'Consulta' from public.organizations where slug = 'perfiles';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, 'd0000000-0000-4000-8000-000000000002', r.id
  from public.roles r join public.organizations o on o.id = r.organization_id
 where o.slug = 'perfiles' and r.code = 'consulta';

select is((select count(*)::int from public.valuation_levels v join public.organizations o on o.id = v.organization_id
            where o.slug = 'perfiles'), 15, 'La escala nace con 5 niveles para cada dimensión');
select is((select c.settings -> 'identifier' ->> 'label' from public.catalog_items c join public.organizations o on o.id = c.organization_id
            where o.slug = 'perfiles' and c.code = 'servidor'), 'Serial', 'El servidor se identifica por su serial');
select is((select label from public.catalog_items c join public.organizations o on o.id = c.organization_id
            where o.slug = 'perfiles' and c.code = 'persona'), 'Empleado', 'Existe el tipo Empleado');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@perf.test"}', true);

select throws_ok($$ insert into public.assets (organization_id, asset_type_id, name)
                    values (app.current_org_id(), (select id from public.catalog_items where code = 'portatil'), 'Sin placa') $$,
                 '23502', null, 'Un computador sin placa se rechaza');
select lives_ok($$ insert into public.assets (organization_id, asset_type_id, name)
                   values (app.current_org_id(), (select id from public.catalog_items where code = 'repositorio'), 'Repositorio de contratos') $$,
                'Un repositorio sin etiqueta se acepta');
select ok((select code ~ '^\d{8}$' from public.assets where name = 'Repositorio de contratos'),
          'Al repositorio se le asigna un número aleatorio de 8 dígitos');
select lives_ok($$ insert into public.assets (organization_id, asset_type_id, code, brand, model, confidentiality, integrity, availability)
                   values (app.current_org_id(), (select id from public.catalog_items where code = 'celular'),
                           '356938035643809', 'Samsung', 'A54', 5, 3, 4) $$,
                'Un celular con IMEI y valoración 1-5 se acepta');
select is((select name from public.assets where code = '356938035643809'), 'Celular Samsung A54',
          'Si no se escribe nombre, se arma con el tipo, la marca y el modelo');
select is((select criticality::int from public.assets where code = '356938035643809'), 5, 'La criticidad usa la escala 1-5');
select throws_ok($$ update public.assets set confidentiality = 6 where code = '356938035643809' $$,
                 '23514', null, 'No se aceptan valores por fuera de 1-5');
select throws_ok($$ insert into public.assets (organization_id, asset_type_id, code, name)
                    values (app.current_org_id(), (select id from public.catalog_items where code = 'otro'), 'X-1', repeat('a', 81)) $$,
                 '23514', null, 'El nombre del activo admite máximo 80 caracteres');
select lives_ok($$ update public.valuation_levels set description = 'Definición de la metodología'
                   where dimension = 'confidentiality' and level = 5 $$, 'El administrador ajusta la escala');

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","aal":"aal2","email":"consulta@perf.test"}', true);
update public.valuation_levels set label = 'Cambiado' where dimension = 'integrity' and level = 1;
select is((select label from public.valuation_levels where dimension = 'integrity' and level = 1), 'Muy bajo',
          'Consulta no puede cambiar la escala');
select is((select count(*)::int from public.valuation_levels), 15, 'Consulta sí puede leer la escala');

select * from finish();
rollback;
