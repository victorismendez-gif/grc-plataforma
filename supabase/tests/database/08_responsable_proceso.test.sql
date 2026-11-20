-- Responsable editable y proceso en activos, controles y documentos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

insert into auth.users (id, email, aud, role) values
  ('a1000000-0000-4000-8000-000000000001', 'admin@rp.test', 'authenticated', 'authenticated'),
  ('a1000000-0000-4000-8000-000000000002', 'consulta@rp.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('RP SA', 'rp', 'a1000000-0000-4000-8000-000000000001', 'Admin');
insert into public.profiles (id, organization_id, email, full_name)
select 'a1000000-0000-4000-8000-000000000002', id, 'consulta@rp.test', 'Consulta' from public.organizations where slug = 'rp';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, 'a1000000-0000-4000-8000-000000000002', r.id
  from public.roles r join public.organizations o on o.id = r.organization_id
 where o.slug = 'rp' and r.code = 'consulta';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@rp.test"}', true);

create temp table p1 on commit drop as select public.ensure_process('Gestión de TI') as id;
select ok((select id from p1) is not null, 'Crea un proceso nuevo a partir del nombre');
select is(public.ensure_process('  gestión   de ti '), (select id from p1), 'Un nombre equivalente reutiliza el mismo proceso');
select is((select count(*)::int from public.processes), 1, 'No se duplican procesos');

select lives_ok($$ insert into public.assets (organization_id, asset_type_id, code, owner_text, process_id)
                   values (app.current_org_id(), (select id from public.catalog_items where code = 'otro'), 'A1',
                           'Jefe de compras', (select id from p1)) $$,
                'Un activo guarda responsable en texto y proceso');
create temp table r on commit drop as select public.import_assets('m.xlsx', array['owner_text','process_id'],
  jsonb_build_array(jsonb_build_object('code','A1','owner_text','Gerente financiero','process_id', null)), true) as res;
select is((select res -> 'lista_modificados' -> 0 -> 'cambios' -> 'owner_text' ->> 'ahora' from r), 'Gerente financiero',
          'La importación detecta el cambio de responsable en texto');
select lives_ok($$ select public.import_controls(array['name','process_id'],
                   jsonb_build_array(jsonb_build_object('code','C1','name','Control 1','process_id',(select id from p1))), true) $$,
                'Los controles se importan con proceso');
select is((select p.name from public.controls c join public.processes p on p.id = c.process_id where c.code = 'C1'), 'Gestión de TI',
          'El control queda enlazado al proceso');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002","aal":"aal2","email":"consulta@rp.test"}', true);
select throws_ok($$ select public.ensure_process('Otro proceso') $$, '42501', null, 'Consulta no puede crear procesos');

select * from finish();
rollback;
