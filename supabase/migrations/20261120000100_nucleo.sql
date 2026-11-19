-- =====================================================================
-- Fase 2 · Núcleo: estructura, activos, normas y requisitos, controles,
-- gestión documental y políticas.
-- Todas las tablas llevan organization_id, RLS y trazabilidad.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
-- Clave de orden natural para cláusulas ("4.10" después de "4.9", "A.5.2")
create or replace function app.natural_key(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select coalesce(string_agg(case when part ~ '^\d+$' then lpad(part, 6, '0') else lower(part) end, '.' order by ord), '')
  from regexp_split_to_table(coalesce(p, ''), '\.') with ordinality as t(part, ord)
$$;

-- ---------------------------------------------------------------------
-- Catálogos parametrizables por organización
-- ---------------------------------------------------------------------
create table public.catalog_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  catalog          text not null check (catalog in ('asset_type', 'info_classification')),
  code             text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  label            text not null check (length(trim(label)) between 1 and 80),
  sort_order       int not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, catalog, code),
  unique (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Estructura organizacional
-- ---------------------------------------------------------------------
create table public.org_units (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  parent_id        uuid,
  unit_type        text not null check (unit_type in ('sede', 'sucursal', 'tienda', 'area', 'otra')),
  code             text check (code is null or code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name             text not null check (length(trim(name)) between 2 and 120),
  employees        int check (employees is null or employees >= 0),
  manager_id       uuid,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, parent_id) references public.org_units(organization_id, id) on delete restrict,
  foreign key (organization_id, manager_id) references public.profiles(organization_id, id) on delete set null (manager_id),
  check (parent_id is null or parent_id <> id)
);
create index org_units_parent_idx on public.org_units(organization_id, parent_id);
create index org_units_manager_idx on public.org_units(organization_id, manager_id);

-- Evita ciclos en la jerarquía
create or replace function app.org_units_no_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive up as (
      select u.id, u.parent_id from public.org_units u where u.id = new.parent_id
      union all
      select u.id, u.parent_id from public.org_units u join up on u.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'La unidad no puede depender de sí misma ni de una de sus subordinadas' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger org_units_no_cycle before insert or update of parent_id on public.org_units
  for each row execute function app.org_units_no_cycle();

create table public.processes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text check (code is null or code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name             text not null check (length(trim(name)) between 2 and 160),
  process_type     text not null default 'apoyo' check (process_type in ('estrategico', 'misional', 'apoyo', 'evaluacion')),
  owner_id         uuid,
  description      text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, owner_id) references public.profiles(organization_id, id) on delete set null (owner_id)
);
create index processes_owner_idx on public.processes(organization_id, owner_id);

create table public.process_units (
  organization_id  uuid not null,
  process_id       uuid not null,
  unit_id          uuid not null,
  primary key (process_id, unit_id),
  foreign key (organization_id, process_id) references public.processes(organization_id, id) on delete cascade,
  foreign key (organization_id, unit_id) references public.org_units(organization_id, id) on delete cascade
);
create index process_units_unit_idx on public.process_units(organization_id, unit_id);

-- ---------------------------------------------------------------------
-- Activos de información
-- ---------------------------------------------------------------------
create table public.assets (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  code               text not null check (length(trim(code)) between 1 and 60),
  name               text not null check (length(trim(name)) between 1 and 200),
  asset_type_id      uuid not null,
  description        text,
  owner_id           uuid,
  custodian          text,
  unit_id            uuid,
  location           text,
  classification_id  uuid,
  confidentiality    smallint check (confidentiality between 1 and 3),
  integrity          smallint check (integrity between 1 and 3),
  availability       smallint check (availability between 1 and 3),
  criticality        smallint generated always as (greatest(confidentiality, integrity, availability)) stored,
  status             text not null default 'activo' check (status in ('activo', 'en_reparacion', 'dado_de_baja', 'perdido')),
  brand              text,
  model              text,
  serial_number      text,
  acquired_on        date,
  attributes         jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  last_import_id     uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, asset_type_id) references public.catalog_items(organization_id, id) on delete restrict,
  foreign key (organization_id, classification_id) references public.catalog_items(organization_id, id) on delete restrict,
  foreign key (organization_id, owner_id) references public.profiles(organization_id, id) on delete set null (owner_id),
  foreign key (organization_id, unit_id) references public.org_units(organization_id, id) on delete set null (unit_id)
);
create index assets_type_idx on public.assets(organization_id, asset_type_id);
create index assets_class_idx on public.assets(organization_id, classification_id);
create index assets_owner_idx on public.assets(organization_id, owner_id);
create index assets_unit_idx on public.assets(organization_id, unit_id);

create table public.asset_processes (
  organization_id  uuid not null,
  asset_id         uuid not null,
  process_id       uuid not null,
  primary key (asset_id, process_id),
  foreign key (organization_id, asset_id) references public.assets(organization_id, id) on delete cascade,
  foreign key (organization_id, process_id) references public.processes(organization_id, id) on delete cascade
);
create index asset_processes_process_idx on public.asset_processes(organization_id, process_id);

-- Historial de cargas masivas (diferencias mes a mes)
create table public.asset_imports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  file_name        text not null,
  imported_by      uuid,
  created_at       timestamptz not null default now(),
  total_rows       int not null default 0,
  created_count    int not null default 0,
  updated_count    int not null default 0,
  unchanged_count  int not null default 0,
  missing_count    int not null default 0,
  error_count      int not null default 0,
  details          jsonb not null default '{}'::jsonb,
  unique (organization_id, id),
  foreign key (organization_id, imported_by) references public.profiles(organization_id, id) on delete set null (imported_by)
);
create index asset_imports_by_idx on public.asset_imports(organization_id, imported_by);
alter table public.assets
  add constraint assets_last_import_fkey foreign key (organization_id, last_import_id)
  references public.asset_imports(organization_id, id) on delete set null (last_import_id);
create index assets_last_import_idx on public.assets(organization_id, last_import_id);

-- ---------------------------------------------------------------------
-- Normas, requisitos y equivalencias
-- ---------------------------------------------------------------------
create table public.frameworks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text not null check (code ~ '^[A-Za-z0-9._-]{2,40}$'),
  name             text not null check (length(trim(name)) between 2 and 160),
  version          text not null default '',
  framework_type   text not null default 'certificable' check (framework_type in ('certificable', 'referencia', 'legal', 'interno')),
  description      text,
  source           text not null default 'manual' check (source in ('manual', 'importado', 'plantilla')),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code, version)
);

create table public.requirements (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  framework_id       uuid not null,
  parent_id          uuid,
  clause             text not null check (length(trim(clause)) between 1 and 30),
  title              text not null check (length(trim(title)) between 1 and 300),
  description        text,
  evidence_guidance  text,
  criticality        smallint not null default 2 check (criticality between 1 and 3),
  is_auditable       boolean not null default true,
  sort_key           text generated always as (app.natural_key(clause)) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, id),
  unique (framework_id, clause),
  foreign key (organization_id, framework_id) references public.frameworks(organization_id, id) on delete cascade,
  foreign key (organization_id, parent_id) references public.requirements(organization_id, id) on delete set null (parent_id)
);
create index requirements_fw_idx on public.requirements(organization_id, framework_id, sort_key);
create index requirements_parent_idx on public.requirements(organization_id, parent_id);

-- Equivalencias entre requisitos de distintas normas (Anexo SL / mapeo cruzado)
create table public.requirement_links (
  organization_id  uuid not null,
  requirement_a    uuid not null,
  requirement_b    uuid not null,
  relation         text not null default 'equivalente' check (relation in ('equivalente', 'relacionado')),
  created_at       timestamptz not null default now(),
  primary key (requirement_a, requirement_b),
  check (requirement_a < requirement_b),
  foreign key (organization_id, requirement_a) references public.requirements(organization_id, id) on delete cascade,
  foreign key (organization_id, requirement_b) references public.requirements(organization_id, id) on delete cascade
);
create index requirement_links_b_idx on public.requirement_links(organization_id, requirement_b);

-- ---------------------------------------------------------------------
-- Controles
-- ---------------------------------------------------------------------
create table public.controls (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  code                   text not null check (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name                   text not null check (length(trim(name)) between 2 and 200),
  description            text,
  control_type           text not null default 'preventivo' check (control_type in ('preventivo', 'detectivo', 'correctivo')),
  nature                 text not null default 'manual' check (nature in ('manual', 'automatico', 'semiautomatico')),
  frequency              text not null default 'continuo' check (frequency in ('continuo', 'diario', 'semanal', 'mensual', 'trimestral', 'semestral', 'anual', 'por_evento')),
  owner_id               uuid,
  process_id             uuid,
  implementation_status  text not null default 'planeado' check (implementation_status in ('planeado', 'en_implementacion', 'implementado', 'no_aplica')),
  design_rating          smallint check (design_rating between 1 and 3),
  effectiveness_rating   smallint check (effectiveness_rating between 1 and 3),
  last_evaluated_on      date,
  evidence_notes         text,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, owner_id) references public.profiles(organization_id, id) on delete set null (owner_id),
  foreign key (organization_id, process_id) references public.processes(organization_id, id) on delete set null (process_id)
);
create index controls_owner_idx on public.controls(organization_id, owner_id);
create index controls_process_idx on public.controls(organization_id, process_id);

create table public.control_requirements (
  organization_id  uuid not null,
  control_id       uuid not null,
  requirement_id   uuid not null,
  primary key (control_id, requirement_id),
  foreign key (organization_id, control_id) references public.controls(organization_id, id) on delete cascade,
  foreign key (organization_id, requirement_id) references public.requirements(organization_id, id) on delete cascade
);
create index control_requirements_req_idx on public.control_requirements(organization_id, requirement_id);

create table public.control_assets (
  organization_id  uuid not null,
  control_id       uuid not null,
  asset_id         uuid not null,
  primary key (control_id, asset_id),
  foreign key (organization_id, control_id) references public.controls(organization_id, id) on delete cascade,
  foreign key (organization_id, asset_id) references public.assets(organization_id, id) on delete cascade
);
create index control_assets_asset_idx on public.control_assets(organization_id, asset_id);

-- ---------------------------------------------------------------------
-- Gestión documental y políticas
-- ---------------------------------------------------------------------
create table public.documents (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  code                     text not null check (code ~ '^[A-Za-z0-9._-]{1,40}$'),
  title                    text not null check (length(trim(title)) between 2 and 250),
  doc_type                 text not null check (doc_type in ('politica', 'manual', 'procedimiento', 'instructivo', 'formato', 'plan', 'registro', 'otro')),
  description              text,
  process_id               uuid,
  owner_id                 uuid,
  classification_id        uuid,
  review_months            smallint not null default 12 check (review_months between 1 and 60),
  requires_acknowledgment  boolean not null default false,
  current_version_id       uuid,
  next_review_on           date,
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, process_id) references public.processes(organization_id, id) on delete set null (process_id),
  foreign key (organization_id, owner_id) references public.profiles(organization_id, id) on delete set null (owner_id),
  foreign key (organization_id, classification_id) references public.catalog_items(organization_id, id) on delete restrict
);
create index documents_process_idx on public.documents(organization_id, process_id);
create index documents_owner_idx on public.documents(organization_id, owner_id);
create index documents_class_idx on public.documents(organization_id, classification_id);

create table public.document_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  document_id      uuid not null,
  version_no       int not null check (version_no > 0),
  status           text not null default 'borrador'
                   check (status in ('borrador', 'en_revision', 'revisado', 'aprobado', 'publicado', 'obsoleto')),
  change_summary   text,
  file_path        text,
  file_name        text,
  file_size        bigint check (file_size is null or file_size >= 0),
  file_sha256      text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type        text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_notes     text,
  approved_by      uuid,
  approved_at      timestamptz,
  published_at     timestamptz,
  obsoleted_at     timestamptz,
  unique (organization_id, id),
  unique (document_id, version_no),
  foreign key (organization_id, document_id) references public.documents(organization_id, id) on delete cascade,
  foreign key (organization_id, created_by) references public.profiles(organization_id, id) on delete set null (created_by),
  foreign key (organization_id, reviewed_by) references public.profiles(organization_id, id) on delete set null (reviewed_by),
  foreign key (organization_id, approved_by) references public.profiles(organization_id, id) on delete set null (approved_by)
);
create index document_versions_doc_idx on public.document_versions(organization_id, document_id);
create index document_versions_created_by_idx on public.document_versions(organization_id, created_by);
create index document_versions_reviewed_by_idx on public.document_versions(organization_id, reviewed_by);
create index document_versions_approved_by_idx on public.document_versions(organization_id, approved_by);
create unique index document_versions_one_published on public.document_versions(document_id) where status = 'publicado';
create unique index document_versions_one_open on public.document_versions(document_id)
  where status in ('borrador', 'en_revision', 'revisado', 'aprobado');

alter table public.documents
  add constraint documents_current_version_fkey foreign key (organization_id, current_version_id)
  references public.document_versions(organization_id, id) on delete set null (current_version_id);
create index documents_current_version_idx on public.documents(organization_id, current_version_id);

create table public.document_requirements (
  organization_id  uuid not null,
  document_id      uuid not null,
  requirement_id   uuid not null,
  primary key (document_id, requirement_id),
  foreign key (organization_id, document_id) references public.documents(organization_id, id) on delete cascade,
  foreign key (organization_id, requirement_id) references public.requirements(organization_id, id) on delete cascade
);
create index document_requirements_req_idx on public.document_requirements(organization_id, requirement_id);

create table public.policy_acknowledgments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  document_version_id  uuid not null,
  user_id              uuid not null,
  acknowledged_at      timestamptz not null default now(),
  unique (document_version_id, user_id),
  foreign key (organization_id, document_version_id) references public.document_versions(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id) references public.profiles(organization_id, id) on delete cascade
);
create index policy_ack_user_idx on public.policy_acknowledgments(organization_id, user_id);

-- ---------------------------------------------------------------------
-- Alcance de roles (Fase 1 dejó las columnas sin llave foránea)
-- ---------------------------------------------------------------------
alter table public.user_roles
  add constraint user_roles_scope_unit_fkey foreign key (organization_id, scope_unit_id)
    references public.org_units(organization_id, id) on delete cascade,
  add constraint user_roles_scope_framework_fkey foreign key (organization_id, scope_framework_id)
    references public.frameworks(organization_id, id) on delete cascade;
create index user_roles_scope_unit_idx on public.user_roles(organization_id, scope_unit_id);
create index user_roles_scope_fw_idx on public.user_roles(organization_id, scope_framework_id);
-- Índices sugeridos por el asesor de rendimiento (llaves foráneas compuestas)
create index user_roles_org_role_idx on public.user_roles(organization_id, role_id);
create index user_roles_org_user_idx on public.user_roles(organization_id, user_id);
create index role_permissions_org_role_idx on public.role_permissions(organization_id, role_id);
create index role_permissions_code_idx on public.role_permissions(permission_code);

-- ---------------------------------------------------------------------
-- Flujo documental: elaborar → revisar → aprobar → publicar
-- Las transiciones solo ocurren por esta función, que aplica permisos y
-- separación de funciones (quien elabora no revisa ni aprueba).
-- ---------------------------------------------------------------------
create or replace function public.document_transition(p_version_id uuid, p_action text, p_notes text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid := app.current_org_id();
  v_uid  uuid := auth.uid();
  v      public.document_versions%rowtype;
  d      public.documents%rowtype;
begin
  if v_org is null then
    raise exception 'Sin sesión completa' using errcode = '42501';
  end if;
  select * into v from public.document_versions where id = p_version_id and organization_id = v_org for update;
  if not found then
    raise exception 'Versión no encontrada' using errcode = 'P0002';
  end if;
  select * into d from public.documents where id = v.document_id;

  if p_action = 'enviar_revision' then
    if not app.has_permission('documents.write') then raise exception 'Sin permiso' using errcode = '42501'; end if;
    if v.status <> 'borrador' then raise exception 'Solo un borrador se envía a revisión' using errcode = '22023'; end if;
    if v.file_path is null then raise exception 'Carga el archivo antes de enviar a revisión' using errcode = '22023'; end if;
    update public.document_versions set status = 'en_revision', submitted_at = now(), review_notes = null where id = v.id;

  elsif p_action = 'revisar' then
    if not app.has_permission('documents.write') then raise exception 'Sin permiso' using errcode = '42501'; end if;
    if v.status <> 'en_revision' then raise exception 'La versión no está en revisión' using errcode = '22023'; end if;
    if v.created_by = v_uid then raise exception 'Quien elabora no puede revisar su propio documento' using errcode = '42501'; end if;
    update public.document_versions set status = 'revisado', reviewed_by = v_uid, reviewed_at = now(), review_notes = p_notes where id = v.id;

  elsif p_action = 'devolver' then
    if not (app.has_permission('documents.write') or app.has_permission('documents.approve')) then
      raise exception 'Sin permiso' using errcode = '42501';
    end if;
    if v.status not in ('en_revision', 'revisado', 'aprobado') then raise exception 'No hay nada que devolver' using errcode = '22023'; end if;
    if coalesce(trim(p_notes), '') = '' then raise exception 'Explica por qué se devuelve' using errcode = '22023'; end if;
    update public.document_versions
       set status = 'borrador', review_notes = p_notes, reviewed_by = null, reviewed_at = null,
           approved_by = null, approved_at = null, submitted_at = null
     where id = v.id;

  elsif p_action = 'aprobar' then
    if not app.has_permission('documents.approve') then raise exception 'Sin permiso' using errcode = '42501'; end if;
    if v.status <> 'revisado' then raise exception 'Solo se aprueba una versión revisada' using errcode = '22023'; end if;
    if v.created_by = v_uid then raise exception 'Quien elabora no puede aprobar su propio documento' using errcode = '42501'; end if;
    update public.document_versions set status = 'aprobado', approved_by = v_uid, approved_at = now() where id = v.id;

  elsif p_action = 'publicar' then
    if not app.has_permission('documents.approve') then raise exception 'Sin permiso' using errcode = '42501'; end if;
    if v.status <> 'aprobado' then raise exception 'Solo se publica una versión aprobada' using errcode = '22023'; end if;
    update public.document_versions set status = 'obsoleto', obsoleted_at = now()
     where document_id = v.document_id and status = 'publicado';
    update public.document_versions set status = 'publicado', published_at = now() where id = v.id;
    update public.documents
       set current_version_id = v.id,
           next_review_on = (current_date + make_interval(months => d.review_months))::date
     where id = v.document_id;

  else
    raise exception 'Acción no válida' using errcode = '22023';
  end if;

  return (select status from public.document_versions where id = v.id);
end;
$$;
revoke execute on function public.document_transition(uuid, text, text) from public, anon;
grant execute on function public.document_transition(uuid, text, text) to authenticated;

-- Nueva versión (borrador) de un documento: número consecutivo y autor
create or replace function public.document_new_version(p_document_id uuid, p_change_summary text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  v_id  uuid;
begin
  if v_org is null or not app.has_permission('documents.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not exists (select 1 from public.documents where id = p_document_id and organization_id = v_org and active) then
    raise exception 'Documento no encontrado o inactivo' using errcode = 'P0002';
  end if;
  insert into public.document_versions (organization_id, document_id, version_no, change_summary, created_by)
  select v_org, p_document_id, coalesce(max(version_no), 0) + 1, nullif(trim(p_change_summary), ''), auth.uid()
    from public.document_versions where document_id = p_document_id
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Ya hay una versión en curso para este documento' using errcode = '23505';
end;
$$;
revoke execute on function public.document_new_version(uuid, text) from public, anon;
grant execute on function public.document_new_version(uuid, text) to authenticated;

-- Aceptación de políticas por el propio usuario
create or replace function public.acknowledge_policy(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
begin
  if v_org is null or not app.has_permission('documents.read') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.document_versions v join public.documents d on d.id = v.document_id
     where v.id = p_version_id and v.organization_id = v_org and v.status = 'publicado' and d.requires_acknowledgment
  ) then
    raise exception 'La política no está vigente o no requiere aceptación' using errcode = '22023';
  end if;
  insert into public.policy_acknowledgments (organization_id, document_version_id, user_id)
  values (v_org, p_version_id, auth.uid())
  on conflict (document_version_id, user_id) do nothing;
end;
$$;
revoke execute on function public.acknowledge_policy(uuid) from public, anon;
grant execute on function public.acknowledge_policy(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Catálogos iniciales de cada organización
-- ---------------------------------------------------------------------
create or replace function app.seed_catalogs(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.catalog_items (organization_id, catalog, code, label, sort_order)
  values
    (p_org, 'asset_type', 'portatil', 'Computador portátil', 10),
    (p_org, 'asset_type', 'escritorio', 'Computador de escritorio', 20),
    (p_org, 'asset_type', 'tableta', 'Tableta', 30),
    (p_org, 'asset_type', 'celular', 'Celular', 40),
    (p_org, 'asset_type', 'servidor', 'Servidor', 50),
    (p_org, 'asset_type', 'repositorio', 'Repositorio', 60),
    (p_org, 'asset_type', 'aplicacion', 'Software o aplicación', 70),
    (p_org, 'asset_type', 'base_datos', 'Base de datos', 80),
    (p_org, 'asset_type', 'nube', 'Servicio en la nube', 90),
    (p_org, 'asset_type', 'red', 'Red y comunicaciones', 100),
    (p_org, 'asset_type', 'informacion', 'Información o documento', 110),
    (p_org, 'asset_type', 'instalacion', 'Instalación física', 120),
    (p_org, 'asset_type', 'otro', 'Otro', 999),
    (p_org, 'info_classification', 'publica', 'Pública', 10),
    (p_org, 'info_classification', 'uso_interno', 'Uso interno', 20),
    (p_org, 'info_classification', 'confidencial', 'Confidencial', 30)
  on conflict (organization_id, catalog, code) do nothing
$$;

create or replace function app.on_organization_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_system_roles(new.id);
  perform app.seed_catalogs(new.id);
  return null;
end;
$$;

-- Organizaciones existentes
do $$ begin perform app.seed_catalogs(id) from public.organizations; end $$;

-- ---------------------------------------------------------------------
-- Disparadores comunes: updated_at y trazabilidad
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['catalog_items', 'org_units', 'processes', 'assets', 'frameworks', 'requirements',
                           'controls', 'documents'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
                   t || '_touch', t);
  end loop;
  foreach t in array array['catalog_items', 'org_units', 'processes', 'process_units', 'assets', 'asset_processes',
                           'asset_imports', 'frameworks', 'requirements', 'requirement_links', 'controls',
                           'control_requirements', 'control_assets', 'documents', 'document_versions',
                           'document_requirements', 'policy_acknowledgments'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_trigger()',
                   t || '_audit', t);
  end loop;
end $$;

-- Identificador legible en la traza para tablas de relación
create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
  v_id  text;
begin
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return null; -- sin cambios reales
  end if;
  v_org := case when tg_table_name = 'organizations'
                then (v_row ->> 'id')::uuid
                else (v_row ->> 'organization_id')::uuid end;
  v_id := coalesce(
    v_row ->> 'id',
    case tg_table_name
      when 'role_permissions'      then (v_row ->> 'role_id') || ':' || (v_row ->> 'permission_code')
      when 'process_units'         then (v_row ->> 'process_id') || ':' || (v_row ->> 'unit_id')
      when 'asset_processes'       then (v_row ->> 'asset_id') || ':' || (v_row ->> 'process_id')
      when 'requirement_links'     then (v_row ->> 'requirement_a') || ':' || (v_row ->> 'requirement_b')
      when 'control_requirements'  then (v_row ->> 'control_id') || ':' || (v_row ->> 'requirement_id')
      when 'control_assets'        then (v_row ->> 'control_id') || ':' || (v_row ->> 'asset_id')
      when 'document_requirements' then (v_row ->> 'document_id') || ':' || (v_row ->> 'requirement_id')
    end);
  if tg_op = 'DELETE' and tg_table_name <> 'organizations'
     and not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  perform app.write_audit(v_org, tg_op, tg_table_name, v_id, v_old, v_new);
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Seguridad a nivel de fila
-- ---------------------------------------------------------------------
-- Patrón: leer con <módulo>.read, escribir con <módulo>.write, siempre dentro
-- de la organización de la sesión (con doble factor).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('org_units',             'assets.read',     'assets.write'),
      ('processes',             'assets.read',     'assets.write'),
      ('process_units',         'assets.read',     'assets.write'),
      ('assets',                'assets.read',     'assets.write'),
      ('asset_processes',       'assets.read',     'assets.write'),
      ('frameworks',            'frameworks.read', 'frameworks.write'),
      ('requirements',          'frameworks.read', 'frameworks.write'),
      ('requirement_links',     'frameworks.read', 'frameworks.write'),
      ('controls',              'controls.read',   'controls.write'),
      ('control_requirements',  'controls.read',   'controls.write'),
      ('control_assets',        'controls.read',   'controls.write'),
      ('documents',             'documents.read',  'documents.write'),
      ('document_requirements', 'documents.read',  'documents.write')
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
  end loop;
end $$;

-- Catálogos: los leen todos los miembros; los edita quien configura la organización
alter table public.catalog_items enable row level security;
revoke all on public.catalog_items from anon;
create policy catalog_items_select on public.catalog_items for select to authenticated
  using (organization_id = (select app.current_org_id()));
create policy catalog_items_insert on public.catalog_items for insert to authenticated
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('org.manage')));
create policy catalog_items_update on public.catalog_items for update to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('org.manage')))
  with check (organization_id = (select app.current_org_id()));

-- Historial de importaciones: solo lectura y alta (no se edita)
alter table public.asset_imports enable row level security;
revoke all on public.asset_imports from anon;
revoke update, delete, truncate on public.asset_imports from authenticated;
create policy asset_imports_select on public.asset_imports for select to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('assets.read')));
create policy asset_imports_insert on public.asset_imports for insert to authenticated
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('assets.write'))
              and imported_by = (select auth.uid()));

-- Versiones: quien consulta solo ve la vigente; quien elabora o aprueba ve todas.
alter table public.document_versions enable row level security;
revoke all on public.document_versions from anon;
revoke update, delete, truncate on public.document_versions from authenticated;
grant update (change_summary, file_path, file_name, file_size, file_sha256, mime_type) on public.document_versions to authenticated;
create policy document_versions_select on public.document_versions for select to authenticated
  using (organization_id = (select app.current_org_id()) and (
           (status = 'publicado' and (select app.has_permission('documents.read')))
           or (select app.has_permission('documents.write'))
           or (select app.has_permission('documents.approve'))));
-- Solo se edita (archivo y resumen) un borrador
create policy document_versions_update on public.document_versions for update to authenticated
  using (organization_id = (select app.current_org_id()) and status = 'borrador'
         and (select app.has_permission('documents.write')))
  with check (organization_id = (select app.current_org_id()) and status = 'borrador');
-- Altas solo por document_new_version(); no hay política de insert ni de delete.
revoke insert on public.document_versions from authenticated;

-- Documentos: la versión vigente y la fecha de revisión las fija el flujo
revoke update on public.documents from authenticated;
grant update (title, doc_type, description, process_id, owner_id, classification_id, review_months,
              requires_acknowledgment, active) on public.documents to authenticated;

-- Aceptaciones de políticas: cada quien ve las suyas; quien administra documentos ve todas
alter table public.policy_acknowledgments enable row level security;
revoke all on public.policy_acknowledgments from anon;
revoke insert, update, delete, truncate on public.policy_acknowledgments from authenticated;
create policy policy_ack_select on public.policy_acknowledgments for select to authenticated
  using (organization_id = (select app.current_org_id())
         and (user_id = (select auth.uid()) or (select app.has_permission('documents.approve'))
              or (select app.has_permission('documents.write'))));

-- Activos: la criticidad es calculada; last_import_id lo fija la importación
revoke update on public.assets from authenticated;
grant update (code, name, asset_type_id, description, owner_id, custodian, unit_id, location, classification_id,
              confidentiality, integrity, availability, status, brand, model, serial_number, acquired_on,
              attributes, last_import_id) on public.assets to authenticated;

-- ---------------------------------------------------------------------
-- Almacenamiento de archivos de documentos (bucket privado)
-- Ruta: {organization_id}/{document_id}/{version_id}/{archivo}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 52428800)
on conflict (id) do nothing;

create policy documentos_select on storage.objects for select to authenticated
  using (bucket_id = 'documentos'
         and (storage.foldername(name))[1] = (select app.current_org_id())::text
         and exists (select 1 from public.document_versions v where v.file_path = storage.objects.name));

create policy documentos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos'
              and (storage.foldername(name))[1] = (select app.current_org_id())::text
              and (select app.has_permission('documents.write'))
              and exists (select 1 from public.document_versions v
                           where v.id::text = (storage.foldername(name))[3]
                             and v.document_id::text = (storage.foldername(name))[2]
                             and v.status = 'borrador'));

-- ---------------------------------------------------------------------
-- Privilegios de funciones nuevas
-- ---------------------------------------------------------------------
revoke execute on function app.natural_key(text) from public, anon;
grant execute on function app.natural_key(text) to authenticated;
revoke execute on function app.seed_catalogs(uuid) from public, anon, authenticated;
revoke execute on function app.org_units_no_cycle() from public, anon;

-- ---------------------------------------------------------------------
-- Importación masiva de activos con cálculo de diferencias
-- p_fields: columnas presentes en el archivo (las demás no se tocan).
-- p_apply = false: solo calcula diferencias (vista previa).
-- Se ejecuta con los permisos del usuario (RLS aplica).
-- ---------------------------------------------------------------------
alter table public.assets drop constraint assets_last_import_fkey;
alter table public.assets
  add constraint assets_last_import_fkey foreign key (organization_id, last_import_id)
  references public.asset_imports(organization_id, id) on delete set null (last_import_id)
  deferrable initially deferred;

create or replace function public.import_assets(p_file_name text, p_fields text[], p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org        uuid := app.current_org_id();
  v_allowed    text[] := array['name','asset_type_id','description','owner_id','custodian','unit_id','location',
                               'classification_id','confidentiality','integrity','availability','status','brand',
                               'model','serial_number','acquired_on','attributes'];
  v_import     uuid := gen_random_uuid();
  r            jsonb;
  v_old        jsonb;
  v_changes    jsonb;
  f            text;
  n_created    int := 0;
  n_updated    int := 0;
  n_unchanged  int := 0;
  v_created    jsonb := '[]'::jsonb;
  v_updated    jsonb := '[]'::jsonb;
  v_missing    jsonb;
  n_missing    int;
  v_dupes      text;
begin
  if v_org is null or not app.has_permission('assets.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'El archivo debe tener entre 1 y 5.000 filas' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_fields) x where x <> all (v_allowed)) then
    raise exception 'Columnas no permitidas' using errcode = '22023';
  end if;
  select string_agg(code, ', ') into v_dupes from (
    select e ->> 'code' as code from jsonb_array_elements(p_rows) e group by 1 having count(*) > 1 limit 20) d;
  if v_dupes is not null then
    raise exception 'Códigos repetidos en el archivo: %', v_dupes using errcode = '22023';
  end if;

  for r in select e from jsonb_array_elements(p_rows) e loop
    if coalesce(trim(r ->> 'code'), '') = '' then
      raise exception 'Hay filas sin código de activo' using errcode = '22023';
    end if;
    select to_jsonb(a) into v_old from public.assets a where a.organization_id = v_org and a.code = r ->> 'code';

    if v_old is null then
      n_created := n_created + 1;
      if n_created <= 500 then v_created := v_created || to_jsonb(r ->> 'code'); end if;
      if p_apply then
        insert into public.assets (organization_id, code, name, asset_type_id, description, owner_id, custodian,
                                   unit_id, location, classification_id, confidentiality, integrity, availability,
                                   status, brand, model, serial_number, acquired_on, attributes, last_import_id)
        select v_org, x.code, coalesce(nullif(trim(x.name), ''), x.code), x.asset_type_id, x.description, x.owner_id,
               x.custodian, x.unit_id, x.location, x.classification_id, x.confidentiality, x.integrity,
               x.availability, coalesce(x.status, 'activo'), x.brand, x.model, x.serial_number, x.acquired_on,
               coalesce(x.attributes, '{}'::jsonb), v_import
          from jsonb_populate_record(null::public.assets, r) x;
      end if;
    else
      v_changes := '{}'::jsonb;
      foreach f in array p_fields loop
        if f = 'name' and coalesce(trim(r ->> 'name'), '') = '' then continue; end if;
        if (v_old -> f) is distinct from coalesce(r -> f, 'null'::jsonb)
           and not (coalesce(v_old -> f, 'null'::jsonb) = 'null'::jsonb and coalesce(r -> f, 'null'::jsonb) = 'null'::jsonb) then
          v_changes := v_changes || jsonb_build_object(f, jsonb_build_object('antes', v_old -> f, 'ahora', r -> f));
        end if;
      end loop;
      if v_changes = '{}'::jsonb then
        n_unchanged := n_unchanged + 1;
      else
        n_updated := n_updated + 1;
        if n_updated <= 500 then
          v_updated := v_updated || jsonb_build_object('code', r ->> 'code', 'cambios', v_changes);
        end if;
        if p_apply then
          update public.assets a set
            name              = case when v_changes ? 'name' then x.name else a.name end,
            asset_type_id     = case when v_changes ? 'asset_type_id' then x.asset_type_id else a.asset_type_id end,
            description       = case when v_changes ? 'description' then x.description else a.description end,
            owner_id          = case when v_changes ? 'owner_id' then x.owner_id else a.owner_id end,
            custodian         = case when v_changes ? 'custodian' then x.custodian else a.custodian end,
            unit_id           = case when v_changes ? 'unit_id' then x.unit_id else a.unit_id end,
            location          = case when v_changes ? 'location' then x.location else a.location end,
            classification_id = case when v_changes ? 'classification_id' then x.classification_id else a.classification_id end,
            confidentiality   = case when v_changes ? 'confidentiality' then x.confidentiality else a.confidentiality end,
            integrity         = case when v_changes ? 'integrity' then x.integrity else a.integrity end,
            availability      = case when v_changes ? 'availability' then x.availability else a.availability end,
            status            = case when v_changes ? 'status' then coalesce(x.status, a.status) else a.status end,
            brand             = case when v_changes ? 'brand' then x.brand else a.brand end,
            model             = case when v_changes ? 'model' then x.model else a.model end,
            serial_number     = case when v_changes ? 'serial_number' then x.serial_number else a.serial_number end,
            acquired_on       = case when v_changes ? 'acquired_on' then x.acquired_on else a.acquired_on end,
            attributes        = case when v_changes ? 'attributes' then coalesce(x.attributes, '{}'::jsonb) else a.attributes end,
            last_import_id    = v_import
          from jsonb_populate_record(null::public.assets, r) x
          where a.organization_id = v_org and a.code = r ->> 'code';
        end if;
      end if;
    end if;
  end loop;

  select count(*)::int, coalesce(jsonb_agg(code) filter (where rn <= 500), '[]'::jsonb)
    into n_missing, v_missing
    from (select a.code, row_number() over (order by a.code) rn
            from public.assets a
           where a.organization_id = v_org and a.status <> 'dado_de_baja'
             and not exists (select 1 from jsonb_array_elements(p_rows) e where e ->> 'code' = a.code)) m;

  if p_apply then
    insert into public.asset_imports (id, organization_id, file_name, imported_by, total_rows, created_count,
                                      updated_count, unchanged_count, missing_count, details)
    values (v_import, v_org, left(coalesce(p_file_name, 'archivo'), 200), auth.uid(), jsonb_array_length(p_rows),
            n_created, n_updated, n_unchanged, n_missing,
            jsonb_build_object('nuevos', v_created, 'modificados', v_updated, 'ausentes', v_missing, 'columnas', to_jsonb(p_fields)));
  end if;

  return jsonb_build_object(
    'import_id', case when p_apply then v_import end,
    'total', jsonb_array_length(p_rows),
    'nuevos', n_created, 'modificados', n_updated, 'sin_cambios', n_unchanged, 'ausentes', n_missing,
    'lista_nuevos', v_created, 'lista_modificados', v_updated, 'lista_ausentes', v_missing);
end;
$$;
revoke execute on function public.import_assets(text, text[], jsonb, boolean) from public, anon;
grant execute on function public.import_assets(text, text[], jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Importación de requisitos de una norma (inserta o actualiza por cláusula
-- y recalcula la jerarquía a partir de la numeración).
-- ---------------------------------------------------------------------
create or replace function public.import_requirements(p_framework_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org      uuid := app.current_org_id();
  n_before   int;
  n_after    int;
  v_dupes    text;
begin
  if v_org is null or not app.has_permission('frameworks.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not exists (select 1 from public.frameworks where id = p_framework_id and organization_id = v_org) then
    raise exception 'Norma no encontrada' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then
    raise exception 'El archivo debe tener entre 1 y 3.000 filas' using errcode = '22023';
  end if;
  select string_agg(c, ', ') into v_dupes from (
    select trim(e ->> 'clause') c from jsonb_array_elements(p_rows) e group by 1 having count(*) > 1 limit 20) d;
  if v_dupes is not null then
    raise exception 'Cláusulas repetidas en el archivo: %', v_dupes using errcode = '22023';
  end if;
  select count(*) into n_before from public.requirements where framework_id = p_framework_id;

  insert into public.requirements (organization_id, framework_id, clause, title, description, evidence_guidance,
                                   criticality, is_auditable)
  select v_org, p_framework_id, trim(e ->> 'clause'), trim(e ->> 'title'), nullif(trim(e ->> 'description'), ''),
         nullif(trim(e ->> 'evidence_guidance'), ''), coalesce((e ->> 'criticality')::smallint, 2),
         coalesce((e ->> 'is_auditable')::boolean, true)
    from jsonb_array_elements(p_rows) e
  on conflict (framework_id, clause) do update
     set title = excluded.title,
         description = coalesce(excluded.description, public.requirements.description),
         evidence_guidance = coalesce(excluded.evidence_guidance, public.requirements.evidence_guidance),
         criticality = excluded.criticality,
         is_auditable = excluded.is_auditable;

  update public.requirements r
     set parent_id = (select p.id from public.requirements p
                       where p.framework_id = r.framework_id and r.clause like p.clause || '.%'
                       order by length(p.clause) desc limit 1)
   where r.framework_id = p_framework_id;

  select count(*) into n_after from public.requirements where framework_id = p_framework_id;
  return jsonb_build_object('nuevos', n_after - n_before, 'actualizados', jsonb_array_length(p_rows) - (n_after - n_before),
                            'total', n_after);
end;
$$;
revoke execute on function public.import_requirements(uuid, jsonb) from public, anon;
grant execute on function public.import_requirements(uuid, jsonb) to authenticated;
