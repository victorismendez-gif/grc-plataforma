-- Fase 3: diagnóstico GAP y plan de trabajo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'admin@gap.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'lider@gap.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000003', 'consulta@gap.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Gap SA', 'gap', 'c1000000-0000-4000-8000-000000000001', 'Admin');
insert into public.profiles (id, organization_id, email, full_name)
select u.id, o.id, u.email, u.email from public.organizations o,
  (values ('c1000000-0000-4000-8000-000000000002'::uuid, 'lider@gap.test'), ('c1000000-0000-4000-8000-000000000003'::uuid, 'consulta@gap.test')) u(id, email)
 where o.slug = 'gap';
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, u.id, r.id
  from public.roles r join public.organizations o on o.id = r.organization_id,
  (values ('c1000000-0000-4000-8000-000000000002'::uuid, 'lider_sistema'), ('c1000000-0000-4000-8000-000000000003'::uuid, 'consulta')) u(id, code)
 where o.slug = 'gap' and r.code = u.code;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@gap.test"}', true);

insert into public.frameworks (organization_id, code, name) values
  (app.current_org_id(), 'ISO27001', 'ISO/IEC 27001'), (app.current_org_id(), 'ISO9001', 'ISO 9001');
insert into public.requirements (organization_id, framework_id, clause, title, criticality, is_auditable)
select app.current_org_id(), f.id, x.clause, x.title, x.crit, x.aud
  from public.frameworks f join (values
    ('ISO27001', '4', 'Contexto', 2, false), ('ISO27001', '4.1', 'Contexto interno', 3, true),
    ('ISO27001', '4.2', 'Partes interesadas', 2, true), ('ISO27001', '5.1', 'Liderazgo', 1, true),
    ('ISO9001', '4.1', 'Contexto', 2, true), ('ISO9001', '7.1', 'Recursos', 2, true)) x(fw, clause, title, crit, aud)
  on x.fw = f.code;
update public.requirements r set parent_id = (select p.id from public.requirements p where p.clause = '4' and p.framework_id = r.framework_id)
 where r.clause in ('4.1', '4.2') and r.framework_id = (select id from public.frameworks where code = 'ISO27001');
insert into public.requirement_links (organization_id, requirement_a, requirement_b)
select app.current_org_id(), least(a.id, b.id), greatest(a.id, b.id)
  from public.requirements a join public.frameworks fa on fa.id = a.framework_id and fa.code = 'ISO27001'
  join public.requirements b on b.clause = '4.1' join public.frameworks fb on fb.id = b.framework_id and fb.code = 'ISO9001'
 where a.clause = '4.1';

create temp table g on commit drop as
select public.gap_create('Diagnóstico inicial', array(select id from public.frameworks), 'Toda la empresa', null, null, null, 'Líder SGSI') as id;
grant select on g to authenticated;

select is((select count(*)::int from public.gap_items where assessment_id = (select id from g)), 5, 'Crea un ítem por requisito auditable');
select is((select code from public.gap_assessments), 'GAP-' || to_char(current_date, 'YYYY') || '-01', 'Asigna el código GAP-año-consecutivo');
select ok((select i.primary_item_id is not null from public.gap_items i join public.requirements r on r.id = i.requirement_id
            join public.frameworks f on f.id = r.framework_id where f.code = 'ISO9001' and r.clause = '4.1'),
          'El requisito común de la segunda norma apunta al principal');

create function pg_temp.item(fw text, cl text) returns uuid language sql as $$
  select i.id from public.gap_items i join public.requirements r on r.id = i.requirement_id
  join public.frameworks f on f.id = r.framework_id where f.code = fw and r.clause = cl $$;

select throws_ok(format($$ update public.gap_items set status = 'cumple' where id = %L $$, pg_temp.item('ISO27001', '4.1')),
                 '23514', null, '«Cumple» exige evidencia');
select lives_ok(format($$ update public.gap_items set status = 'cumple', evidence_note = 'Documento de contexto v2' where id = %L $$, pg_temp.item('ISO27001', '4.1')),
                'Califica «cumple» con evidencia');
select is((select status from public.gap_items_effective where id = pg_temp.item('ISO9001', '4.1')), 'cumple', 'El requisito común hereda la calificación');
select throws_ok(format($$ update public.gap_items set status = 'no_cumple', justification = 'x' where id = %L $$, pg_temp.item('ISO9001', '4.1')),
                 '55000', null, 'El requisito común no se califica por separado');
select lives_ok(format($$ update public.gap_items set status = 'no_cumple', justification = 'No se han identificado' where id = %L;
                         update public.gap_items set status = 'parcial', justification = 'Falta acta', evidence_note = 'Correo de la gerencia' where id = %L;
                         update public.gap_items set status = 'no_aplica', justification = 'Sin recursos externos' where id = %L $$,
                       pg_temp.item('ISO27001', '4.2'), pg_temp.item('ISO27001', '5.1'), pg_temp.item('ISO9001', '7.1')), 'Califica el resto');
select is((select top_clause from public.gap_items_effective where id = pg_temp.item('ISO27001', '4.2')), '4', 'Agrupa por cláusula principal');
select is((select assessed_by::text from public.gap_items where id = pg_temp.item('ISO27001', '4.2')), 'c1000000-0000-4000-8000-000000000001', 'Registra quién calificó');

select throws_ok(format($$ select public.gap_validate(array[%L]::uuid[]) $$, pg_temp.item('ISO27001', '4.2')), '42501', null,
                 'Nadie valida sus propias calificaciones');
select throws_ok(format($$ update public.gap_items set validated_at = now() where id = %L $$, pg_temp.item('ISO27001', '4.2')), '42501', null,
                 'La validación no se escribe directamente');

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","aal":"aal2","email":"lider@gap.test"}', true);
select is(public.gap_validate(array(select id from public.gap_items where assessment_id = (select id from g))), 4, 'Otra persona valida las calificaciones');

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@gap.test"}', true);
update public.gap_items set justification = 'No se han identificado formalmente' where id = pg_temp.item('ISO27001', '4.2');
select ok((select validated_at is null from public.gap_items where id = pg_temp.item('ISO27001', '4.2')), 'Recalificar exige validar de nuevo');

create temp table pl on commit drop as select public.gap_generate_plan((select id from g)) as res;
select is((select (res ->> 'nuevas')::int from pl), 2, 'Genera una actividad por brecha');
select is((select string_agg(r.clause || ':' || a.priority, ',' order by r.clause) from public.actions a join public.requirements r on r.id = a.requirement_id),
          '4.2:alta,5.1:baja', 'La prioridad sigue la criticidad del requisito');
select is((public.gap_generate_plan((select id from g)) ->> 'nuevas')::int, 0, 'No duplica actividades al generar de nuevo');
select is((select code from public.action_plans), 'PT-' || to_char(current_date, 'YYYY') || '-01', 'El plan recibe su código');

select throws_ok($$ update public.actions set status = 'terminada' where requirement_id = (select id from public.requirements where clause = '4.2') $$,
                 '23514', null, 'Terminar exige evidencia de cierre');
update public.actions set status = 'terminada', closure_evidence = 'Matriz de partes interesadas aprobada'
 where requirement_id = (select id from public.requirements where clause = '4.2');
select is((select progress::int from public.actions where requirement_id = (select id from public.requirements where clause = '4.2')), 100, 'Terminada = 100 %');
select ok((select gap_closed from public.gap_items_effective where id = pg_temp.item('ISO27001', '4.2')), 'La brecha queda cerrada al terminar sus actividades');

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","aal":"aal2","email":"lider@gap.test"}', true);
select lives_ok($$ select public.gap_set_status((select id from g), 'cerrado') $$, 'Cierra el diagnóstico');
select throws_ok(format($$ update public.gap_items set status = 'cumple', evidence_note = 'x' where id = %L $$, pg_temp.item('ISO27001', '4.2')),
                 '55000', null, 'Un diagnóstico cerrado no se modifica');

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000003","aal":"aal2","email":"consulta@gap.test"}', true);
select throws_ok($$ select public.gap_create('Otro', array(select id from public.frameworks), null, null, null, null, null) $$,
                 '42501', null, 'Consulta no crea diagnósticos');

select * from finish();
rollback;
