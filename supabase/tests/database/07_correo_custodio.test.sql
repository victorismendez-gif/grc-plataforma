-- Correo del custodio: formato, perfiles y diferencias en la importación.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

insert into auth.users (id, email, aud, role) values ('f0000000-0000-4000-8000-000000000001', 'admin@cus.test', 'authenticated', 'authenticated');
select app.bootstrap_organization('Custodios SA', 'custodios', 'f0000000-0000-4000-8000-000000000001', 'Admin');

select is((select c.settings -> 'fields' from public.catalog_items c join public.organizations o on o.id = c.organization_id
            where o.slug = 'custodios' and c.code = 'servidor'),
          '["name","ip_address","status","brand","model","operating_system","owner_id","custodian","custodian_email"]'::jsonb,
          'El correo del custodio va justo después del custodio');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000001","aal":"aal2","email":"admin@cus.test"}', true);

select throws_ok($$ insert into public.assets (organization_id, asset_type_id, code, custodian_email)
                    values (app.current_org_id(), (select id from public.catalog_items where code = 'otro'), 'X1', 'no-es-correo') $$,
                 '23514', null, 'Rechaza un correo con formato inválido');
select lives_ok($$ insert into public.assets (organization_id, asset_type_id, code, custodian, custodian_email)
                   values (app.current_org_id(), (select id from public.catalog_items where code = 'otro'), 'X2', 'Mesa de ayuda', 'mesa@empresa.co') $$,
                'Acepta un correo válido');
create temp table r on commit drop as select public.import_assets('m.xlsx', array['custodian_email'],
  '[{"code":"X2","asset_type_id":null,"custodian_email":"soporte@empresa.co"}]'::jsonb, true) as res;
select is((select res -> 'lista_modificados' -> 0 -> 'cambios' -> 'custodian_email' ->> 'ahora' from r), 'soporte@empresa.co',
          'La importación detecta el cambio de correo del custodio');
select is((select custodian_email from public.assets where code = 'X2'), 'soporte@empresa.co', 'Y lo aplica');

select * from finish();
rollback;
