-- Pruebas del registro de eventos de aplicación.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into auth.users (id, email, aud, role) values
  ('55555555-5555-5555-5555-555555555555', 'admin@c.test', 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'consulta@c.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Empresa C', 'empresa-c', '55555555-5555-5555-5555-555555555555', 'Admin C');
insert into public.profiles (id, organization_id, email, full_name)
select '66666666-6666-6666-6666-666666666666', id, 'consulta@c.test', 'Consulta C' from public.organizations where slug = 'empresa-c';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, '66666666-6666-6666-6666-666666666666', r.id
  from public.roles r join public.organizations o on o.id = r.organization_id
 where o.slug = 'empresa-c' and r.code = 'consulta';

set local role authenticated;
-- Ingreso con contraseña (aal1): se registra
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","aal":"aal1","email":"consulta@c.test"}', true);
select lives_ok($$ select public.log_event('LOGIN') $$, 'El ingreso se registra aun sin doble factor');
select throws_ok($$ select public.log_event('INSERT') $$, '22023', null, 'No se pueden inventar acciones');
select throws_ok($$ select public.log_event('LOGIN', '[1,2]'::jsonb) $$, '22023', null, 'El detalle debe ser un objeto');
select throws_ok($$ select public.log_event('EXPORT') $$, '42501', null, 'Exportar exige sesión completa');

select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","aal":"aal2","email":"consulta@c.test"}', true);
select throws_ok($$ select public.log_event('MFA_RESET', '{"user_id":"x"}') $$, '42501', null,
                 'Solo quien administra usuarios registra restablecimientos de doble factor');

reset role;
select is((select count(*)::int from public.audit_log a join public.organizations o on o.id = a.organization_id
            where o.slug = 'empresa-c' and a.action = 'LOGIN' and a.actor_email = 'consulta@c.test'), 1,
          'El evento queda con el usuario real como autor');

select * from finish();
rollback;
