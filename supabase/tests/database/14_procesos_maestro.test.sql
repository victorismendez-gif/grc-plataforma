-- Maestro de procesos y documentos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, aud, role) values
  ('d4000000-0000-4000-8000-000000000001', 'admin@pma.test', 'authenticated', 'authenticated'),
  ('d4000000-0000-4000-8000-000000000002', 'otro@pmb.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Pma SA', 'pma', 'd4000000-0000-4000-8000-000000000001', 'Admin');
select app.bootstrap_organization('Pmb SA', 'pmb', 'd4000000-0000-4000-8000-000000000002', 'Otro');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@pma.test"}', true);

-- Un proceso que ya existía (creado desde riesgos) con el valor por defecto
insert into public.processes (organization_id, code, name) values (app.current_org_id(), 'PROC-GSI-004', 'Nombre viejo');

create temp table rows_m as select '[
  {"line":2,"code":"MCPR-TI-001","name":"Gestión de TI","typology":"Macroproceso"},
  {"line":3,"code":"PROC-GSI-004","name":"Gestión de solicitudes de seguridad ","typology":"Proceso","parent":"MCPR-TI-001","version":"2","area":"DIRECCIÓN IT","valid_from":"2024-05-01"},
  {"line":4,"code":"SUBP-GSI-005","name":"Gestión de riesgos IT","typology":"Subproceso","parent":"PROC-GSI-004"},
  {"line":5,"code":"POLT-GSI-001","name":"Política de seguridad","typology":"Política","parent":"PROC-GSI-004"},
  {"line":6,"code":"A-POLT-GSI-001-01","name":"Anexo de la política","typology":"Anexo","parent":"POLT-GSI-001"},
  {"line":7,"code":"F-A-POLT-GSI-001-01","name":"Formato del anexo","typology":"Formato","parent":"A-POLT-GSI-001-01"},
  {"line":8,"code":"D-SUBP-DO&M-003-01","name":"Diagrama huérfano","typology":"Diagrama","parent":"SUBP-DO&M-003"},
  {"line":9,"code":"V-01","name":"Video","typology":"Videos ","parent":"SUBP-GSI-005"}
]'::jsonb as j;
grant select on rows_m to authenticated;

select is((public.process_master_import((select j from rows_m), false) ->> 'procesos_nuevos')::int, 2, 'Vista previa: procesos nuevos');
select is((public.process_master_import((select j from rows_m), false) ->> 'sin_padre')::int, 1, 'Vista previa: avisa padres que no existen');
select is((select count(*)::int from public.documents), 0, 'La vista previa no escribe');

select lives_ok($$ select public.process_master_import((select j from rows_m), true) $$, 'Aplica el maestro');
select is((select name || '|' || typology || '|' || version || '|' || lead_area from public.processes where code = 'PROC-GSI-004'),
          'Gestión de solicitudes de seguridad|proceso|2|DIRECCIÓN IT', 'Actualiza el proceso existente por código');
select is((select p.code from public.processes c join public.processes p on p.id = c.parent_id where c.code = 'SUBP-GSI-005'), 'PROC-GSI-004', 'Subproceso con su proceso padre');
select is((select p.code from public.processes c join public.processes p on p.id = c.parent_id where c.code = 'PROC-GSI-004'), 'MCPR-TI-001', 'Proceso con su macroproceso');
select is((select pr.code from public.documents d join public.processes pr on pr.id = d.process_id where d.code = 'POLT-GSI-001'), 'PROC-GSI-004', 'Documento cuyo padre es un proceso');
select is((select pd.code from public.documents d join public.documents pd on pd.id = d.parent_id where d.code = 'A-POLT-GSI-001-01'), 'POLT-GSI-001', 'Anexo con su documento padre');
select is((select pr.code from public.documents d join public.processes pr on pr.id = d.process_id where d.code = 'F-A-POLT-GSI-001-01'), 'PROC-GSI-004', 'El proceso se hereda por la cadena de padres');
select is((select doc_type from public.documents where code = 'V-01'), 'video', 'Tipología con plural y espacios');
select is((select count(*)::int from public.documents where code = 'D-SUBP-DO&M-003-01' and process_id is null), 1, 'Admite códigos con & y queda sin proceso si el padre no existe');

select is(jsonb_array_length(public.process_master_import('[{"line":2,"code":"X-1","name":"Algo","typology":"Nevera"}]', false) -> 'errores'), 1, 'Rechaza tipologías desconocidas');
select throws_ok($$ update public.processes set parent_id = (select id from public.processes where code = 'SUBP-GSI-005') where code = 'PROC-GSI-004' $$,
                 '23514', null, 'Sin ciclos entre procesos');
select lives_ok($$ select public.process_master_import((select j from rows_m), true) $$, 'Cargar dos veces no falla');

select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-000000000002","aal":"aal2","email":"otro@pmb.test"}', true);
select is((select count(*)::int from public.documents), 0, 'Aislamiento entre organizaciones');

select * from finish();
rollback;
