-- =====================================================================
-- Fase 3 · Diagnóstico GAP y plan de trabajo (23-nov-2026)
--  * Diagnóstico sobre una o varias normas con alcance (sedes, áreas,
--    procesos). Cada requisito auditable se califica: cumple, cumple
--    parcial, no cumple o no aplica, con justificación y evidencia.
--  * Requisitos comunes (equivalentes) entre normas se califican una sola
--    vez: el resto apunta al principal y hereda su estado.
--  * Calificación manual por ahora; el campo `source` y la validación por
--    una segunda persona dejan lista la IA (sugerida → validada).
--  * Plan de trabajo: una actividad por brecha, prioridad según la
--    criticidad del requisito. Planes y acciones sirven luego para
--    hallazgos de auditoría y tratamiento de riesgos (origen).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Diagnósticos
-- ---------------------------------------------------------------------
create table public.gap_assessments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  code               text not null check (code ~ '^[A-Za-z0-9._-]{2,40}$'),
  name               text not null check (length(trim(name)) between 3 and 160),
  scope_description  text check (scope_description is null or length(scope_description) <= 4000),
  leader_id          uuid,
  leader_text        text check (leader_text is null or length(leader_text) <= 120),
  status             text not null default 'en_curso' check (status in ('en_curso', 'cerrado')),
  partial_weight     numeric(3,2) not null default 0.5 check (partial_weight between 0 and 1),
  started_on         date not null default current_date,
  closed_on          date,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, leader_id) references public.profiles(organization_id, id) on delete set null (leader_id)
);

create table public.gap_assessment_frameworks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  assessment_id    uuid not null,
  framework_id     uuid not null,
  unique (assessment_id, framework_id),
  foreign key (organization_id, assessment_id) references public.gap_assessments(organization_id, id) on delete cascade,
  foreign key (organization_id, framework_id) references public.frameworks(organization_id, id) on delete restrict
);

create table public.gap_assessment_scope (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  assessment_id    uuid not null,
  unit_id          uuid,
  process_id       uuid,
  check ((unit_id is null) <> (process_id is null)),
  foreign key (organization_id, assessment_id) references public.gap_assessments(organization_id, id) on delete cascade,
  foreign key (organization_id, unit_id) references public.org_units(organization_id, id) on delete cascade,
  foreign key (organization_id, process_id) references public.processes(organization_id, id) on delete cascade
);
create unique index gap_scope_unit_uq on public.gap_assessment_scope(assessment_id, unit_id) where unit_id is not null;
create unique index gap_scope_process_uq on public.gap_assessment_scope(assessment_id, process_id) where process_id is not null;

create table public.gap_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  assessment_id    uuid not null,
  requirement_id   uuid not null,
  primary_item_id  uuid,
  status           text check (status in ('cumple', 'parcial', 'no_cumple', 'no_aplica')),
  justification    text check (justification is null or length(justification) <= 4000),
  evidence_note    text check (evidence_note is null or length(evidence_note) <= 4000),
  document_id      uuid,
  source           text not null default 'persona' check (source in ('persona', 'ia')),
  assessed_by      uuid,
  assessed_at      timestamptz,
  validated_by     uuid,
  validated_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (assessment_id, requirement_id),
  foreign key (organization_id, assessment_id) references public.gap_assessments(organization_id, id) on delete cascade,
  foreign key (organization_id, requirement_id) references public.requirements(organization_id, id) on delete cascade,
  foreign key (organization_id, primary_item_id) references public.gap_items(organization_id, id) on delete set null (primary_item_id),
  foreign key (organization_id, document_id) references public.documents(organization_id, id) on delete set null (document_id)
);
create index gap_items_assessment_idx on public.gap_items(assessment_id);
create index gap_items_primary_idx on public.gap_items(primary_item_id);

-- ---------------------------------------------------------------------
-- Planes de acción y actividades (comunes a GAP, auditoría, riesgos…)
-- ---------------------------------------------------------------------
create table public.action_plans (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  code               text not null check (code ~ '^[A-Za-z0-9._-]{2,40}$'),
  title              text not null check (length(trim(title)) between 3 and 200),
  origin             text not null default 'otro' check (origin in ('gap', 'auditoria', 'riesgo', 'tercero', 'direccion', 'otro')),
  gap_assessment_id  uuid,
  description        text check (description is null or length(description) <= 4000),
  owner_id           uuid,
  owner_text         text check (owner_text is null or length(owner_text) <= 120),
  status             text not null default 'abierto' check (status in ('abierto', 'cerrado')),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, gap_assessment_id) references public.gap_assessments(organization_id, id) on delete set null (gap_assessment_id),
  foreign key (organization_id, owner_id) references public.profiles(organization_id, id) on delete set null (owner_id)
);
create unique index action_plans_gap_uq on public.action_plans(gap_assessment_id) where gap_assessment_id is not null;

create table public.actions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  plan_id           uuid not null,
  gap_item_id       uuid,
  requirement_id    uuid,
  title             text not null check (length(trim(title)) between 3 and 300),
  description       text check (description is null or length(description) <= 4000),
  owner_id          uuid,
  owner_text        text check (owner_text is null or length(owner_text) <= 120),
  unit_id           uuid,
  process_id        uuid,
  priority          text not null default 'media' check (priority in ('alta', 'media', 'baja')),
  start_on          date,
  due_on            date,
  status            text not null default 'pendiente' check (status in ('pendiente', 'en_curso', 'terminada', 'cancelada')),
  progress          smallint not null default 0 check (progress between 0 and 100),
  closure_evidence  text check (closure_evidence is null or length(closure_evidence) <= 4000),
  completed_on      date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, id),
  check (due_on is null or start_on is null or due_on >= start_on),
  check (status <> 'terminada' or coalesce(trim(closure_evidence), '') <> ''),
  foreign key (organization_id, plan_id) references public.action_plans(organization_id, id) on delete cascade,
  foreign key (organization_id, gap_item_id) references public.gap_items(organization_id, id) on delete set null (gap_item_id),
  foreign key (organization_id, requirement_id) references public.requirements(organization_id, id) on delete set null (requirement_id),
  foreign key (organization_id, owner_id) references public.profiles(organization_id, id) on delete set null (owner_id),
  foreign key (organization_id, unit_id) references public.org_units(organization_id, id) on delete set null (unit_id),
  foreign key (organization_id, process_id) references public.processes(organization_id, id) on delete set null (process_id)
);
create index actions_plan_idx on public.actions(plan_id);
create index actions_gap_item_idx on public.actions(gap_item_id);
create index actions_due_idx on public.actions(organization_id, status, due_on);

-- ---------------------------------------------------------------------
-- Códigos legibles: GAP-2026-01, PT-2026-01
-- ---------------------------------------------------------------------
create or replace function app.next_code(p_prefix text, p_table text, p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(current_date, 'YYYY');
  v_n    int;
begin
  execute format('select count(*) + 1 from public.%I where organization_id = $1 and code like $2', p_table)
    into v_n using p_org, p_prefix || '-' || v_year || '-%';
  loop
    exit when not exists (select 1 from public.gap_assessments where organization_id = p_org and code = p_prefix || '-' || v_year || '-' || lpad(v_n::text, 2, '0'))
          and not exists (select 1 from public.action_plans where organization_id = p_org and code = p_prefix || '-' || v_year || '-' || lpad(v_n::text, 2, '0'));
    v_n := v_n + 1;
  end loop;
  return p_prefix || '-' || v_year || '-' || lpad(v_n::text, 2, '0');
end;
$$;
revoke execute on function app.next_code(text, text, uuid) from public, anon;

create or replace function app.gap_plans_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(trim(new.code), '') = '' then
    new.code := app.next_code(case tg_table_name when 'gap_assessments' then 'GAP' else 'PT' end, tg_table_name, new.organization_id);
  end if;
  return new;
end;
$$;
revoke execute on function app.gap_plans_defaults() from public, anon;
create trigger gap_assessments_defaults before insert on public.gap_assessments
  for each row execute function app.gap_plans_defaults();
create trigger action_plans_defaults before insert on public.action_plans
  for each row execute function app.gap_plans_defaults();
alter table public.gap_assessments alter column code set default '';
alter table public.action_plans alter column code set default '';

-- ---------------------------------------------------------------------
-- Reglas de la calificación
-- ---------------------------------------------------------------------
create or replace function app.gap_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select a.status into v_status from public.gap_assessments a where a.id = new.assessment_id;
  if v_status = 'cerrado' and app.current_org_id() is not null then
    raise exception 'El diagnóstico está cerrado; reábrelo para cambiar calificaciones' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and app.current_org_id() is not null then
    new.assessment_id := old.assessment_id;
    new.requirement_id := old.requirement_id;
    if current_setting('app.gap_syncing', true) is distinct from 'on' then
      new.primary_item_id := old.primary_item_id;
    end if;
    if (new.status, new.justification, new.evidence_note, new.document_id)
       is distinct from (old.status, old.justification, old.evidence_note, old.document_id) then
      if not app.has_permission('gap.write') then
        raise exception 'Sin permiso para calificar' using errcode = '42501';
      end if;
      if old.primary_item_id is not null then
        raise exception 'Este requisito es común con otra norma: se califica en el requisito principal' using errcode = '55000';
      end if;
      if new.status in ('cumple', 'parcial') and coalesce(trim(new.evidence_note), '') = '' and new.document_id is null then
        raise exception 'Para «cumple» o «cumple parcial» indica la evidencia (documento o descripción)' using errcode = '23514';
      end if;
      if new.status in ('no_aplica', 'no_cumple', 'parcial') and coalesce(trim(new.justification), '') = '' then
        raise exception 'Escribe la justificación de la calificación' using errcode = '23514';
      end if;
      new.assessed_by := auth.uid();
      new.assessed_at := now();
      new.source := 'persona';
      -- toda nueva calificación vuelve a requerir validación
      new.validated_by := null;
      new.validated_at := null;
    elsif (new.validated_by, new.validated_at) is distinct from (old.validated_by, old.validated_at)
          and current_setting('app.gap_validating', true) is distinct from 'on' then
      raise exception 'La validación se registra con la acción «Validar»' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.gap_items_guard() from public, anon;
create trigger gap_items_guard before insert or update on public.gap_items
  for each row execute function app.gap_items_guard();

-- Actividades: terminada ⇒ avance 100 y fecha de cierre
create or replace function app.actions_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'terminada' then
    new.progress := 100;
    new.completed_on := coalesce(new.completed_on, current_date);
  elsif new.status <> 'terminada' then
    new.completed_on := null;
    if new.status = 'pendiente' and new.progress = 100 then new.progress := 0; end if;
  end if;
  return new;
end;
$$;
create trigger actions_defaults before insert or update on public.actions
  for each row execute function app.actions_defaults();

-- ---------------------------------------------------------------------
-- Crear un diagnóstico con sus requisitos
-- ---------------------------------------------------------------------
create or replace function public.gap_create(
  p_name text, p_framework_ids uuid[], p_scope_description text,
  p_unit_ids uuid[], p_process_ids uuid[], p_leader_id uuid, p_leader_text text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  v_id  uuid;
begin
  if v_org is null or not app.has_permission('gap.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if coalesce(array_length(p_framework_ids, 1), 0) = 0 then
    raise exception 'Elige al menos una norma' using errcode = '22023';
  end if;
  insert into public.gap_assessments (organization_id, name, scope_description, leader_id, leader_text)
  values (v_org, trim(p_name), nullif(trim(coalesce(p_scope_description, '')), ''), p_leader_id,
          case when p_leader_id is null then nullif(trim(coalesce(p_leader_text, '')), '') end)
  returning id into v_id;
  insert into public.gap_assessment_frameworks (organization_id, assessment_id, framework_id)
  select v_org, v_id, f.id from public.frameworks f where f.id = any (p_framework_ids) and f.organization_id = v_org;
  insert into public.gap_assessment_scope (organization_id, assessment_id, unit_id)
  select v_org, v_id, u.id from public.org_units u where u.id = any (coalesce(p_unit_ids, '{}')) and u.organization_id = v_org;
  insert into public.gap_assessment_scope (organization_id, assessment_id, process_id)
  select v_org, v_id, p.id from public.processes p where p.id = any (coalesce(p_process_ids, '{}')) and p.organization_id = v_org;
  perform public.gap_sync_items(v_id);
  return v_id;
end;
$$;
revoke execute on function public.gap_create(text, uuid[], text, uuid[], uuid[], uuid, text) from public, anon;
grant execute on function public.gap_create(text, uuid[], text, uuid[], uuid[], uuid, text) to authenticated;

-- Agrega los requisitos auditables que falten (p. ej., si la norma creció)
-- y enlaza los requisitos comunes al principal (el de la primera norma).
create or replace function public.gap_sync_items(p_assessment uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  v_n   int;
begin
  if v_org is null or not app.has_permission('gap.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not exists (select 1 from public.gap_assessments a where a.id = p_assessment and a.organization_id = v_org) then
    raise exception 'Diagnóstico no encontrado' using errcode = 'P0002';
  end if;
  insert into public.gap_items (organization_id, assessment_id, requirement_id)
  select v_org, p_assessment, r.id
    from public.gap_assessment_frameworks af
    join public.requirements r on r.framework_id = af.framework_id
   where af.assessment_id = p_assessment and r.is_auditable
  on conflict (assessment_id, requirement_id) do nothing;
  get diagnostics v_n = row_count;

  -- Requisito común: el de la norma elegida primero (orden de creación) es el principal
  perform set_config('app.gap_syncing', 'on', true);
  with fw_order as (
    select af.framework_id, row_number() over (order by f.created_at, f.code) as ord
      from public.gap_assessment_frameworks af join public.frameworks f on f.id = af.framework_id
     where af.assessment_id = p_assessment
  ), it as (
    select i.id, i.requirement_id, o.ord, r.sort_key
      from public.gap_items i join public.requirements r on r.id = i.requirement_id
      join fw_order o on o.framework_id = r.framework_id
     where i.assessment_id = p_assessment
  ), pairs as (
    select a.id as item_id, b.id as other_id, b.ord as other_ord, b.sort_key as other_key, a.ord
      from it a
      join public.requirement_links l on l.relation = 'equivalente'
       and (l.requirement_a = a.requirement_id or l.requirement_b = a.requirement_id)
      join it b on b.requirement_id = case when l.requirement_a = a.requirement_id then l.requirement_b else l.requirement_a end
     where b.ord < a.ord
  ), choice as (
    select distinct on (item_id) item_id, other_id from pairs order by item_id, other_ord, other_key
  )
  update public.gap_items g set primary_item_id = c.other_id
    from choice c
   where g.id = c.item_id and g.primary_item_id is null and g.status is null;
  perform set_config('app.gap_syncing', 'off', true);
  return v_n;
end;
$$;
revoke execute on function public.gap_sync_items(uuid) from public, anon;
grant execute on function public.gap_sync_items(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Validar calificaciones (otra persona, con gap.validate)
-- ---------------------------------------------------------------------
create or replace function public.gap_validate(p_item_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  v_n   int;
begin
  if v_org is null or not app.has_permission('gap.validate') then
    raise exception 'Sin permiso para validar' using errcode = '42501';
  end if;
  if exists (select 1 from public.gap_items i where i.id = any (p_item_ids) and i.assessed_by = auth.uid()) then
    raise exception 'No puedes validar tus propias calificaciones: debe hacerlo otra persona' using errcode = '42501';
  end if;
  perform set_config('app.gap_validating', 'on', true);
  update public.gap_items i
     set validated_by = auth.uid(), validated_at = now()
   where i.id = any (p_item_ids) and i.organization_id = v_org
     and i.status is not null and i.validated_at is null and i.primary_item_id is null;
  get diagnostics v_n = row_count;
  perform set_config('app.gap_validating', 'off', true);
  return v_n;
end;
$$;
revoke execute on function public.gap_validate(uuid[]) from public, anon;
grant execute on function public.gap_validate(uuid[]) to authenticated;

-- Cerrar o reabrir el diagnóstico
create or replace function public.gap_set_status(p_assessment uuid, p_status text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if app.current_org_id() is null or not app.has_permission('gap.validate') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_status not in ('en_curso', 'cerrado') then
    raise exception 'Estado no válido' using errcode = '22023';
  end if;
  if p_status = 'cerrado' and exists (select 1 from public.gap_items i
                                        where i.assessment_id = p_assessment and i.primary_item_id is null and i.status is null) then
    raise exception 'Aún hay requisitos sin calificar' using errcode = '55000';
  end if;
  update public.gap_assessments
     set status = p_status, closed_on = case when p_status = 'cerrado' then current_date end
   where id = p_assessment;
end;
$$;
revoke execute on function public.gap_set_status(uuid, text) from public, anon;
grant execute on function public.gap_set_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Calificación desde Excel: por norma (código) + cláusula
-- ---------------------------------------------------------------------
create or replace function public.gap_import(p_assessment uuid, p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r          jsonb;
  v_item     public.gap_items;
  v_errors   jsonb := '[]'::jsonb;
  v_changes  int := 0;
  v_same     int := 0;
  v_line     int := 0;
  v_status   text;
begin
  if app.current_org_id() is null or not app.has_permission('gap.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then
    raise exception 'El archivo debe tener entre 1 y 3.000 filas' using errcode = '22023';
  end if;
  for r in select e from jsonb_array_elements(p_rows) e loop
    v_line := coalesce((r ->> 'line')::int, v_line + 1);
    select i.* into v_item
      from public.gap_items i
      join public.requirements q on q.id = i.requirement_id
      join public.frameworks f on f.id = q.framework_id
     where i.assessment_id = p_assessment
       and lower(q.clause) = lower(trim(r ->> 'clause'))
       and (coalesce(r ->> 'framework', '') = '' or lower(f.code) = lower(trim(r ->> 'framework')) or lower(f.name) = lower(trim(r ->> 'framework')))
     order by (i.primary_item_id is null) desc
     limit 1;
    if v_item.id is null then
      v_errors := v_errors || to_jsonb(format('Fila %s: la cláusula «%s» no está en este diagnóstico.', v_line, r ->> 'clause'));
      continue;
    end if;
    if v_item.primary_item_id is not null then
      continue; -- requisito común: se toma la fila del principal
    end if;
    v_status := nullif(r ->> 'status', '');
    if (v_item.status, v_item.justification, v_item.evidence_note)
       is not distinct from (v_status, nullif(r ->> 'justification', ''), nullif(r ->> 'evidence_note', '')) then
      v_same := v_same + 1;
      continue;
    end if;
    if v_status in ('cumple', 'parcial') and coalesce(r ->> 'evidence_note', '') = '' and v_item.document_id is null then
      v_errors := v_errors || to_jsonb(format('Fila %s (%s): «cumple» o «cumple parcial» requiere evidencia.', v_line, r ->> 'clause'));
      continue;
    end if;
    if v_status in ('no_aplica', 'no_cumple', 'parcial') and coalesce(r ->> 'justification', '') = '' then
      v_errors := v_errors || to_jsonb(format('Fila %s (%s): falta la justificación.', v_line, r ->> 'clause'));
      continue;
    end if;
    v_changes := v_changes + 1;
    if p_apply then
      update public.gap_items
         set status = v_status, justification = nullif(r ->> 'justification', ''), evidence_note = nullif(r ->> 'evidence_note', '')
       where id = v_item.id;
    end if;
  end loop;
  if p_apply and jsonb_array_length(v_errors) > 0 then
    raise exception 'El archivo tiene errores; no se aplicó ningún cambio' using errcode = '22023';
  end if;
  return jsonb_build_object('cambios', v_changes, 'sin_cambios', v_same, 'errores', v_errors);
end;
$$;
revoke execute on function public.gap_import(uuid, jsonb, boolean) from public, anon;
grant execute on function public.gap_import(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Generar el plan de trabajo: una actividad por brecha
-- ---------------------------------------------------------------------
create or replace function public.gap_generate_plan(p_assessment uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org  uuid := app.current_org_id();
  v_plan uuid;
  v_name text;
  v_n    int;
begin
  if v_org is null or not app.has_permission('plans.write') or not app.has_permission('gap.read') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select a.name into v_name from public.gap_assessments a where a.id = p_assessment;
  if v_name is null then
    raise exception 'Diagnóstico no encontrado' using errcode = 'P0002';
  end if;
  select p.id into v_plan from public.action_plans p where p.gap_assessment_id = p_assessment;
  if v_plan is null then
    insert into public.action_plans (organization_id, title, origin, gap_assessment_id, description)
    values (v_org, left('Plan de trabajo · ' || v_name, 200), 'gap', p_assessment,
            'Generado desde el diagnóstico GAP: una actividad por cada requisito que no cumple o cumple parcialmente.')
    returning id into v_plan;
  end if;
  insert into public.actions (organization_id, plan_id, gap_item_id, requirement_id, title, description, priority, start_on, due_on)
  select v_org, v_plan, i.id, q.id,
         left(case i.status when 'no_cumple' then 'Implementar ' else 'Completar ' end
              || q.clause || ' · ' || q.title, 300),
         left(concat_ws(E'\n',
              'Brecha: ' || case i.status when 'no_cumple' then 'no cumple' else 'cumple parcialmente' end || ' (' || f.name || ').',
              case when i.justification is not null then 'Situación actual: ' || i.justification end,
              case when q.evidence_guidance is not null then 'Evidencia esperada: ' || q.evidence_guidance end), 4000),
         case when q.criticality = 3 or (q.criticality = 2 and i.status = 'no_cumple') then 'alta'
              when q.criticality = 2 or i.status = 'no_cumple' then 'media' else 'baja' end,
         current_date,
         current_date + case when q.criticality = 3 or (q.criticality = 2 and i.status = 'no_cumple') then 60
                             when q.criticality = 2 or i.status = 'no_cumple' then 120 else 180 end
    from public.gap_items i
    join public.requirements q on q.id = i.requirement_id
    join public.frameworks f on f.id = q.framework_id
   where i.assessment_id = p_assessment and i.primary_item_id is null
     and i.status in ('no_cumple', 'parcial')
     and not exists (select 1 from public.actions x where x.gap_item_id = i.id and x.status <> 'cancelada')
   order by q.criticality desc, f.code, q.sort_key;
  get diagnostics v_n = row_count;
  return jsonb_build_object('plan_id', v_plan, 'nuevas', v_n);
end;
$$;
revoke execute on function public.gap_generate_plan(uuid) from public, anon;
grant execute on function public.gap_generate_plan(uuid) to authenticated;

-- Requisito raíz (cláusula principal) de un requisito
create or replace function app.requirement_root(p_id uuid)
returns uuid
language sql stable
security invoker
set search_path = ''
as $$
  with recursive up as (
    select r.id, r.parent_id, 0 as depth from public.requirements r where r.id = p_id
    union all
    select r.id, r.parent_id, up.depth + 1 from public.requirements r join up on r.id = up.parent_id where up.depth < 20
  )
  select id from up where parent_id is null limit 1;
$$;
grant execute on function app.requirement_root(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Vista: estado efectivo (los requisitos comunes heredan del principal)
-- ---------------------------------------------------------------------
create view public.gap_items_effective with (security_invoker = true) as
select i.id, i.organization_id, i.assessment_id, i.requirement_id, i.primary_item_id,
       coalesce(p.status, i.status) as status,
       coalesce(p.justification, i.justification) as justification,
       coalesce(p.evidence_note, i.evidence_note) as evidence_note,
       coalesce(p.document_id, i.document_id) as document_id,
       coalesce(p.source, i.source) as source,
       coalesce(p.assessed_by, i.assessed_by) as assessed_by,
       coalesce(p.assessed_at, i.assessed_at) as assessed_at,
       coalesce(p.validated_by, i.validated_by) as validated_by,
       coalesce(p.validated_at, i.validated_at) as validated_at,
       q.framework_id, q.clause, q.title, q.description, q.evidence_guidance, q.criticality, q.sort_key,
       coalesce(top.clause, q.clause) as top_clause, coalesce(top.title, q.title) as top_title,
       exists (select 1 from public.actions a where a.gap_item_id = coalesce(p.id, i.id) and a.status <> 'cancelada') as has_action,
       (exists (select 1 from public.actions a where a.gap_item_id = coalesce(p.id, i.id) and a.status <> 'cancelada')
        and not exists (select 1 from public.actions a where a.gap_item_id = coalesce(p.id, i.id) and a.status in ('pendiente', 'en_curso'))) as gap_closed
  from public.gap_items i
  join public.requirements q on q.id = i.requirement_id
  left join public.gap_items p on p.id = i.primary_item_id
  left join public.requirements top on top.id = app.requirement_root(q.id) and top.id <> q.id;
grant select on public.gap_items_effective to authenticated;

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('gap_assessments',           'gap.read',   'gap.write'),
      ('gap_assessment_frameworks', 'gap.read',   'gap.write'),
      ('gap_assessment_scope',      'gap.read',   'gap.write'),
      ('gap_items',                 'gap.read',   'gap.write'),
      ('action_plans',              'plans.read', 'plans.write'),
      ('actions',                   'plans.read', 'plans.write')
    ) as t(tbl, rp, wp)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('revoke all on public.%I from anon', r.tbl);
    execute format('revoke truncate on public.%I from authenticated', r.tbl);
    execute format($p$create policy %I on public.%I for select to authenticated
                     using (organization_id = (select app.current_org_id()) and (select app.has_permission(%L)))$p$,
                   r.tbl || '_select', r.tbl, r.rp);
    execute format($p$create policy %I on public.%I for insert to authenticated
                     with check (organization_id = (select app.current_org_id()) and (select app.has_permission(%L)))$p$,
                   r.tbl || '_insert', r.tbl, r.wp);
    execute format($p$create policy %I on public.%I for update to authenticated
                     using (organization_id = (select app.current_org_id()) and (select app.has_permission(%L)))
                     with check (organization_id = (select app.current_org_id()))$p$,
                   r.tbl || '_update', r.tbl, r.wp);
    execute format($p$create policy %I on public.%I for delete to authenticated
                     using (organization_id = (select app.current_org_id()) and (select app.has_permission(%L)))$p$,
                   r.tbl || '_delete', r.tbl, r.wp);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_trigger()',
                   r.tbl || '_audit', r.tbl);
  end loop;
end $$;

-- La validación solo con gap_validate; las calificaciones no se borran una a una
create policy gap_items_validate on public.gap_items for update to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('gap.validate')))
  with check (organization_id = (select app.current_org_id()));
revoke update, delete on public.gap_items from authenticated;
grant update (status, justification, evidence_note, document_id, validated_by, validated_at) on public.gap_items to authenticated;
revoke update on public.gap_assessments from authenticated;
grant update (name, scope_description, leader_id, leader_text, partial_weight, status, closed_on) on public.gap_assessments to authenticated;
-- cerrar/reabrir solo con gap_set_status (requiere gap.validate)
create or replace function app.gap_assessments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_org_id() is not null and (new.status, new.closed_on) is distinct from (old.status, old.closed_on)
     and not app.has_permission('gap.validate') then
    raise exception 'Solo quien valida el GAP puede cerrarlo o reabrirlo' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function app.gap_assessments_guard() from public, anon;
create trigger gap_assessments_guard before update on public.gap_assessments
  for each row execute function app.gap_assessments_guard();

revoke update on public.actions from authenticated;
grant update (title, description, owner_id, owner_text, unit_id, process_id, priority, start_on, due_on, status,
              progress, closure_evidence, completed_on) on public.actions to authenticated;
revoke update on public.action_plans from authenticated;
grant update (title, description, owner_id, owner_text, status) on public.action_plans to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['gap_assessments', 'gap_items', 'action_plans', 'actions'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
                   t || '_touch', t);
  end loop;
end $$;
