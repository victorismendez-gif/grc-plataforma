-- La carga de activos validaba las políticas RLS fila por fila (permiso, organización,
-- «mis equipos»), lo que con ~1.500 filas superaba el límite de 8 s por consulta.
-- La función ya verifica al inicio la organización y el permiso assets.write, y todas
-- sus consultas filtran por organization_id, así que se ejecuta como definer.
-- Los triggers (auditoría, valores por defecto) siguen activos.
alter function public.import_assets(text, text[], jsonb, boolean) security definer;
revoke execute on function public.import_assets(text, text[], jsonb, boolean) from public, anon;
grant execute on function public.import_assets(text, text[], jsonb, boolean) to authenticated;
