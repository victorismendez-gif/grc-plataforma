-- Maestro de procesos y documentos.
--  * Procesos: tipología (macroproceso, proceso, subproceso), proceso padre,
--    criticidad 1-5, área líder, versión y vigencia. La clasificación en el mapa
--    de procesos (estratégico, misional, apoyo, evaluación) se conserva, opcional.
--  * Documentos: más tipologías (anexo, diagrama, formato…), documento padre,
--    versión, área líder y vigencia. Cada documento queda en el proceso de su
--    cadena de padres.
--  * process_master_import: carga el listado maestro (vista previa / aplicar).

-- Procesos ------------------------------------------------------------------
alter table public.processes drop constraint processes_code_check;
alter table public.processes add constraint processes_code_check
  check (code is null or (length(code) between 1 and 60 and code !~ '^\s' and code !~ '\s$'));

alter table public.processes alter column process_type drop not null;
alter table public.processes alter column process_type drop default;
-- «apoyo» era el valor por defecto, no una clasificación elegida
update public.processes set process_type = null where process_type = 'apoyo';

alter table public.processes
  add column typology    text not null default 'proceso' check (typology in ('macroproceso', 'proceso', 'subproceso')),
  add column parent_id   uuid,
  add column criticality smallint check (criticality between 1 and 5),
  add column lead_area   text check (lead_area is null or length(lead_area) <= 160),
  add column version     text check (version is null or length(version) <= 20),
  add column valid_from  date,
  add foreign key (organization_id, parent_id) references public.processes(organization_id, id) on delete set null (parent_id);
create index processes_parent_idx on public.processes(organization_id, parent_id);

create or replace function app.processes_no_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive up as (
      select p.id, p.parent_id from public.processes p where p.id = new.parent_id
      union
      select p.id, p.parent_id from public.processes p join up on p.id = up.parent_id
    ) select 1 from up where up.id = new.id
  ) then
    raise exception 'Un proceso no puede depender de sí mismo ni de uno de sus subprocesos' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger processes_no_cycle before insert or update of parent_id on public.processes
  for each row execute function app.processes_no_cycle();

-- Documentos ----------------------------------------------------------------
alter table public.documents drop constraint documents_code_check;
alter table public.documents add constraint documents_code_check
  check (length(code) between 1 and 60 and code !~ '^\s' and code !~ '\s$');
alter table public.documents drop constraint documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check
  check (doc_type in ('politica', 'manual', 'procedimiento', 'instructivo', 'formato', 'plan', 'registro',
                      'anexo', 'diagrama', 'modelamiento', 'presentacion', 'protocolo', 'video', 'elearning',
                      'programa', 'infografia', 'matriz', 'reglamento', 'entorno', 'otro'));

alter table public.documents
  add column parent_id     uuid,
  add column version_label text check (version_label is null or length(version_label) <= 20),
  add column lead_area     text check (lead_area is null or length(lead_area) <= 160),
  add column valid_from    date,
  add foreign key (organization_id, parent_id) references public.documents(organization_id, id) on delete set null (parent_id);
create index documents_parent_idx on public.documents(organization_id, parent_id);
grant update (parent_id, version_label, lead_area, valid_from) on public.documents to authenticated;

create or replace function app.documents_no_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive up as (
      select d.id, d.parent_id from public.documents d where d.id = new.parent_id
      union
      select d.id, d.parent_id from public.documents d join up on d.id = up.parent_id
    ) select 1 from up where up.id = new.id
  ) then
    raise exception 'Un documento no puede depender de sí mismo ni de uno de sus anexos' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger documents_no_cycle before insert or update of parent_id on public.documents
  for each row execute function app.documents_no_cycle();

-- Tipología del listado maestro → proceso o tipo de documento -----------------
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
    when 'manualdeusuariorpa' then 'manual'
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

-- Carga del listado maestro ------------------------------------------------
-- p_rows: [{line, code, name, typology, parent, version, owner, area, valid_from}]
-- Los códigos repetidos: queda la última fila. Se ejecuta como definer porque
-- son miles de filas; verifica organización y permisos al inicio.
create or replace function public.process_master_import(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid := app.current_org_id();
  v_errors   jsonb := '[]'::jsonb;
  v_warn     jsonb := '[]'::jsonb;
  v_res      jsonb;
  n          int;
  i          int := 0;
begin
  if v_org is null or not (app.has_permission('assets.write') and app.has_permission('documents.write')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 10000 then
    raise exception 'El archivo debe tener entre 1 y 10.000 filas' using errcode = '22023';
  end if;

  drop table if exists pg_temp._m;
  create temp table _m on commit drop as
  select distinct on (code) *
    from (
      select (x ->> 'line')::int as line,
             regexp_replace(trim(x ->> 'code'), '\s+', '', 'g') as code,
             left(regexp_replace(trim(coalesce(x ->> 'name', '')), '\s+', ' ', 'g'), 250) as name,
             app.master_typology(x ->> 'typology') as kind,
             nullif(regexp_replace(trim(coalesce(x ->> 'parent', '')), '\s+', '', 'g'), '') as parent,
             nullif(left(trim(coalesce(x ->> 'version', '')), 20), '') as version,
             nullif(left(regexp_replace(trim(coalesce(x ->> 'owner', '')), '\s+', ' ', 'g'), 120), '') as owner,
             nullif(left(regexp_replace(trim(coalesce(x ->> 'area', '')), '\s+', ' ', 'g'), 160), '') as area,
             case when (x ->> 'valid_from') ~ '^\d{4}-\d{2}-\d{2}' then left(x ->> 'valid_from', 10)::date end as valid_from,
             x ->> 'typology' as typology_raw,
             ord
        from jsonb_array_elements(p_rows) with ordinality as t(x, ord)
    ) s
   where coalesce(code, '') <> ''
   order by code, ord desc;

  -- Validaciones
  select v_errors || coalesce(jsonb_agg(format('Fila %s: el nombre debe tener al menos 2 caracteres.', line) order by line), '[]')
    into v_errors from (select line from _m where length(name) < 2 limit 50) e;
  select v_errors || coalesce(jsonb_agg(format('Fila %s: el código %s supera 60 caracteres.', line, left(code, 70)) order by line), '[]')
    into v_errors from (select line, code from _m where length(code) > 60 limit 50) e;
  select v_errors || coalesce(jsonb_agg(format('Fila %s: tipología «%s» no reconocida.', line, coalesce(typology_raw, '')) order by line), '[]')
    into v_errors from (select line, typology_raw from _m where kind is null limit 50) e;

  -- Códigos ya usados por el otro tipo de registro (proceso ↔ documento)
  select v_errors || coalesce(jsonb_agg(format('Fila %s: %s ya existe como documento y en el archivo es un proceso.', line, code) order by line), '[]')
    into v_errors from (select m.line, m.code from _m m join public.documents d on d.organization_id = v_org and d.code = m.code
                         where m.kind like 'P:%' limit 50) e;
  select v_errors || coalesce(jsonb_agg(format('Fila %s: %s ya existe como proceso y en el archivo es un documento.', line, code) order by line), '[]')
    into v_errors from (select m.line, m.code from _m m join public.processes p on p.organization_id = v_org and p.code = m.code
                         where m.kind not like 'P:%' limit 50) e;

  -- Padres que no aparecen ni en el archivo ni en la plataforma (aviso, no error)
  select coalesce(jsonb_agg(format('%s (padre %s)', code, parent) order by code), '[]') into v_warn
    from (select m.code, m.parent from _m m
           where m.parent is not null and m.parent <> m.code
             and not exists (select 1 from _m x where x.code = m.parent)
             and not exists (select 1 from public.processes p where p.organization_id = v_org and p.code = m.parent)
             and not exists (select 1 from public.documents d where d.organization_id = v_org and d.code = m.parent)) w;

  v_res := jsonb_build_object(
    'procesos_nuevos',      (select count(*) from _m m where m.kind like 'P:%' and not exists (select 1 from public.processes p where p.organization_id = v_org and p.code = m.code)),
    'procesos_existentes',  (select count(*) from _m m where m.kind like 'P:%' and exists (select 1 from public.processes p where p.organization_id = v_org and p.code = m.code)),
    'documentos_nuevos',    (select count(*) from _m m where m.kind not like 'P:%' and not exists (select 1 from public.documents d where d.organization_id = v_org and d.code = m.code)),
    'documentos_existentes',(select count(*) from _m m where m.kind not like 'P:%' and exists (select 1 from public.documents d where d.organization_id = v_org and d.code = m.code)),
    'sin_padre',            jsonb_array_length(v_warn),
    'avisos',               (select coalesce(jsonb_agg(w), '[]') from (select w from jsonb_array_elements(v_warn) w limit 100) s),
    'errores',              (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(v_errors) e limit 200) s));

  if not p_apply or jsonb_array_length(v_errors) > 0 then
    if p_apply then
      raise exception 'El archivo tiene errores; no se aplicó ningún cambio' using errcode = '22023';
    end if;
    return v_res;
  end if;

  -- 1. Procesos
  insert into public.processes (organization_id, code, name, typology, version, owner_text, lead_area, valid_from, active)
  select v_org, m.code, left(m.name, 160), substr(m.kind, 3), m.version, m.owner, m.area, m.valid_from, true
    from _m m where m.kind like 'P:%'
  on conflict (organization_id, code) do update
     set name = excluded.name, typology = excluded.typology, version = excluded.version,
         owner_text = case when public.processes.owner_id is null then excluded.owner_text else public.processes.owner_text end,
         lead_area = excluded.lead_area, valid_from = excluded.valid_from, active = true
   where (public.processes.name, public.processes.typology, public.processes.version, public.processes.lead_area,
          public.processes.valid_from, public.processes.active, public.processes.owner_text)
         is distinct from (excluded.name, excluded.typology, excluded.version, excluded.lead_area,
                           excluded.valid_from, true,
                           case when public.processes.owner_id is null then excluded.owner_text else public.processes.owner_text end);

  -- 2. Documentos
  insert into public.documents (organization_id, code, title, doc_type, version_label, owner_text, lead_area, valid_from, active)
  select v_org, m.code, m.name, m.kind, m.version, m.owner, m.area, m.valid_from, true
    from _m m where m.kind not like 'P:%'
  on conflict (organization_id, code) do update
     set title = excluded.title, doc_type = excluded.doc_type, version_label = excluded.version_label,
         owner_text = case when public.documents.owner_id is null then excluded.owner_text else public.documents.owner_text end,
         lead_area = excluded.lead_area, valid_from = excluded.valid_from, active = true
   where (public.documents.title, public.documents.doc_type, public.documents.version_label, public.documents.lead_area,
          public.documents.valid_from, public.documents.active, public.documents.owner_text)
         is distinct from (excluded.title, excluded.doc_type, excluded.version_label, excluded.lead_area,
                           excluded.valid_from, true,
                           case when public.documents.owner_id is null then excluded.owner_text else public.documents.owner_text end);

  -- 3. Padres de los procesos (solo otro proceso; sin ciclos)
  update public.processes c set parent_id = p.id
    from _m m join public.processes p on p.organization_id = v_org and p.code = m.parent
   where m.kind like 'P:%' and m.parent is not null and m.parent <> m.code
     and c.organization_id = v_org and c.code = m.code
     and c.parent_id is distinct from p.id
     and not exists (
       with recursive up as (
         select x.id, x.parent_id from public.processes x where x.id = p.id
         union
         select x.id, x.parent_id from public.processes x join up on x.id = up.parent_id
       ) select 1 from up where up.id = c.id);

  -- 4. Documentos cuyo padre es un proceso
  update public.documents d set process_id = p.id, parent_id = null
    from _m m join public.processes p on p.organization_id = v_org and p.code = m.parent
   where m.kind not like 'P:%' and d.organization_id = v_org and d.code = m.code
     and (d.process_id, d.parent_id) is distinct from (p.id, null::uuid);

  -- 5. Documentos cuyo padre es otro documento
  update public.documents d set parent_id = pd.id
    from _m m join public.documents pd on pd.organization_id = v_org and pd.code = m.parent
   where m.kind not like 'P:%' and m.parent <> m.code
     and d.organization_id = v_org and d.code = m.code
     and d.parent_id is distinct from pd.id
     and not exists (
       with recursive up as (
         select x.id, x.parent_id from public.documents x where x.id = pd.id
         union
         select x.id, x.parent_id from public.documents x join up on x.id = up.parent_id
       ) select 1 from up where up.id = d.id);

  -- 6. Cada documento hereda el proceso de su cadena de padres
  loop
    update public.documents d set process_id = pd.process_id
      from public.documents pd
     where d.organization_id = v_org and d.parent_id = pd.id
       and pd.process_id is not null and d.process_id is distinct from pd.process_id;
    get diagnostics n = row_count;
    i := i + 1;
    exit when n = 0 or i > 10;
  end loop;

  return v_res;
end;
$$;
revoke execute on function public.process_master_import(jsonb, boolean) from public, anon;
grant execute on function public.process_master_import(jsonb, boolean) to authenticated;
revoke execute on function app.master_typology(text) from public, anon;
grant execute on function app.master_typology(text) to authenticated;

-- Resumen por proceso (respeta los permisos de quien consulta)
create view public.process_overview with (security_invoker = true) as
select p.id, p.organization_id, p.code, p.name, p.typology, p.parent_id, p.process_type, p.criticality,
       p.lead_area, p.version, p.valid_from, p.owner_id, p.owner_text, p.active,
       (select count(*) from public.documents d where d.process_id = p.id and d.active) as documents_count,
       (select count(*) from public.risk_cause_processes c where c.process_id = p.id) as causes_count,
       (select count(*) from public.assets a where a.process_id = p.id) as assets_count,
       (select count(*) from public.processes s where s.parent_id = p.id) as children_count
  from public.processes p;
grant select on public.process_overview to authenticated;
