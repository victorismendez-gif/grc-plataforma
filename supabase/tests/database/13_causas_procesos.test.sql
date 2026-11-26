-- Una causa puede tener varios procesos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

insert into auth.users (id, email, aud, role) values
  ('d3000000-0000-4000-8000-000000000001', 'admin@cpa.test', 'authenticated', 'authenticated'),
  ('d3000000-0000-4000-8000-000000000002', 'otro@cpb.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Cpa SA', 'cpa', 'd3000000-0000-4000-8000-000000000001', 'Admin');
select app.bootstrap_organization('Cpb SA', 'cpb', 'd3000000-0000-4000-8000-000000000002', 'Otro');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d3000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@cpa.test"}', true);

select is((public.risk_import('[
  {"line":2,"risk_code":"R1","risk_name":"Divulgación","cause_code":"CAU01","cause":"Errores","processes":["Nómina","Compras"]},
  {"line":3,"risk_code":"R2","risk_name":"Pérdida","cause_code":"CAU01","cause":"Errores","processes":["Nómina"]}
]'::jsonb, false) ->> 'nuevos')::int, 2, 'Vista previa con procesos');
select is((select count(*)::int from public.processes), 0, 'La vista previa no crea procesos');

select lives_ok($$ select public.risk_import('[
  {"line":2,"risk_code":"R1","risk_name":"Divulgación","cause_code":"CAU01","cause":"Errores","processes":["Nómina","Compras"]},
  {"line":3,"risk_code":"R2","risk_name":"Pérdida","cause_code":"CAU01","cause":"Errores","processes":["Nómina","Tesorería"]}
]'::jsonb, true) $$, 'Carga causas con varios procesos');
select is((select string_agg(p.name, ',' order by p.name) from public.risk_cause_processes cp join public.processes p on p.id = cp.process_id),
          'Compras,Nómina,Tesorería', 'Las filas de una misma causa suman sus procesos y crean los que faltan');
select is((select count(*)::int from public.risk_entries where process_id is not null), 0, 'El proceso ya no se guarda en el escenario');

select lives_ok($$ select public.risk_import('[{"line":2,"code":"RG-0001","processes":["Compras"]}]'::jsonb, true) $$,
                'Una carga nueva redefine los procesos de la causa');
select is((select string_agg(p.name, ',' order by p.name) from public.risk_cause_processes cp join public.processes p on p.id = cp.process_id),
          'Compras', 'Reemplaza el conjunto');

select is(jsonb_array_length(public.risk_import('[{"line":2,"risk_code":"R3","risk_name":"Sin causa","processes":["Compras"]}]'::jsonb, false) -> 'errores'), 1,
          'Sin causa no se pueden asociar procesos');

select lives_ok($$ select public.risk_import('[{"line":2,"code":"RG-0002","process":"Compras; Archivo"}]'::jsonb, true) $$,
                'Acepta el proceso como texto con varios separados por punto y coma');
select is((select string_agg(p.name, ',' order by p.name) from public.risk_cause_processes cp join public.processes p on p.id = cp.process_id),
          'Archivo,Compras', 'Separa los procesos del texto');

select set_config('request.jwt.claims', '{"sub":"d3000000-0000-4000-8000-000000000002","aal":"aal2","email":"otro@cpb.test"}', true);
select is((select count(*)::int from public.risk_cause_processes), 0, 'Aislamiento entre organizaciones');

select * from finish();
rollback;
