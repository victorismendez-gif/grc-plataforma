-- Fase 4: gestión de riesgos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

insert into auth.users (id, email, aud, role) values
  ('d1000000-0000-4000-8000-000000000001', 'admin@rsk.test', 'authenticated', 'authenticated'),
  ('d1000000-0000-4000-8000-000000000002', 'area@rsk.test', 'authenticated', 'authenticated'),
  ('d1000000-0000-4000-8000-000000000003', 'consulta@rsk.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Rsk SA', 'rsk', 'd1000000-0000-4000-8000-000000000001', 'Admin');
insert into public.profiles (id, organization_id, email, full_name)
select u.id, o.id, u.email, u.email from public.organizations o,
  (values ('d1000000-0000-4000-8000-000000000002'::uuid, 'area@rsk.test'), ('d1000000-0000-4000-8000-000000000003'::uuid, 'consulta@rsk.test')) u(id, email)
 where o.slug = 'rsk';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, u.id, r.id
  from public.roles r join public.organizations o on o.id = r.organization_id,
  (values ('d1000000-0000-4000-8000-000000000002'::uuid, 'responsable_area'), ('d1000000-0000-4000-8000-000000000003'::uuid, 'consulta')) u(id, code)
 where o.slug = 'rsk' and r.code = u.code;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@rsk.test"}', true);

select is(jsonb_array_length((public.risk_methodology_current()).probability_levels), 5, 'Crea la metodología 5x5 por defecto');

insert into public.controls (organization_id, code, name, control_type, effectiveness_rating, implementation_status) values
  (app.current_org_id(), 'COTI-1', 'Política', 'preventivo', 3, 'implementado'),
  (app.current_org_id(), 'COTI-2', 'Respaldo', 'correctivo', 2, 'implementado'),
  (app.current_org_id(), 'COTI-3', 'Futuro', 'preventivo', 3, 'planeado');

create temp table rows on commit drop as select $j$[
  {"line":2,"cause_code":"CAU01","cause":"Errores de empleados","category":"Tecnología","factor":"Recurso humano","event":"Accidental — error humano",
   "risk_code":"R1","risk_name":"Divulgación no autorizada","controls":["COTI-1","COTI-2","COTI-3"],"treatment":"Mitigar — reforzar accesos","strategy":"mitigar"},
  {"line":3,"cause_code":"CAU01","cause":"Errores de empleados","category":"Operativos","factor":"Recurso humano","event":"Accidental — error humano",
   "risk_code":"R1","risk_name":"Divulgación no autorizada","controls":["COTI-1"],"treatment":"Mitigar","strategy":"mitigar"}
]$j$::jsonb as j;
grant select on rows to authenticated;

select is((public.risk_import((select j from rows), false) ->> 'nuevos')::int, 2, 'La vista previa cuenta los riesgos nuevos');
select is(jsonb_array_length(public.risk_import('[{"line":2,"risk_code":"R9","risk_name":"X riesgo","controls":["NOEXISTE"]}]'::jsonb, false) -> 'errores'), 1,
          'Detecta controles que no existen');
select is((select count(*)::int from public.risk_entries), 0, 'La vista previa no escribe');
select lives_ok($$ select public.risk_import((select j from rows), true) $$, 'Carga causas y riesgos');
select is((select string_agg(code, ',' order by code) from public.risk_entries), 'RG-0001,RG-0002', 'Asigna códigos RG');
select is((select count(*)::int from public.risk_causes) + (select count(*)::int from public.risk_categories) + (select count(*)::int from public.risk_factors), 4,
          'Crea causa, categorías y factor una sola vez');
select is((select count(*)::int from public.risk_entry_controls), 4, 'Enlaza los controles indicados');
select is((public.risk_import((select j from rows), true) ->> 'sin_cambios')::int, 2, 'Volver a cargar no duplica');

select lives_ok($$ select public.risk_evaluate((select id from public.risk_entries where code = 'RG-0001'), 4, 5) $$, 'Valora el riesgo');
select is((select inherent_score || ' ' || inherent_zone from public.risk_entries where code = 'RG-0001'), '20.00 Extremo', 'Inherente = P × I');
select is((select residual_probability || 'x' || residual_impact || ' ' || residual_zone from public.risk_entries where code = 'RG-0001'), '2x4 Moderado',
          'El preventivo fuerte baja la probabilidad y el correctivo moderado el impacto; el planeado no cuenta');
select throws_ok($$ update public.risk_entries set residual_score = 1 where code = 'RG-0001' $$, '42501', null, 'La valoración no se edita directamente');
select ok(not (select out_of_tolerance from public.risk_entries_view where code = 'RG-0001'), 'Residual 8 está dentro de la tolerancia (9)');

update public.controls set effectiveness_rating = 1 where code = 'COTI-1';
select is((select residual_score from public.risk_entries where code = 'RG-0001'), 16.00, 'Si el control se debilita, el residual se recalcula');
select ok((select out_of_tolerance from public.risk_entries_view where code = 'RG-0001'), 'Queda fuera de tolerancia');

select lives_ok($$ select public.risk_methodology_save(
   (public.risk_methodology_current()).probability_levels, (public.risk_methodology_current()).impact_levels, 'suma',
   (public.risk_methodology_current()).zones, 4, 8, null) $$, 'Cambia la metodología');
select is((select methodology_version from public.risk_entries_view where code = 'RG-0001'), 2 - 1, 'La evaluación conserva su versión de metodología');
select is((public.risk_methodology_current()).version, 2, 'La metodología usada queda como versión histórica');

select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000002","aal":"aal2","email":"area@rsk.test"}', true);
select throws_ok($$ select public.risk_accept((select id from public.risk_entries where code = 'RG-0001'), 'Ok', true) $$, '42501', null,
                 'Aceptar el riesgo requiere aprobación de quien parametriza');
update public.risk_categories set tolerance = 25 where name = 'Tecnología';
select is((select tolerance from public.risk_categories where name = 'Tecnología'), null, 'Solo quien parametriza cambia la tolerancia');
select ok((public.risk_add_treatment((select id from public.risk_entries where code = 'RG-0001'))) is not null, 'Crea la actividad de tratamiento');
select ok((select has_treatment from public.risk_entries_view where code = 'RG-0001'), 'El riesgo queda con tratamiento');

select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-000000000003","aal":"aal2","email":"consulta@rsk.test"}', true);
select throws_ok($$ select public.risk_import((select j from rows), true) $$, '42501', null, 'Consulta no carga riesgos');

select * from finish();
rollback;
