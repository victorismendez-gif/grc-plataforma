-- Endurecimiento tras la revisión del asesor de seguridad de Supabase.

-- 1. search_path fijo también en la función que bloquea cambios a la traza.
alter function app.audit_log_immutable() set search_path = '';

-- 2. Eventos de aplicación: lista cerrada de acciones, detalle acotado y
--    eventos administrativos solo con el permiso correspondiente.
create or replace function public.log_event(p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_action not in ('LOGIN', 'LOGOUT', 'MFA_ENROLLED', 'MFA_VERIFIED', 'PASSWORD_CHANGED', 'EXPORT', 'MFA_RESET') then
    raise exception 'Acción de evento no permitida' using errcode = '22023';
  end if;
  if p_detail is not null and (jsonb_typeof(p_detail) <> 'object' or length(p_detail::text) > 2000) then
    raise exception 'Detalle de evento no válido' using errcode = '22023';
  end if;
  if p_action = 'MFA_RESET' and not app.has_permission('users.manage') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_action = 'EXPORT' and app.current_org_id() is null then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select organization_id into v_org from public.profiles where id = auth.uid();
  if v_org is null then
    return;
  end if;
  perform app.write_audit(v_org, p_action, 'evento', auth.uid()::text, null,
                          coalesce(p_detail, '{}'::jsonb));
end;
$$;
revoke execute on function public.log_event(text, jsonb) from public, anon;
grant execute on function public.log_event(text, jsonb) to authenticated;
