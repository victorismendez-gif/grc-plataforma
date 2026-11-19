-- Pruebas de la Fase 1: aislamiento por organización, doble factor,
-- permisos en la base y registro de auditoría inalterable.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

-- ---------- Datos de prueba: dos organizaciones ----------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin@a.test',    'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'consulta@a.test', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'admin@b.test',    'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'nuevo@a.test',    'authenticated', 'authenticated');

select app.bootstrap_organization('Empresa A', 'empresa-a', '11111111-1111-1111-1111-111111111111', 'Admin A');
select app.bootstrap_organization('Empresa B', 'empresa-b', '33333333-3333-3333-3333-333333333333', 'Admin B');

insert into public.profiles (id, organization_id, email, full_name)
select '22222222-2222-2222-2222-222222222222', id, 'consulta@a.test', 'Consulta A'
  from public.organizations where slug = 'empresa-a';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, '22222222-2222-2222-2222-222222222222', r.id
  from public.roles r join public.organizations o on o.id = r.organization_id
 where o.slug = 'empresa-a' and r.code = 'consulta';

select is((select count(*)::int from public.roles r join public.organizations o on o.id = r.organization_id
            where o.slug = 'empresa-a' and r.is_system), 5, 'Cada organización nace con 5 roles base');
select is((select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id
            join public.organizations o on o.id = r.organization_id
            where o.slug = 'empresa-a' and r.code = 'administrador'),
          (select count(*)::int from public.permissions), 'El administrador tiene todos los permisos');

create temp table ids on commit drop as
  select (select id from public.organizations where slug = 'empresa-b') as org_b;
grant select on ids to authenticated;

-- ---------- Sin doble factor no se ve nada ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal1","role":"authenticated"}', true);
select is((select count(*)::int from public.organizations), 0, 'Con aal1 no se ve la organización');
select is((select count(*)::int from public.profiles), 0, 'Con aal1 no se ven perfiles');
select is(public.current_permissions(), '{}'::text[], 'Con aal1 no hay permisos efectivos');

-- ---------- Con doble factor: solo su organización ----------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2","role":"authenticated","email":"admin@a.test"}', true);
select is((select count(*)::int from public.organizations), 1, 'Con aal2 ve solo su organización');
select is((select name from public.organizations), 'Empresa A', 'Es la organización correcta');
select is((select count(*)::int from public.profiles), 2, 'Ve solo los perfiles de su organización');
select ok(app.has_permission('users.manage'), 'El administrador tiene users.manage');
select is((select count(*)::int from public.audit_log where organization_id <> app.current_org_id()), 0,
          'No ve trazas de otra organización');

-- El administrador crea un rol personalizado y le asigna permisos
select lives_ok($$ insert into public.roles (organization_id, code, name)
                   values (app.current_org_id(), 'calidad', 'Equipo de calidad') $$,
                'El administrador crea un rol personalizado');
select lives_ok($$ insert into public.role_permissions (organization_id, role_id, permission_code)
                   select organization_id, id, 'documents.read' from public.roles where code = 'calidad' $$,
                'El administrador asigna permisos al rol');
select throws_ok($$ insert into public.roles (organization_id, code, name, is_system)
                    values (app.current_org_id(), 'falso', 'Falso sistema', true) $$,
                 '42501', null, 'No se pueden crear roles marcados como del sistema');
select throws_ok($$ insert into public.roles (organization_id, code, name)
                    select org_b, 'intruso', 'Intruso' from ids $$,
                 '42501', null, 'No puede crear roles en otra organización');
select throws_ok($$ delete from public.role_permissions rp using public.roles r
                    where r.id = rp.role_id and r.code = 'administrador' and rp.permission_code = 'users.manage' $$,
                 '42501', null, 'El rol administrador no pierde permisos');
select throws_ok($$ delete from public.user_roles ur using public.roles r
                    where r.id = ur.role_id and r.code = 'administrador' $$,
                 '42501', null, 'No se puede quitar el último administrador');

-- Alta de perfil para un usuario invitado (queda con autor en la traza)
select lives_ok($$ select public.admin_create_profile('44444444-4444-4444-4444-444444444444', 'Usuario Nuevo') $$,
                'El administrador da de alta a un invitado');
select is((select actor_email from public.audit_log
            where table_name = 'profiles' and record_id = '44444444-4444-4444-4444-444444444444'),
          'admin@a.test', 'La traza registra quién creó el perfil');

-- ---------- Usuario de consulta: solo lectura ----------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal2","role":"authenticated"}', true);
select throws_ok($$ insert into public.roles (organization_id, code, name)
                    values (app.current_org_id(), 'otro', 'Otro') $$,
                 '42501', null, 'Consulta no puede crear roles');
select is((select count(*)::int from public.audit_log), 0, 'Consulta no ve el registro de auditoría');
update public.organizations set name = 'Hackeada';
select is((select name from public.organizations), 'Empresa A', 'Consulta no puede editar la organización');
select throws_ok($$ select public.admin_create_profile('44444444-4444-4444-4444-444444444444', 'x') $$,
                 '42501', null, 'Consulta no puede dar de alta usuarios');

-- ---------- Registro de auditoría inalterable y encadenado ----------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2","role":"authenticated"}', true);
reset role;
select throws_ok($$ update public.audit_log set action = 'X' $$, '42501', null,
                 'Ni siquiera el dueño de la base puede editar la traza');
set local role authenticated;
select is((select first_broken_id from public.verify_audit_chain()), null::bigint,
          'La cadena de hashes de la traza está íntegra');

select * from finish();
rollback;
