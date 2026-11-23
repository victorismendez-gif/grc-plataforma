-- Funciones de cálculo de riesgo con search_path fijo (aviso del asesor de seguridad)
alter function app.risk_score(text, int, int) set search_path = '';
alter function app.risk_zone(jsonb, numeric) set search_path = '';
