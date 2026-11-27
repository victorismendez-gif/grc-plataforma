-- «Manual de usuario RPA» es una tipología propia del listado maestro, no un manual.
alter table public.documents drop constraint documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check
  check (doc_type in ('politica', 'manual', 'manual_rpa', 'procedimiento', 'instructivo', 'formato', 'plan', 'registro',
                      'anexo', 'diagrama', 'modelamiento', 'presentacion', 'protocolo', 'video', 'elearning',
                      'programa', 'infografia', 'matriz', 'reglamento', 'entorno', 'otro'));

create or replace function app.master_typology(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case regexp_replace(translate(lower(trim(coalesce(p, ''))), 'áéíóúü', 'aeiouu'), '[^a-z]', '', 'g')
    when 'macroproceso' then 'P:macroproceso'
    when 'proceso' then 'P:proceso'
    when 'subproceso' then 'P:subproceso'
    when 'politica' then 'politica'
    when 'manual' then 'manual'
    when 'manualdeusuariorpa' then 'manual_rpa'
    when 'procedimiento' then 'procedimiento'
    when 'instructivo' then 'instructivo'
    when 'formato' then 'formato'
    when 'plan' then 'plan'
    when 'registro' then 'registro'
    when 'anexo' then 'anexo'
    when 'diagrama' then 'diagrama'
    when 'modelamiento' then 'modelamiento'
    when 'presentacion' then 'presentacion'
    when 'presentaciones' then 'presentacion'
    when 'protocolo' then 'protocolo'
    when 'video' then 'video'
    when 'videos' then 'video'
    when 'elearning' then 'elearning'
    when 'programa' then 'programa'
    when 'infografia' then 'infografia'
    when 'matrizderiesgo' then 'matriz'
    when 'matriz' then 'matriz'
    when 'reglamento' then 'reglamento'
    when 'entornoempresarial' then 'entorno'
    else null
  end
$$;
