-- Pruebas de los campos de controles y su importación masiva.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

insert into auth.users (id, email, aud, role) values
  ('e0000000-0000-4000-8000-000000000001', 'admin@ctl.test', 'authenticated', 'authenticated'),
  ('e0000000-0000-4000-8000-000000000002', 'consulta@ctl.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Controles SA', 'controles', 'e0000000-0000-4000-8000-000000000001', 'Admin');
insert into public.profiles (id, organization_id, email, full_name)
select 'e0000000-0000-4000-8000-000000000002', id, 'consulta@ctl.test', 'Consulta' from public.organizations where slug = 'controles';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, 'e0000000-0000-4000-8000-000000000002', r.id
  from public.roles r join public.organizations o on o.id = r.organization_id
 where o.slug = 'controles' and r.code = 'consulta';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@ctl.test"}', true);

create temp table f on commit drop as
select array['name','description','owner_text','control_type','nature','frequency','documentation','evidence',
             'design_rating','application_rating','effectiveness_rating','implementation_status'] as fields;
create temp table m1 on commit drop as select '[
  {"code":"CTL-01","name":"Copias de seguridad diarias","owner_text":"Infraestructura","control_type":"preventivo","nature":"automatico",
   "frequency":"diario","documentation":"documentado","evidence":"con_registro","design_rating":3,"application_rating":3,"effectiveness_rating":3,"implementation_status":"implementado"},
  {"code":"CTL-02","name":"Revisión de accesos","control_type":"detectivo","nature":"manual","frequency":"trimestral",
   "documentation":"sin_documentar","evidence":"sin_registro","design_rating":2,"application_rating":1,"effectiveness_rating":1,"implementation_status":"en_implementacion"}
]'::jsonb as rows;

select is((public.import_controls((select fields from f), (select rows from m1), false) ->> 'nuevos')::int, 2, 'La vista previa detecta 2 controles nuevos');
select is((select count(*)::int from public.controls), 0, 'La vista previa no escribe');
select is((public.import_controls((select fields from f), (select rows from m1), true) ->> 'nuevos')::int, 2, 'Se crean los 2 controles');
select is((select evidence || '/' || documentation || '/' || application_rating from public.controls where code = 'CTL-01'),
          'con_registro/documentado/3', 'Se guardan documentación, evidencia y aplicación');

create temp table res2 on commit drop as select public.import_controls((select fields from f), '[
  {"code":"CTL-01","name":"Copias de seguridad diarias","owner_text":"Infraestructura","control_type":"preventivo","nature":"automatico",
   "frequency":"diario","documentation":"documentado","evidence":"con_registro","design_rating":3,"application_rating":3,"effectiveness_rating":3,"implementation_status":"implementado"},
  {"code":"CTL-02","name":"Revisión de accesos","control_type":"detectivo","nature":"manual","frequency":"trimestral",
   "documentation":"documentado","evidence":"con_registro","design_rating":3,"application_rating":2,"effectiveness_rating":2,"implementation_status":"implementado"}
]'::jsonb, true) as r;
select is((select (r ->> 'modificados')::int from res2), 1, 'La segunda carga detecta el control modificado');
select is((select (r ->> 'sin_cambios')::int from res2), 1, 'Y el control sin cambios');
select throws_ok($$ select public.import_controls(array['name'], '[{"code":"A"},{"code":"A"}]'::jsonb, false) $$,
                 '22023', null, 'Rechaza ID repetidos');
select throws_ok($$ update public.controls set evidence = 'tal vez' where code = 'CTL-01' $$, '23514', null,
                 'Evidencia solo admite los valores definidos');

select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","aal":"aal2","email":"consulta@ctl.test"}', true);
select throws_ok($$ select public.import_controls(array['name'], '[{"code":"Z","name":"Z"}]'::jsonb, true) $$, '42501', null,
                 'Consulta no puede importar controles');

select * from finish();
rollback;
