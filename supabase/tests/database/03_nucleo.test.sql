-- Pruebas de la Fase 2: núcleo (estructura, activos, normas, controles,
-- documentos con flujo de aprobación y políticas).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

-- ---------- Dos organizaciones y cuatro usuarios ----------
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@n.test',    'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'lider@n.test',    'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'consulta@n.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000001', 'admin@otra.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Núcleo SA', 'nucleo', 'a0000000-0000-4000-8000-000000000001', 'Admin N');
select app.bootstrap_organization('Otra SA', 'otra', 'b0000000-0000-4000-8000-000000000001', 'Admin O');
insert into public.profiles (id, organization_id, email, full_name)
select u.id, o.id, u.email, u.email from auth.users u, public.organizations o
 where o.slug = 'nucleo' and u.email in ('lider@n.test', 'consulta@n.test');
insert into public.user_roles (organization_id, user_id, role_id)
select r.organization_id, p.id, r.id
  from public.profiles p join public.roles r on r.organization_id = p.organization_id
 where (p.email = 'lider@n.test' and r.code = 'lider_sistema') or (p.email = 'consulta@n.test' and r.code = 'consulta');

select is((select count(*)::int from public.catalog_items c join public.organizations o on o.id = c.organization_id
            where o.slug = 'nucleo' and c.catalog = 'info_classification'), 3,
          'Cada organización nace con los niveles de clasificación Pública, Uso interno y Confidencial');

create temp table ctx on commit drop as
select (select id from public.organizations where slug = 'otra') as org_b,
       (select c.id from public.catalog_items c join public.organizations o on o.id = c.organization_id
         where o.slug = 'otra' and c.code = 'portatil') as tipo_b;
grant select on ctx to authenticated;

set local role authenticated;

-- ---------- Líder de sistema: estructura y activos ----------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","aal":"aal2","email":"lider@n.test"}', true);
select lives_ok($$ insert into public.org_units (organization_id, unit_type, code, name)
                   values (app.current_org_id(), 'sede', 'BOG', 'Sede Bogotá') $$, 'Crea una sede');
select lives_ok($$ insert into public.org_units (organization_id, parent_id, unit_type, code, name)
                   select organization_id, id, 'area', 'TI', 'Tecnología' from public.org_units where code = 'BOG' $$,
                'Crea un área dentro de la sede');
select throws_ok($$ update public.org_units set parent_id = (select id from public.org_units where code = 'TI') where code = 'BOG' $$,
                 '23514', null, 'La jerarquía no admite ciclos');
select lives_ok($$ insert into public.processes (organization_id, code, name, process_type)
                   values (app.current_org_id(), 'GTI', 'Gestión de TI', 'apoyo') $$, 'Crea un proceso');

select lives_ok($$ insert into public.assets (organization_id, code, name, asset_type_id, classification_id,
                                              confidentiality, integrity, availability, unit_id)
                   select app.current_org_id(), 'PC-001', 'Portátil gerencia',
                          (select id from public.catalog_items where code = 'portatil'),
                          (select id from public.catalog_items where code = 'confidencial'),
                          3, 2, 1, (select id from public.org_units where code = 'TI') $$,
                'Registra un activo con valoración CID');
select is((select criticality::int from public.assets where code = 'PC-001'), 3,
          'La criticidad del activo es el mayor valor de confidencialidad, integridad y disponibilidad');
select throws_ok($$ insert into public.assets (organization_id, code, name, asset_type_id)
                    values (app.current_org_id(), 'PC-001', 'Duplicado', (select id from public.catalog_items where code = 'portatil')) $$,
                 '23505', null, 'El código del activo es único en la organización');
select throws_ok($$ insert into public.assets (organization_id, code, name, asset_type_id)
                    select app.current_org_id(), 'PC-X', 'Tipo ajeno', tipo_b from ctx $$,
                 '23503', null, 'No se puede usar un catálogo de otra organización');
select throws_ok($$ insert into public.assets (organization_id, code, name, asset_type_id)
                    select org_b, 'PC-Y', 'Intruso', tipo_b from ctx $$,
                 '42501', null, 'No se crean activos en otra organización');
select throws_ok($$ update public.assets set criticality = 1 $$, '428C9', null, 'La criticidad no se edita a mano');

-- ---------- Normas, requisitos y controles ----------
select lives_ok($$ insert into public.frameworks (organization_id, code, name, version)
                   values (app.current_org_id(), 'ISO27001', 'ISO/IEC 27001', '2022') $$, 'Crea una norma');
insert into public.requirements (organization_id, framework_id, clause, title)
select app.current_org_id(), f.id, x.clause, x.title
  from public.frameworks f,
       (values ('4.10', 'Cuatro diez'), ('4.2', 'Cuatro dos'), ('A.5.1', 'Políticas'), ('4', 'Contexto')) x(clause, title);
select is((select string_agg(clause, ',' order by sort_key) from public.requirements), '4,4.2,4.10,A.5.1',
          'Las cláusulas se ordenan de forma natural');
select lives_ok($$ insert into public.controls (organization_id, code, name)
                   values (app.current_org_id(), 'CTL-01', 'Copias de seguridad diarias') $$, 'Crea un control');
select lives_ok($$ insert into public.control_requirements (organization_id, control_id, requirement_id)
                   select app.current_org_id(), c.id, r.id from public.controls c, public.requirements r
                    where c.code = 'CTL-01' and r.clause = 'A.5.1' $$, 'Mapea el control a un requisito');

-- ---------- Documentos: flujo con separación de funciones ----------
select lives_ok($$ insert into public.documents (organization_id, code, title, doc_type, requires_acknowledgment)
                   values (app.current_org_id(), 'POL-SI-01', 'Política de seguridad de la información', 'politica', true) $$,
                'El líder crea una política');
create temp table v1 on commit drop as select public.document_new_version(
  (select id from public.documents where code = 'POL-SI-01'), 'Primera versión') as id;
select is((select version_no from public.document_versions where id = (select id from v1)), 1, 'La primera versión es la 1');
select throws_ok($$ select public.document_transition((select id from v1), 'enviar_revision') $$,
                 '22023', null, 'No se envía a revisión sin archivo');
update public.document_versions set file_path = 'x/y/z/politica.pdf', file_name = 'politica.pdf' where id = (select id from v1);
select is(public.document_transition((select id from v1), 'enviar_revision'), 'en_revision', 'El autor envía a revisión');
select throws_ok($$ select public.document_transition((select id from v1), 'revisar') $$,
                 '42501', null, 'El autor no puede revisar su propio documento');
update public.document_versions set file_name = 'cambiado.pdf' where id = (select id from v1);
select is((select file_name from public.document_versions where id = (select id from v1)), 'politica.pdf',
          'Una versión en revisión no se puede modificar');

-- El administrador revisa, aprueba y publica
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@n.test"}', true);
select is(public.document_transition((select id from v1), 'revisar', 'Correcto'), 'revisado', 'Otra persona revisa');
select is(public.document_transition((select id from v1), 'aprobar'), 'aprobado', 'Quien tiene permiso aprueba');
select is(public.document_transition((select id from v1), 'publicar'), 'publicado', 'Se publica la versión aprobada');
select ok((select current_version_id = (select id from v1) and next_review_on > current_date
             from public.documents where code = 'POL-SI-01'), 'El documento apunta a la versión vigente y agenda su revisión');

-- ---------- Consulta: solo ve lo vigente y acepta la política ----------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","aal":"aal2","email":"consulta@n.test"}', true);
select is((select count(*)::int from public.assets), 1, 'Consulta ve los activos de su organización');
select throws_ok($$ insert into public.org_units (organization_id, unit_type, name) values (app.current_org_id(), 'area', 'No') $$,
                 '42501', null, 'Consulta no crea unidades');
select lives_ok($$ select public.acknowledge_policy((select id from v1)) $$, 'Consulta acepta la política vigente');
select is((select count(*)::int from public.policy_acknowledgments), 1, 'Ve su propia aceptación');

-- Una segunda versión en borrador no es visible para consulta
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","aal":"aal2","email":"lider@n.test"}', true);
select public.document_new_version((select id from public.documents where code = 'POL-SI-01'), 'Ajustes');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","aal":"aal2","email":"consulta@n.test"}', true);
select is((select count(*)::int from public.document_versions), 1, 'Consulta solo ve la versión publicada');

-- ---------- Otra organización no ve nada ----------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@otra.test"}', true);
select is((select count(*)::int from public.assets) + (select count(*)::int from public.documents)
          + (select count(*)::int from public.controls) + (select count(*)::int from public.requirements), 0,
          'Otra organización no ve activos, documentos, controles ni requisitos ajenos');

select * from finish();
rollback;
