-- Datos de desarrollo local (no se aplican en producción).
-- Usuario: admin@demo.local · Clave: Demo-Admin-2026!  (el doble factor se configura al primer ingreso)
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-000000000001';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'admin@demo.local', extensions.crypt('Demo-Admin-2026!', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{"full_name":"Administrador Demo"}', now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', 'admin@demo.local', 'email_verified', true),
          'email', v_uid::text, now(), now(), now());
  perform app.bootstrap_organization('Empresa Demo S.A.S.', 'demo', v_uid, 'Administrador Demo');
end $$;
