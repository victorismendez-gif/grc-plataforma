-- =====================================================================
-- Rol Empleado y "Mis equipos" (23-nov-2026)
--  * Permiso assets.self: ver y actualizar solo los equipos asignados a uno
--    mismo (portátil, escritorio, tableta, celular): registrar, modificar
--    y dar de baja. Asignado = es el responsable (usuario) o el correo del
--    custodio coincide con el suyo.
--  * Los campos de gestión (responsable, proceso, clasificación, C-I-D,
--    custodio) solo los cambia quien tiene assets.write.
--  * Corrige la carga del 20-nov: el responsable quedó como dato adicional.
-- =====================================================================

insert into public.permissions (code, module, description, sort_order) values
  ('assets.self', 'Activos', 'Ver y actualizar los equipos asignados a uno mismo (portátil, escritorio, tableta, celular)', 42);

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
   where code not in ('org.manage','users.manage','roles.manage','audits.lead','assets.self');

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

  -- Empleado: solo sus equipos asignados
  insert into public.roles (organization_id, code, name, description, is_system)
  values (p_org, 'empleado', 'Empleado', 'Ve y actualiza los equipos que tiene asignados', true)
  returning id into v_role;
  insert into public.role_permissions (organization_id, role_id, permission_code)
  values (p_org, v_role, 'assets.self');
end;
$$;

-- Rol Empleado en las organizaciones existentes; el administrador conserva todos los permisos
insert into public.roles (organization_id, code, name, description, is_system)
select o.id, 'empleado', 'Empleado', 'Ve y actualiza los equipos que tiene asignados', true
  from public.organizations o
 where not exists (select 1 from public.roles r where r.organization_id = o.id and r.code = 'empleado');
insert into public.role_permissions (organization_id, role_id, permission_code)
select r.organization_id, r.id, 'assets.self' from public.roles r
 where r.code in ('empleado', 'administrador')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- ¿El activo es un equipo asignado al usuario actual?
-- ---------------------------------------------------------------------
create or replace function app.is_my_equipment(p_owner uuid, p_email text, p_type uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select (p_owner = auth.uid()
          or (p_email is not null and lower(p_email) = lower(coalesce(auth.jwt() ->> 'email', ''))))
     and exists (select 1 from public.catalog_items c
                  where c.id = p_type and c.catalog = 'asset_type'
                    and c.code in ('portatil', 'escritorio', 'tableta', 'celular'));
$$;
revoke execute on function app.is_my_equipment(uuid, text, uuid) from public, anon;
grant execute on function app.is_my_equipment(uuid, text, uuid) to authenticated;

create policy assets_self_select on public.assets for select to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('assets.self'))
         and app.is_my_equipment(owner_id, custodian_email, asset_type_id));
create policy assets_self_insert on public.assets for insert to authenticated
  with check (organization_id = (select app.current_org_id()) and (select app.has_permission('assets.self'))
              and app.is_my_equipment(owner_id, custodian_email, asset_type_id));
create policy assets_self_update on public.assets for update to authenticated
  using (organization_id = (select app.current_org_id()) and (select app.has_permission('assets.self'))
         and app.is_my_equipment(owner_id, custodian_email, asset_type_id))
  with check (organization_id = (select app.current_org_id())
              and app.is_my_equipment(owner_id, custodian_email, asset_type_id));

-- ---------------------------------------------------------------------
-- Quien solo tiene assets.self no cambia los campos de gestión
-- ---------------------------------------------------------------------
create or replace function app.assets_self_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name  text;
begin
  if app.current_org_id() is null or app.has_permission('assets.write') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select p.full_name into v_name from public.profiles p where p.id = auth.uid();
    new.custodian_email := v_email;
    new.custodian := coalesce(nullif(v_name, ''), v_email);
    new.owner_id := null; new.owner_text := null; new.process_id := null; new.unit_id := null;
    new.classification_id := null; new.confidentiality := null; new.integrity := null; new.availability := null;
    new.attributes := '{}'::jsonb; new.last_import_id := null;
  else
    new.owner_id := old.owner_id; new.owner_text := old.owner_text; new.process_id := old.process_id;
    new.unit_id := old.unit_id; new.custodian := old.custodian; new.custodian_email := old.custodian_email;
    new.classification_id := old.classification_id; new.confidentiality := old.confidentiality;
    new.integrity := old.integrity; new.availability := old.availability;
    new.attributes := old.attributes; new.last_import_id := old.last_import_id;
  end if;
  return new;
end;
$$;
revoke execute on function app.assets_self_guard() from public, anon;
create trigger assets_self_guard before insert or update on public.assets
  for each row execute function app.assets_self_guard();

-- ---------------------------------------------------------------------
-- Corrección de datos: responsable guardado como dato adicional
-- ---------------------------------------------------------------------
update public.assets
   set owner_text = left(attributes ->> 'Responsable original', 120),
       attributes = attributes - 'Responsable original'
 where attributes ? 'Responsable original' and owner_id is null and owner_text is null;
update public.assets
   set attributes = attributes - 'Responsable original'
 where attributes ? 'Responsable original';
