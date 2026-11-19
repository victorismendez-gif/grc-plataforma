-- =====================================================================
-- Fase 1 · Base: organización, usuarios, roles, permisos y trazabilidad
-- =====================================================================
-- Principios:
--  * Todas las tablas de negocio llevan organization_id y seguridad a nivel
--    de fila (RLS). La única tabla sin organization_id es el catálogo global
--    `permissions` (lista fija de códigos de permiso del sistema).
--  * Ningún dato es visible sin doble factor: app.current_org_id() devuelve
--    NULL si la sesión no es aal2, y todas las políticas dependen de ella.
--  * Los permisos se verifican en la base (políticas) y en el servidor
--    (acciones de Next.js), nunca solo en la interfaz.
--  * El registro de auditoría es de solo inserción, encadenado con SHA-256.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Funciones de contexto de sesión
-- ---------------------------------------------------------------------
create or replace function app.is_aal2()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- ---------------------------------------------------------------------
-- Organización (cliente / tenant)
-- ---------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 2 and 160),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  email_domain  text check (email_domain is null or email_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  industry      text,
  country       text not null default 'CO',
  plan          text not null default 'base',
  logo_url      text,
  brand_color   text not null default '#0b6b74' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.organizations is 'Empresa cliente. Raíz del aislamiento de datos (organization_id).';

-- ---------------------------------------------------------------------
-- Perfil de usuario (1:1 con auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  email            text not null,
  full_name        text not null default '',
  job_title        text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create index profiles_org_idx on public.profiles(organization_id);

create or replace function app.current_org_id()
returns uuid
language sql stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid() and p.active and app.is_aal2()
$$;

-- ---------------------------------------------------------------------
-- Permisos y roles
-- ---------------------------------------------------------------------
create table public.permissions (
  code         text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  module       text not null,
  description  text not null,
  sort_order   int not null default 0
);
comment on table public.permissions is 'Catálogo global de códigos de permiso (única tabla sin organization_id).';

insert into public.permissions (code, module, description, sort_order) values
  ('org.manage',              'Organización',     'Configurar los datos y la marca de la organización', 10),
  ('users.manage',            'Usuarios',         'Invitar, activar, desactivar usuarios y asignar roles', 20),
  ('roles.manage',            'Usuarios',         'Crear roles y editar sus permisos', 21),
  ('audit_log.read',          'Trazabilidad',     'Consultar y exportar el registro de auditoría', 30),
  ('assets.read',             'Activos',          'Consultar el inventario de activos y la estructura', 40),
  ('assets.write',            'Activos',          'Crear y editar activos, sedes, áreas y procesos', 41),
  ('frameworks.read',         'Normas',           'Consultar normas y requisitos', 50),
  ('frameworks.write',        'Normas',           'Importar y editar normas y requisitos', 51),
  ('controls.read',           'Controles',        'Consultar controles', 60),
  ('controls.write',          'Controles',        'Crear, editar y calificar controles', 61),
  ('documents.read',          'Documentos',       'Consultar documentos y políticas vigentes', 70),
  ('documents.write',         'Documentos',       'Elaborar y revisar documentos', 71),
  ('documents.approve',       'Documentos',       'Aprobar y publicar documentos', 72),
  ('gap.read',                'GAP',              'Consultar diagnósticos GAP', 80),
  ('gap.write',               'GAP',              'Calificar requisitos y cargar evidencia', 81),
  ('gap.validate',            'GAP',              'Validar calificaciones del GAP', 82),
  ('plans.read',              'Planes de acción', 'Consultar planes y acciones', 90),
  ('plans.write',             'Planes de acción', 'Crear y actualizar planes y acciones', 91),
  ('risks.read',              'Riesgos',          'Consultar riesgos', 100),
  ('risks.write',             'Riesgos',          'Identificar y valorar riesgos', 101),
  ('risks.configure',         'Riesgos',          'Parametrizar la metodología de riesgo', 102),
  ('third_parties.read',      'Terceros',         'Consultar terceros y sus evaluaciones', 110),
  ('third_parties.write',     'Terceros',         'Registrar y evaluar terceros', 111),
  ('audits.read',             'Auditoría',        'Consultar programas y auditorías emitidas', 120),
  ('audits.write',            'Auditoría',        'Ejecutar auditorías asignadas', 121),
  ('audits.lead',             'Auditoría',        'Planear el programa y liderar auditorías', 122),
  ('findings.read',           'Hallazgos',        'Consultar hallazgos', 130),
  ('findings.write',          'Hallazgos',        'Registrar hallazgos y análisis de causa', 131),
  ('findings.verify',         'Hallazgos',        'Verificar la eficacia y cerrar hallazgos', 132),
  ('dashboard.read',          'Tablero',          'Consultar tableros e indicadores', 140),
  ('reports.read',            'Reportes',         'Consultar reportes', 150),
  ('reports.export',          'Reportes',         'Exportar reportes a PDF y Excel', 151),
  ('notifications.configure', 'Notificaciones',   'Configurar reglas y grupos de notificación', 160);

create table public.roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  name             text not null check (length(trim(name)) between 2 and 80),
  description      text,
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.role_permissions (
  organization_id  uuid not null,
  role_id          uuid not null,
  permission_code  text not null references public.permissions(code) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (role_id, permission_code),
  foreign key (organization_id, role_id) references public.roles(organization_id, id) on delete cascade
);
create index role_permissions_org_idx on public.role_permissions(organization_id);

create table public.user_roles (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  user_id             uuid not null,
  role_id             uuid not null,
  -- Alcance opcional (sede/área y norma). Las llaves foráneas se agregan
  -- cuando existan las tablas de unidades y marcos (Fase 2).
  scope_unit_id       uuid,
  scope_framework_id  uuid,
  created_at          timestamptz not null default now(),
  foreign key (organization_id, user_id) references public.profiles(organization_id, id) on delete cascade,
  foreign key (organization_id, role_id) references public.roles(organization_id, id) on delete cascade,
  unique nulls not distinct (user_id, role_id, scope_unit_id, scope_framework_id)
);
create index user_roles_user_idx on public.user_roles(user_id);
create index user_roles_org_idx on public.user_roles(organization_id);

create or replace function app.has_permission(p_code text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select app.is_aal2() and exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.profiles p on p.id = ur.user_id and p.organization_id = ur.organization_id
    where ur.user_id = auth.uid()
      and p.active
      and rp.permission_code = p_code
  )
$$;

-- ---------------------------------------------------------------------
-- Registro de auditoría: solo inserción y encadenado por organización
-- ---------------------------------------------------------------------
create table public.audit_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  occurred_at      timestamptz not null,
  actor_id         uuid,
  actor_email      text,
  action           text not null,
  table_name       text not null,
  record_id        text,
  old_data         jsonb,
  new_data         jsonb,
  changed_fields   text[],
  prev_hash        text,
  hash             text not null
);
create index audit_log_org_time_idx on public.audit_log(organization_id, id desc);
create index audit_log_table_idx on public.audit_log(organization_id, table_name, record_id);
comment on table public.audit_log is 'Registro inalterable: solo inserción, cada fila encadena el hash de la anterior (SHA-256).';

create or replace function app.audit_hash_payload(
  p_org uuid, p_at timestamptz, p_actor uuid, p_email text, p_action text,
  p_table text, p_record text, p_old jsonb, p_new jsonb, p_prev text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(extensions.digest(
    coalesce(p_prev, '') || '|' ||
    jsonb_build_object(
      'org', p_org, 'at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'actor', p_actor, 'email', p_email, 'action', p_action,
      'table', p_table, 'record', p_record, 'old', p_old, 'new', p_new
    )::text, 'sha256'), 'hex')
$$;

create or replace function app.write_audit(
  p_org uuid, p_action text, p_table text, p_record text, p_old jsonb, p_new jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev   text;
  v_at     timestamptz := clock_timestamp();
  v_actor  uuid := auth.uid();
  v_email  text := auth.jwt() ->> 'email';
  v_fields text[];
begin
  if p_org is null then
    return;
  end if;
  -- Serializa las escrituras por organización para mantener la cadena.
  perform pg_advisory_xact_lock(hashtext('audit:' || p_org::text));
  select a.hash into v_prev
    from public.audit_log a
   where a.organization_id = p_org
   order by a.id desc
   limit 1;

  if p_old is not null and p_new is not null then
    select array_agg(k order by k) into v_fields
      from (select key as k from jsonb_each(p_new)
            except
            select key from jsonb_each(p_old) o where p_new -> o.key = o.value) s;
  end if;

  insert into public.audit_log
    (organization_id, occurred_at, actor_id, actor_email, action, table_name, record_id,
     old_data, new_data, changed_fields, prev_hash, hash)
  values
    (p_org, v_at, v_actor, v_email, p_action, p_table, p_record,
     p_old, p_new, v_fields, v_prev,
     app.audit_hash_payload(p_org, v_at, v_actor, v_email, p_action, p_table, p_record, p_old, p_new, v_prev));
end;
$$;

-- Disparador genérico para tablas con organization_id (o la propia organizations)
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
  v_id := coalesce(v_row ->> 'id',
                   case when tg_table_name = 'role_permissions'
                        then (v_row ->> 'role_id') || ':' || (v_row ->> 'permission_code') end);
  -- Al borrar una organización completa no hay dónde registrar: se omite.
  if tg_op = 'DELETE' and tg_table_name <> 'organizations'
     and not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  perform app.write_audit(v_org, tg_op, tg_table_name, v_id, v_old, v_new);
  return null;
end;
$$;

create or replace function app.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'El registro de auditoría es inalterable (operación % no permitida)', tg_op
    using errcode = '42501';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_immutable();

-- Eventos de aplicación (ingreso, doble factor, exportaciones).
-- No exige aal2 para poder registrar el ingreso con contraseña.
create or replace function public.log_event(p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_action !~ '^[A-Z_]{3,40}$' then
    raise exception 'Acción de evento inválida';
  end if;
  select organization_id into v_org from public.profiles where id = auth.uid();
  if v_org is null then
    return;
  end if;
  perform app.write_audit(v_org, p_action, 'evento', auth.uid()::text, null,
                          coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- Verificación de la cadena: devuelve el primer id alterado (o NULL si está íntegra)
create or replace function public.verify_audit_chain()
returns table (checked bigint, first_broken_id bigint)
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_org  uuid := app.current_org_id();
  v_prev text := null;
  v_n    bigint := 0;
  r      record;
begin
  if v_org is null or not app.has_permission('audit_log.read') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  for r in select * from public.audit_log where organization_id = v_org order by id loop
    v_n := v_n + 1;
    if r.prev_hash is distinct from v_prev
       or r.hash <> app.audit_hash_payload(r.organization_id, r.occurred_at, r.actor_id, r.actor_email,
                                           r.action, r.table_name, r.record_id, r.old_data, r.new_data, r.prev_hash) then
      checked := v_n; first_broken_id := r.id;
      return next;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  checked := v_n; first_broken_id := null;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();
create trigger roles_touch before update on public.roles
  for each row execute function app.touch_updated_at();

-- Trazabilidad de las tablas de esta fase
create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function app.audit_trigger();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function app.audit_trigger();
create trigger roles_audit after insert or update or delete on public.roles
  for each row execute function app.audit_trigger();
create trigger role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function app.audit_trigger();
create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function app.audit_trigger();

-- ---------------------------------------------------------------------
-- Reglas de integridad de la administración
-- ---------------------------------------------------------------------
-- 1. Los roles del sistema no se renombran ni se borran; el rol
--    administrador conserva siempre todos los permisos.
create or replace function app.protect_system_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return coalesce(new, old); -- borrado en cascada de la organización
  end if;
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'Los roles del sistema no se pueden eliminar' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.is_system and (new.code <> old.code or new.is_system <> old.is_system) then
    raise exception 'El código de un rol del sistema no se puede cambiar' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger roles_protect before update or delete on public.roles
  for each row execute function app.protect_system_roles();

create or replace function app.protect_admin_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.roles r
              where r.id = old.role_id and r.is_system and r.code = 'administrador')
     and exists (select 1 from public.organizations o where o.id = old.organization_id) then
    raise exception 'El rol administrador conserva todos los permisos' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger role_permissions_protect_admin before delete on public.role_permissions
  for each row execute function app.protect_admin_permissions();

-- 2. Siempre debe quedar al menos un administrador activo.
create or replace function app.active_admin_count(p_org uuid)
returns int
language sql stable
security definer
set search_path = ''
as $$
  select count(distinct ur.user_id)::int
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.code = 'administrador' and r.is_system
    join public.profiles p on p.id = ur.user_id and p.active
   where ur.organization_id = p_org
$$;

create or replace function app.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.organization_id, old.organization_id);
begin
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null; -- borrado de la organización completa
  end if;
  if app.active_admin_count(v_org) = 0 then
    raise exception 'Debe quedar al menos un administrador activo' using errcode = '42501';
  end if;
  return null;
end;
$$;
create constraint trigger user_roles_last_admin after delete or update on public.user_roles
  deferrable initially immediate
  for each row execute function app.guard_last_admin();
create constraint trigger profiles_last_admin after update of active on public.profiles
  deferrable initially immediate
  for each row when (old.active and not new.active)
  execute function app.guard_last_admin();

-- ---------------------------------------------------------------------
-- Roles base de cada organización (se crean al insertar la organización)
-- ---------------------------------------------------------------------
create or replace function app.seed_system_roles(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role uuid;
begin
  -- Administrador: todo
  insert into public.roles (organization_id, code, name, description, is_system)
  values (p_org, 'administrador', 'Administrador', 'Configura la plataforma, usuarios y roles', true)
  returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select p_org, v_role, code from public.permissions;

  -- Líder de sistema: todo lo funcional, sin administrar usuarios, roles ni organización
  insert into public.roles (organization_id, code, name, description, is_system)
  values (p_org, 'lider_sistema', 'Líder de sistema', 'Implementa y mantiene los sistemas de gestión', true)
  returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select p_org, v_role, code from public.permissions
   where code not in ('org.manage','users.manage','roles.manage','audits.lead');

  -- Auditor
  insert into public.roles (organization_id, code, name, description, is_system)
  values (p_org, 'auditor', 'Auditor', 'Planea, ejecuta y reporta auditorías', true)
  returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select p_org, v_role, code from public.permissions
   where code like '%.read'
      or code in ('audits.write','findings.write','reports.export');

  -- Responsable de área
  insert into public.roles (organization_id, code, name, description, is_system)
  values (p_org, 'responsable_area', 'Responsable de área', 'Ejecuta tareas del plan y cierra hallazgos', true)
  returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select p_org, v_role, code from public.permissions
   where (code like '%.read' and code <> 'audit_log.read')
      or code in ('assets.write','documents.write','risks.write','plans.write','findings.write','gap.write');

  -- Consulta
  insert into public.roles (organization_id, code, name, description, is_system)
  values (p_org, 'consulta', 'Consulta', 'Solo lectura', true)
  returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select p_org, v_role, code from public.permissions
   where code like '%.read' and code <> 'audit_log.read';
end;
$$;

create or replace function app.on_organization_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_system_roles(new.id);
  return null;
end;
$$;
create trigger organizations_seed_roles after insert on public.organizations
  for each row execute function app.on_organization_created();

-- Alta de una organización con su primer administrador (solo service_role)
create or replace function app.bootstrap_organization(
  p_name text, p_slug text, p_admin_user_id uuid, p_admin_name text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_email text;
begin
  select email into v_email from auth.users where id = p_admin_user_id;
  if v_email is null then
    raise exception 'El usuario administrador no existe en auth.users';
  end if;
  insert into public.organizations (name, slug, email_domain)
  values (p_name, p_slug, lower(split_part(v_email, '@', 2)))
  returning id into v_org;
  insert into public.profiles (id, organization_id, email, full_name)
  values (p_admin_user_id, v_org, v_email, coalesce(p_admin_name, ''));
  insert into public.user_roles (organization_id, user_id, role_id)
  select v_org, p_admin_user_id, r.id from public.roles r
   where r.organization_id = v_org and r.code = 'administrador';
  return v_org;
end;
$$;
revoke all on function app.bootstrap_organization(text, text, uuid, text) from public, authenticated, anon;
grant execute on function app.bootstrap_organization(text, text, uuid, text) to service_role;

-- Crear el perfil de un usuario invitado (lo llama el administrador
-- autenticado después de invitarlo por Auth, así queda su autoría en la traza).
create or replace function public.admin_create_profile(p_user_id uuid, p_full_name text, p_job_title text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid := app.current_org_id();
  v_email text;
begin
  if v_org is null or not app.has_permission('users.manage') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'Usuario no encontrado';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'El usuario ya pertenece a una organización';
  end if;
  insert into public.profiles (id, organization_id, email, full_name, job_title)
  values (p_user_id, v_org, lower(v_email), coalesce(trim(p_full_name), ''), nullif(trim(p_job_title), ''));
end;
$$;

-- Permisos efectivos del usuario actual (para la interfaz)
create or replace function public.current_permissions()
returns text[]
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct rp.permission_code order by rp.permission_code), '{}')
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.profiles p on p.id = ur.user_id and p.active
   where ur.user_id = auth.uid() and app.is_aal2()
$$;

-- Latido para evitar la pausa por inactividad del plan gratuito
create or replace function public.ping()
returns text
language sql stable
set search_path = ''
as $$ select 'ok'::text $$;

-- ---------------------------------------------------------------------
-- Privilegios de funciones
-- ---------------------------------------------------------------------
revoke execute on all functions in schema app from public, anon;
grant execute on function app.is_aal2(), app.current_org_id(), app.has_permission(text) to authenticated;
revoke execute on function public.log_event(text, jsonb) from public, anon;
grant execute on function public.log_event(text, jsonb) to authenticated;
revoke execute on function public.verify_audit_chain() from public, anon;
grant execute on function public.verify_audit_chain() to authenticated;
revoke execute on function public.admin_create_profile(uuid, text, text) from public, anon;
grant execute on function public.admin_create_profile(uuid, text, text) to authenticated;
revoke execute on function public.current_permissions() from public, anon;
grant execute on function public.current_permissions() to authenticated;
grant execute on function public.ping() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Seguridad a nivel de fila
-- ---------------------------------------------------------------------
alter table public.organizations    enable row level security;
alter table public.profiles         enable row level security;
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.audit_log        enable row level security;

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on public.permissions from anon;
revoke all on public.organizations, public.profiles, public.roles, public.role_permissions, public.user_roles from anon;

-- Columnas editables desde la aplicación (lo demás solo por funciones controladas)
revoke insert, update, delete, truncate on public.organizations from authenticated;
grant update (name, industry, country, email_domain, logo_url, brand_color, settings) on public.organizations to authenticated;
revoke insert, update, delete, truncate on public.profiles from authenticated;
grant update (full_name, job_title, active) on public.profiles to authenticated;
revoke update, truncate on public.roles from authenticated;
grant update (name, description) on public.roles to authenticated;
revoke update, truncate on public.role_permissions, public.user_roles from authenticated;
revoke insert, update, delete, truncate on public.permissions from authenticated;

-- organizations
create policy org_select on public.organizations for select to authenticated
  using (id = (select app.current_org_id()));
create policy org_update on public.organizations for update to authenticated
  using (id = (select app.current_org_id()) and (select app.has_permission('org.manage')))
  with check (id = (select app.current_org_id()));

-- profiles: los miembros ven a sus colegas (para asignar responsables)
create policy profiles_select on public.profiles for select to authenticated
  using (organization_id = (select app.current_org_id()));
create policy profiles_update on public.profiles for update to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')))
  with check (organization_id = (select app.current_org_id()));

-- permissions: catálogo legible por usuarios autenticados con doble factor
create policy permissions_select on public.permissions for select to authenticated
  using ((select app.is_aal2()));

-- roles
create policy roles_select on public.roles for select to authenticated
  using (organization_id = (select app.current_org_id()));
create policy roles_insert on public.roles for insert to authenticated
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')) and not is_system);
create policy roles_update on public.roles for update to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')))
  with check (organization_id = (select app.current_org_id()));
create policy roles_delete on public.roles for delete to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')) and not is_system);

-- role_permissions
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (organization_id = (select app.current_org_id()));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('roles.manage')));

-- user_roles
create policy user_roles_select on public.user_roles for select to authenticated
  using (organization_id = (select app.current_org_id()));
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));
create policy user_roles_delete on public.user_roles for delete to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('users.manage')));

-- audit_log: solo lectura con permiso
create policy audit_log_select on public.audit_log for select to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('audit_log.read')));
