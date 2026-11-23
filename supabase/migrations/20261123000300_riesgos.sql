-- =====================================================================
-- Fase 4 · Gestión de riesgos (23-nov-2026)
--  * Metodología parametrizable: escalas de probabilidad e impacto de 3 a 6
--    niveles con nombre y descripción, fórmula (producto o suma), zonas con
--    color, apetito y tolerancia (generales y por categoría) y reducción por
--    efectividad del control. Una vigente por organización; si ya se usó en
--    evaluaciones, editarla crea una versión nueva y las evaluaciones
--    anteriores conservan la suya.
--  * Catálogos: riesgos (R1…), causas (CAU…), categorías y factores.
--  * Registro de riesgos: riesgo + causa + categoría + evento de amenaza,
--    sobre un proceso o un tipo de activo, con responsable, controles,
--    valoración inherente y residual y tratamiento.
--  * Residual: cada control reduce la probabilidad (preventivo/detectivo) o
--    el impacto (correctivo) según su efectividad.
--  * Fuera de tolerancia ⇒ requiere tratamiento (actividad en el plan de
--    tratamiento) o aceptación aprobada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Metodología
-- ---------------------------------------------------------------------
create table public.risk_methodologies (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  version            int not null default 1,
  status             text not null default 'vigente' check (status in ('vigente', 'historica')),
  probability_levels jsonb not null,
  impact_levels      jsonb not null,
  formula            text not null default 'producto' check (formula in ('producto', 'suma')),
  zones              jsonb not null,
  appetite           numeric(6,2) not null,
  tolerance          numeric(6,2) not null,
  control_reduction  jsonb not null default '{"1": 0.10, "2": 0.25, "3": 0.50}'::jsonb,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, version),
  check (tolerance >= appetite)
);
create unique index risk_methodologies_vigente_uq on public.risk_methodologies(organization_id) where status = 'vigente';

-- Valida la forma de las escalas y zonas
create or replace function app.risk_methodology_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n int;
  arr jsonb;
  k text;
begin
  foreach k in array array['probability_levels', 'impact_levels'] loop
    arr := case k when 'probability_levels' then new.probability_levels else new.impact_levels end;
    n := jsonb_array_length(arr);
    if jsonb_typeof(arr) <> 'array' or n < 3 or n > 6 then
      raise exception 'Cada escala debe tener entre 3 y 6 niveles' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_array_elements(arr) with ordinality e(v, i)
                where (e.v ->> 'level')::int <> e.i or coalesce(trim(e.v ->> 'name'), '') = '') then
      raise exception 'Los niveles deben ir de 1 a % y tener nombre', n using errcode = '23514';
    end if;
  end loop;
  if jsonb_typeof(new.zones) <> 'array' or jsonb_array_length(new.zones) < 2 or jsonb_array_length(new.zones) > 6 then
    raise exception 'Define entre 2 y 6 zonas de riesgo' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.zones) z
              where coalesce(trim(z ->> 'name'), '') = '' or (z ->> 'color') !~ '^#[0-9A-Fa-f]{6}$'
                 or jsonb_typeof(z -> 'min') <> 'number') then
    raise exception 'Cada zona necesita nombre, color (#RRGGBB) y valor mínimo' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_each(new.control_reduction) r
              where r.key not in ('1', '2', '3') or jsonb_typeof(r.value) <> 'number'
                 or (r.value)::numeric < 0 or (r.value)::numeric > 0.95) then
    raise exception 'La reducción por control va de 0 a 0,95 para Débil, Moderado y Fuerte' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger risk_methodologies_check before insert or update on public.risk_methodologies
  for each row execute function app.risk_methodology_check();

-- ---------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------
create table public.risk_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) between 2 and 160),
  appetite         numeric(6,2),
  tolerance        numeric(6,2),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  check (tolerance is null or appetite is null or tolerance >= appetite)
);
create unique index risk_categories_name_uq on public.risk_categories(organization_id, lower(name));

create table public.risk_factors (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) between 2 and 160),
  created_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index risk_factors_name_uq on public.risk_factors(organization_id, lower(name));

create table public.risks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text not null check (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name             text not null check (length(trim(name)) between 3 and 500),
  description      text check (description is null or length(description) <= 4000),
  dimension        text check (dimension in ('confidencialidad', 'integridad', 'disponibilidad', 'otro')),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code)
);

create table public.risk_causes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text not null check (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  description      text not null check (length(trim(description)) between 3 and 1000),
  factor_id        uuid,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, factor_id) references public.risk_factors(organization_id, id) on delete set null (factor_id)
);

-- ---------------------------------------------------------------------
-- Registro de riesgos
-- ---------------------------------------------------------------------
create table public.risk_entries (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  code                  text not null default '' check (code = '' or code ~ '^[A-Za-z0-9._-]{2,40}$'),
  natural_key           text,
  risk_id               uuid not null,
  cause_id              uuid,
  category_id           uuid,
  threat_event          text check (threat_event is null or length(threat_event) <= 2000),
  consequence           text check (consequence is null or length(consequence) <= 2000),
  process_id            uuid,
  asset_type_id         uuid,
  owner_id              uuid,
  owner_text            text check (owner_text is null or length(owner_text) <= 120),
  inherent_probability  smallint check (inherent_probability between 1 and 6),
  inherent_impact       smallint check (inherent_impact between 1 and 6),
  inherent_score        numeric(6,2),
  inherent_zone         text,
  inherent_color        text,
  residual_probability  smallint check (residual_probability between 1 and 6),
  residual_impact       smallint check (residual_impact between 1 and 6),
  residual_score        numeric(6,2),
  residual_zone         text,
  residual_color        text,
  methodology_id        uuid,
  evaluated_by          uuid,
  evaluated_at          timestamptz,
  treatment_strategy    text check (treatment_strategy in ('mitigar', 'transferir', 'aceptar', 'evitar', 'mitigar_transferir')),
  treatment_description text check (treatment_description is null or length(treatment_description) <= 4000),
  accepted_by           uuid,
  accepted_at           timestamptz,
  acceptance_note       text check (acceptance_note is null or length(acceptance_note) <= 2000),
  materialized_count    int not null default 0 check (materialized_count >= 0),
  last_materialized_on  date,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, risk_id) references public.risks(organization_id, id) on delete restrict,
  foreign key (organization_id, cause_id) references public.risk_causes(organization_id, id) on delete set null (cause_id),
  foreign key (organization_id, category_id) references public.risk_categories(organization_id, id) on delete set null (category_id),
  foreign key (organization_id, process_id) references public.processes(organization_id, id) on delete set null (process_id),
  foreign key (organization_id, asset_type_id) references public.catalog_items(organization_id, id) on delete set null (asset_type_id),
  foreign key (organization_id, owner_id) references public.profiles(organization_id, id) on delete set null (owner_id),
  foreign key (organization_id, methodology_id) references public.risk_methodologies(organization_id, id) on delete restrict
);
create unique index risk_entries_code_uq on public.risk_entries(organization_id, code) where code <> '';
create unique index risk_entries_key_uq on public.risk_entries(organization_id, natural_key) where natural_key is not null;
create index risk_entries_risk_idx on public.risk_entries(risk_id);

create table public.risk_entry_controls (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  entry_id         uuid not null,
  control_id       uuid not null,
  unique (entry_id, control_id),
  foreign key (organization_id, entry_id) references public.risk_entries(organization_id, id) on delete cascade,
  foreign key (organization_id, control_id) references public.controls(organization_id, id) on delete cascade
);
create index risk_entry_controls_control_idx on public.risk_entry_controls(control_id);

-- Actividades de tratamiento enlazadas al riesgo
alter table public.actions add column risk_entry_id uuid;
alter table public.actions
  add constraint actions_risk_entry_fkey foreign key (organization_id, risk_entry_id)
  references public.risk_entries(organization_id, id) on delete set null (risk_entry_id);
create index actions_risk_entry_idx on public.actions(risk_entry_id);

-- Código legible del registro: RG-0001
create or replace function app.risk_entries_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if coalesce(new.code, '') = '' then
    select coalesce(max(substring(code from '^RG-(\d+)$')::int), 0) + 1 into v_n
      from public.risk_entries where organization_id = new.organization_id;
    new.code := 'RG-' || lpad(v_n::text, 4, '0');
  end if;
  return new;
end;
$$;
revoke execute on function app.risk_entries_defaults() from public, anon;
create trigger risk_entries_defaults before insert on public.risk_entries
  for each row execute function app.risk_entries_defaults();

-- ---------------------------------------------------------------------
-- Metodología vigente (crea una 5x5 por defecto la primera vez)
-- ---------------------------------------------------------------------
create or replace function public.risk_methodology_current()
returns public.risk_methodologies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  m     public.risk_methodologies;
begin
  if v_org is null or not app.has_permission('risks.read') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into m from public.risk_methodologies where organization_id = v_org and status = 'vigente';
  if m.id is null then
    insert into public.risk_methodologies (organization_id, probability_levels, impact_levels, zones, appetite, tolerance)
    values (v_org,
      '[{"level":1,"name":"Rara vez","description":"Puede ocurrir solo en circunstancias excepcionales (menos de una vez en 5 años)."},
        {"level":2,"name":"Improbable","description":"Podría ocurrir alguna vez (una vez en 2 a 5 años)."},
        {"level":3,"name":"Posible","description":"Puede ocurrir en algún momento (una vez al año)."},
        {"level":4,"name":"Probable","description":"Ocurre con frecuencia (varias veces al año)."},
        {"level":5,"name":"Casi seguro","description":"Se espera que ocurra en la mayoría de las circunstancias (mensual o más)."}]'::jsonb,
      '[{"level":1,"name":"Insignificante","description":"Sin efecto apreciable en la operación, los datos ni la reputación."},
        {"level":2,"name":"Menor","description":"Afecta un proceso por poco tiempo; se corrige con recursos internos."},
        {"level":3,"name":"Moderado","description":"Afecta varios procesos o datos internos; queja de clientes o incumplimiento menor."},
        {"level":4,"name":"Mayor","description":"Interrupción prolongada, pérdida de datos confidenciales o sanción regulatoria."},
        {"level":5,"name":"Catastrófico","description":"Pérdida grave de información o datos personales, daño reputacional amplio o sanción significativa."}]'::jsonb,
      '[{"name":"Bajo","color":"#2E8B57","min":1},
        {"name":"Moderado","color":"#D4A017","min":5},
        {"name":"Alto","color":"#E07B00","min":10},
        {"name":"Extremo","color":"#B3312E","min":17}]'::jsonb,
      4, 9)
    returning * into m;
  end if;
  return m;
end;
$$;
revoke execute on function public.risk_methodology_current() from public, anon;
grant execute on function public.risk_methodology_current() to authenticated;

-- Guardar metodología: si la vigente ya se usó, crea versión nueva
create or replace function public.risk_methodology_save(
  p_probability_levels jsonb, p_impact_levels jsonb, p_formula text, p_zones jsonb,
  p_appetite numeric, p_tolerance numeric, p_control_reduction jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  m     public.risk_methodologies;
  v_id  uuid;
begin
  if v_org is null or not app.has_permission('risks.configure') then
    raise exception 'Sin permiso para parametrizar la metodología' using errcode = '42501';
  end if;
  m := public.risk_methodology_current();
  if exists (select 1 from public.risk_entries e where e.methodology_id = m.id) then
    update public.risk_methodologies set status = 'historica' where id = m.id;
    insert into public.risk_methodologies (organization_id, version, probability_levels, impact_levels, formula, zones,
                                           appetite, tolerance, control_reduction)
    values (v_org, m.version + 1, p_probability_levels, p_impact_levels, p_formula, p_zones, p_appetite, p_tolerance,
            coalesce(p_control_reduction, m.control_reduction))
    returning id into v_id;
  else
    update public.risk_methodologies
       set probability_levels = p_probability_levels, impact_levels = p_impact_levels, formula = p_formula,
           zones = p_zones, appetite = p_appetite, tolerance = p_tolerance,
           control_reduction = coalesce(p_control_reduction, control_reduction)
     where id = m.id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.risk_methodology_save(jsonb, jsonb, text, jsonb, numeric, numeric, jsonb) from public, anon;
grant execute on function public.risk_methodology_save(jsonb, jsonb, text, jsonb, numeric, numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Cálculos
-- ---------------------------------------------------------------------
create or replace function app.risk_score(p_formula text, p_p int, p_i int)
returns numeric
language sql immutable
as $$ select case when p_formula = 'suma' then (p_p + p_i)::numeric else (p_p * p_i)::numeric end $$;

create or replace function app.risk_zone(p_zones jsonb, p_score numeric)
returns jsonb
language sql immutable
as $$
  select coalesce(
    (select z from jsonb_array_elements(p_zones) z where (z ->> 'min')::numeric <= p_score
      order by (z ->> 'min')::numeric desc limit 1),
    (select z from jsonb_array_elements(p_zones) z order by (z ->> 'min')::numeric limit 1))
$$;

-- Recalcula inherente y residual de un registro con su metodología
create or replace function app.risk_compute(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e     public.risk_entries;
  m     public.risk_methodologies;
  v_p   numeric;
  v_i   numeric;
  c     record;
  r     numeric;
  v_s   numeric;
  v_z   jsonb;
  v_rs  numeric;
  v_rz  jsonb;
begin
  select * into e from public.risk_entries where id = p_entry;
  if e.id is null or e.methodology_id is null or e.inherent_probability is null or e.inherent_impact is null then
    return;
  end if;
  select * into m from public.risk_methodologies where id = e.methodology_id;
  v_s := app.risk_score(m.formula, e.inherent_probability, e.inherent_impact);
  v_z := app.risk_zone(m.zones, v_s);
  v_p := e.inherent_probability;
  v_i := e.inherent_impact;
  -- Controles del más fuerte al más débil; cada uno reduce sobre lo que queda
  for c in
    select ct.control_type,
           coalesce(ct.effectiveness_rating, least(ct.design_rating, ct.application_rating), ct.design_rating) as rating
      from public.risk_entry_controls rc join public.controls ct on ct.id = rc.control_id
     where rc.entry_id = e.id and ct.active and ct.implementation_status in ('implementado', 'en_implementacion')
     order by 2 desc nulls last
  loop
    continue when c.rating is null;
    r := coalesce((m.control_reduction ->> c.rating::text)::numeric, 0);
    if c.control_type = 'correctivo' then
      v_i := v_i * (1 - r);
    else
      v_p := v_p * (1 - r);
    end if;
  end loop;
  v_p := greatest(1, ceil(round(v_p, 4)));
  v_i := greatest(1, ceil(round(v_i, 4)));
  v_rs := app.risk_score(m.formula, v_p::int, v_i::int);
  v_rz := app.risk_zone(m.zones, v_rs);
  perform set_config('app.risk_computing', 'on', true);
  update public.risk_entries
     set inherent_score = v_s, inherent_zone = v_z ->> 'name', inherent_color = v_z ->> 'color',
         residual_probability = v_p, residual_impact = v_i, residual_score = v_rs,
         residual_zone = v_rz ->> 'name', residual_color = v_rz ->> 'color'
   where id = e.id;
  perform set_config('app.risk_computing', 'off', true);
end;
$$;
revoke execute on function app.risk_compute(uuid) from public, anon;

-- Valorar (o revalorar) con la metodología vigente
create or replace function public.risk_evaluate(p_entry uuid, p_probability int, p_impact int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_org_id();
  m     public.risk_methodologies;
begin
  if v_org is null or not app.has_permission('risks.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not exists (select 1 from public.risk_entries where id = p_entry and organization_id = v_org) then
    raise exception 'Riesgo no encontrado' using errcode = 'P0002';
  end if;
  m := public.risk_methodology_current();
  if p_probability is null or p_impact is null then
    perform set_config('app.risk_computing', 'on', true);
    update public.risk_entries
       set inherent_probability = null, inherent_impact = null, inherent_score = null, inherent_zone = null, inherent_color = null,
           residual_probability = null, residual_impact = null, residual_score = null, residual_zone = null, residual_color = null,
           methodology_id = null, evaluated_by = null, evaluated_at = null, accepted_by = null, accepted_at = null
     where id = p_entry;
    perform set_config('app.risk_computing', 'off', true);
    return;
  end if;
  if p_probability < 1 or p_probability > jsonb_array_length(m.probability_levels)
     or p_impact < 1 or p_impact > jsonb_array_length(m.impact_levels) then
    raise exception 'Probabilidad o impacto fuera de la escala (1 a %, 1 a %)',
      jsonb_array_length(m.probability_levels), jsonb_array_length(m.impact_levels) using errcode = '22023';
  end if;
  perform set_config('app.risk_computing', 'on', true);
  update public.risk_entries
     set inherent_probability = p_probability, inherent_impact = p_impact, methodology_id = m.id,
         evaluated_by = auth.uid(), evaluated_at = now(), accepted_by = null, accepted_at = null
   where id = p_entry;
  perform set_config('app.risk_computing', 'off', true);
  perform app.risk_compute(p_entry);
end;
$$;
revoke execute on function public.risk_evaluate(uuid, int, int) from public, anon;
grant execute on function public.risk_evaluate(uuid, int, int) to authenticated;

-- Los campos de valoración solo los escriben las funciones anteriores
create or replace function app.risk_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_org_id() is null or current_setting('app.risk_computing', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.inherent_probability := null; new.inherent_impact := null; new.inherent_score := null;
    new.inherent_zone := null; new.inherent_color := null; new.residual_probability := null;
    new.residual_impact := null; new.residual_score := null; new.residual_zone := null; new.residual_color := null;
    new.methodology_id := null; new.evaluated_by := null; new.evaluated_at := null;
    new.accepted_by := null; new.accepted_at := null;
  else
    new.inherent_probability := old.inherent_probability; new.inherent_impact := old.inherent_impact;
    new.inherent_score := old.inherent_score; new.inherent_zone := old.inherent_zone; new.inherent_color := old.inherent_color;
    new.residual_probability := old.residual_probability; new.residual_impact := old.residual_impact;
    new.residual_score := old.residual_score; new.residual_zone := old.residual_zone; new.residual_color := old.residual_color;
    new.methodology_id := old.methodology_id; new.evaluated_by := old.evaluated_by; new.evaluated_at := old.evaluated_at;
    if (new.accepted_by, new.accepted_at) is distinct from (old.accepted_by, old.accepted_at)
       and current_setting('app.risk_accepting', true) is distinct from 'on' then
      new.accepted_by := old.accepted_by; new.accepted_at := old.accepted_at;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.risk_entries_guard() from public, anon;
create trigger risk_entries_guard before insert or update on public.risk_entries
  for each row execute function app.risk_entries_guard();

-- Recalcular el residual cuando cambian los controles enlazados
create or replace function app.risk_controls_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'risk_entry_controls' then
    perform app.risk_compute(coalesce(new.entry_id, old.entry_id));
  else
    for v_id in select rc.entry_id from public.risk_entry_controls rc where rc.control_id = new.id loop
      perform app.risk_compute(v_id);
    end loop;
  end if;
  return null;
end;
$$;
revoke execute on function app.risk_controls_changed() from public, anon;
create trigger risk_entry_controls_changed after insert or delete on public.risk_entry_controls
  for each row execute function app.risk_controls_changed();
create trigger controls_risk_recalc after update of control_type, design_rating, application_rating, effectiveness_rating,
  implementation_status, active on public.controls
  for each row execute function app.risk_controls_changed();

-- Aceptar el riesgo residual (requiere risks.configure)
create or replace function public.risk_accept(p_entry uuid, p_note text, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_org_id() is null or not app.has_permission('risks.configure') then
    raise exception 'Solo quien parametriza riesgos puede aprobar la aceptación' using errcode = '42501';
  end if;
  if p_accept and coalesce(trim(p_note), '') = '' then
    raise exception 'Escribe la justificación de la aceptación' using errcode = '23514';
  end if;
  if p_accept and not exists (select 1 from public.risk_entries where id = p_entry and residual_score is not null) then
    raise exception 'Primero valora el riesgo' using errcode = '55000';
  end if;
  perform set_config('app.risk_accepting', 'on', true);
  update public.risk_entries
     set accepted_by = case when p_accept then auth.uid() end,
         accepted_at = case when p_accept then now() end,
         acceptance_note = case when p_accept then trim(p_note) else acceptance_note end
   where id = p_entry and organization_id = app.current_org_id();
  perform set_config('app.risk_accepting', 'off', true);
end;
$$;
revoke execute on function public.risk_accept(uuid, text, boolean) from public, anon;
grant execute on function public.risk_accept(uuid, text, boolean) to authenticated;

-- Plan de tratamiento: un plan por organización; una actividad por riesgo
create or replace function public.risk_add_treatment(p_entry uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org  uuid := app.current_org_id();
  v_plan uuid;
  v_id   uuid;
  e      record;
begin
  if v_org is null or not app.has_permission('plans.write') or not app.has_permission('risks.read') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select re.*, r.code as risk_code, r.name as risk_name, rc.description as cause
    into e
    from public.risk_entries re join public.risks r on r.id = re.risk_id
    left join public.risk_causes rc on rc.id = re.cause_id
   where re.id = p_entry;
  if e.id is null then
    raise exception 'Riesgo no encontrado' using errcode = 'P0002';
  end if;
  select id into v_plan from public.action_plans where organization_id = v_org and origin = 'riesgo' and status = 'abierto'
   order by created_at limit 1;
  if v_plan is null then
    insert into public.action_plans (organization_id, title, origin, description)
    values (v_org, 'Plan de tratamiento de riesgos', 'riesgo',
            'Actividades para llevar los riesgos fuera de tolerancia a un nivel aceptable.')
    returning id into v_plan;
  end if;
  insert into public.actions (organization_id, plan_id, risk_entry_id, title, description, owner_id, owner_text, process_id,
                              priority, start_on, due_on)
  values (v_org, v_plan, e.id,
          left('Tratar ' || e.code || ' · ' || e.risk_code || coalesce(' · ' || e.cause, ''), 300),
          left(concat_ws(E'\n', e.risk_name,
               case when e.treatment_description is not null then 'Tratamiento: ' || e.treatment_description end,
               case when e.residual_zone is not null then 'Riesgo residual: ' || e.residual_zone || ' (' || e.residual_score || ')' end), 4000),
          e.owner_id, e.owner_text, e.process_id,
          case when e.residual_score is null then 'media'
               when e.residual_zone in (select z ->> 'name' from public.risk_methodologies m, jsonb_array_elements(m.zones) z
                                         where m.id = e.methodology_id order by (z ->> 'min')::numeric desc limit 1) then 'alta'
               else 'media' end,
          current_date, current_date + 90)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.risk_add_treatment(uuid) from public, anon;
grant execute on function public.risk_add_treatment(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Carga desde Excel (catálogo de causas y riesgos + valoración opcional)
--  fila: risk_code, risk_name, cause_code, cause, category, factor, event,
--        controls (text[] de códigos), treatment, strategy, process,
--        probability, impact, code (RG-…)
-- ---------------------------------------------------------------------
create or replace function public.risk_import(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org     uuid := app.current_org_id();
  r         jsonb;
  v_line    int := 0;
  v_errors  jsonb := '[]'::jsonb;
  v_new     int := 0;
  v_upd     int := 0;
  v_same    int := 0;
  v_eval    int := 0;
  v_risk    uuid;
  v_cause   uuid;
  v_cat     uuid;
  v_factor  uuid;
  v_proc    uuid;
  v_entry   public.risk_entries;
  v_key     text;
  v_ctrls   uuid[];
  v_missing text[];
  v_changed boolean;
  m         public.risk_methodologies;
  v_p       int;
  v_i       int;
begin
  if v_org is null or not app.has_permission('risks.write') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'El archivo debe tener entre 1 y 5.000 filas' using errcode = '22023';
  end if;
  m := public.risk_methodology_current();

  for r in select e from jsonb_array_elements(p_rows) e loop
    v_line := coalesce((r ->> 'line')::int, v_line + 1);
    v_entry := null;
    v_p := nullif(r ->> 'probability', '')::int;
    v_i := nullif(r ->> 'impact', '')::int;
    if (v_p is null) <> (v_i is null) then
      v_errors := v_errors || to_jsonb(format('Fila %s: indica probabilidad e impacto juntos.', v_line));
      continue;
    end if;
    if v_p is not null and (v_p > jsonb_array_length(m.probability_levels) or v_i > jsonb_array_length(m.impact_levels) or v_p < 1 or v_i < 1) then
      v_errors := v_errors || to_jsonb(format('Fila %s: probabilidad o impacto fuera de la escala vigente.', v_line));
      continue;
    end if;

    -- Registro existente por código RG-…
    if coalesce(r ->> 'code', '') <> '' then
      select * into v_entry from public.risk_entries where organization_id = v_org and code = r ->> 'code';
      if v_entry.id is null then
        v_errors := v_errors || to_jsonb(format('Fila %s: el código %s no existe en el registro.', v_line, r ->> 'code'));
        continue;
      end if;
    end if;

    if v_entry.id is null then
      if coalesce(r ->> 'risk_code', '') = '' then
        v_errors := v_errors || to_jsonb(format('Fila %s: falta el código del riesgo.', v_line));
        continue;
      end if;
      select id into v_risk from public.risks where organization_id = v_org and lower(code) = lower(r ->> 'risk_code');
      if v_risk is null and coalesce(r ->> 'risk_name', '') = '' then
        v_errors := v_errors || to_jsonb(format('Fila %s: el riesgo %s no existe; incluye su descripción para crearlo.', v_line, r ->> 'risk_code'));
        continue;
      end if;
      if coalesce(r ->> 'cause_code', '') <> '' then
        select id into v_cause from public.risk_causes where organization_id = v_org and lower(code) = lower(r ->> 'cause_code');
        if v_cause is null and coalesce(r ->> 'cause', '') = '' then
          v_errors := v_errors || to_jsonb(format('Fila %s: la causa %s no existe; incluye su descripción.', v_line, r ->> 'cause_code'));
          continue;
        end if;
      else
        v_cause := null;
      end if;
    end if;

    -- Controles: todos deben existir
    select array_agg(c.id), array_agg(x) filter (where c.id is null)
      into v_ctrls, v_missing
      from jsonb_array_elements_text(coalesce(r -> 'controls', '[]'::jsonb)) x
      left join public.controls c on c.organization_id = v_org and lower(c.code) = lower(x);
    if v_missing is not null then
      v_errors := v_errors || to_jsonb(format('Fila %s: controles que no existen: %s.', v_line, array_to_string(v_missing, ', ')));
      continue;
    end if;

    if not p_apply then
      -- vista previa: cuenta nuevos o existentes sin escribir
      if v_entry.id is null then
        v_key := lower(concat_ws('|', r ->> 'risk_code', r ->> 'cause_code', r ->> 'category', r ->> 'event'));
        if exists (select 1 from public.risk_entries where organization_id = v_org and natural_key = v_key) then v_upd := v_upd + 1;
        else v_new := v_new + 1; end if;
      else
        v_upd := v_upd + 1;
      end if;
      if v_p is not null then v_eval := v_eval + 1; end if;
      continue;
    end if;

    -- Escritura
    if v_entry.id is null then
      if v_risk is null then
        insert into public.risks (organization_id, code, name, dimension)
        values (v_org, trim(r ->> 'risk_code'), left(trim(r ->> 'risk_name'), 500), nullif(r ->> 'dimension', ''))
        returning id into v_risk;
      end if;
      if coalesce(r ->> 'factor', '') <> '' then
        select id into v_factor from public.risk_factors where organization_id = v_org and lower(name) = lower(trim(r ->> 'factor'));
        if v_factor is null then
          insert into public.risk_factors (organization_id, name) values (v_org, left(trim(r ->> 'factor'), 160)) returning id into v_factor;
        end if;
      else
        v_factor := null;
      end if;
      if v_cause is null and coalesce(r ->> 'cause_code', '') <> '' then
        insert into public.risk_causes (organization_id, code, description, factor_id)
        values (v_org, trim(r ->> 'cause_code'), left(trim(r ->> 'cause'), 1000), v_factor)
        returning id into v_cause;
      end if;
      if coalesce(r ->> 'category', '') <> '' then
        select id into v_cat from public.risk_categories where organization_id = v_org and lower(name) = lower(trim(r ->> 'category'));
        if v_cat is null then
          insert into public.risk_categories (organization_id, name) values (v_org, left(trim(r ->> 'category'), 160)) returning id into v_cat;
        end if;
      else
        v_cat := null;
      end if;
      v_key := lower(concat_ws('|', r ->> 'risk_code', r ->> 'cause_code', r ->> 'category', r ->> 'event'));
      select * into v_entry from public.risk_entries where organization_id = v_org and natural_key = v_key;
    end if;

    v_proc := null;
    if coalesce(r ->> 'process', '') <> '' then
      v_proc := public.ensure_process(r ->> 'process');
    end if;

    if v_entry.id is null then
      insert into public.risk_entries (organization_id, natural_key, risk_id, cause_id, category_id, threat_event,
                                       treatment_strategy, treatment_description, process_id)
      values (v_org, v_key, v_risk, v_cause, v_cat, nullif(r ->> 'event', ''),
              nullif(r ->> 'strategy', ''), nullif(r ->> 'treatment', ''), v_proc)
      returning * into v_entry;
      v_new := v_new + 1;
    else
      v_changed := (v_entry.threat_event, v_entry.treatment_strategy, v_entry.treatment_description)
                   is distinct from (coalesce(nullif(r ->> 'event', ''), v_entry.threat_event),
                                     coalesce(nullif(r ->> 'strategy', ''), v_entry.treatment_strategy),
                                     coalesce(nullif(r ->> 'treatment', ''), v_entry.treatment_description))
                   or (v_proc is not null and v_proc is distinct from v_entry.process_id);
      update public.risk_entries
         set threat_event = coalesce(nullif(r ->> 'event', ''), threat_event),
             treatment_strategy = coalesce(nullif(r ->> 'strategy', ''), treatment_strategy),
             treatment_description = coalesce(nullif(r ->> 'treatment', ''), treatment_description),
             process_id = coalesce(v_proc, process_id)
       where id = v_entry.id;
      if v_changed then v_upd := v_upd + 1; else v_same := v_same + 1; end if;
    end if;

    if r ? 'controls' and jsonb_array_length(r -> 'controls') > 0 then
      delete from public.risk_entry_controls where entry_id = v_entry.id and control_id <> all (v_ctrls);
      insert into public.risk_entry_controls (organization_id, entry_id, control_id)
      select v_org, v_entry.id, unnest(v_ctrls)
      on conflict (entry_id, control_id) do nothing;
    end if;

    if v_p is not null and (v_entry.inherent_probability, v_entry.inherent_impact, v_entry.methodology_id)
                           is distinct from (v_p, v_i, m.id) then
      perform public.risk_evaluate(v_entry.id, v_p, v_i);
      v_eval := v_eval + 1;
    end if;
  end loop;

  if p_apply and jsonb_array_length(v_errors) > 0 then
    raise exception 'El archivo tiene errores; no se aplicó ningún cambio' using errcode = '22023';
  end if;
  return jsonb_build_object('nuevos', v_new, 'actualizados', v_upd, 'sin_cambios', v_same, 'valorados', v_eval, 'errores', v_errors);
end;
$$;
revoke execute on function public.risk_import(jsonb, boolean) from public, anon;
grant execute on function public.risk_import(jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Vista del registro con tolerancia y tratamiento
-- ---------------------------------------------------------------------
create view public.risk_entries_view with (security_invoker = true) as
select e.*,
       r.code as risk_code, r.name as risk_name, r.dimension,
       c.code as cause_code, c.description as cause, f.name as factor,
       k.name as category,
       coalesce(k.appetite, m.appetite) as appetite,
       coalesce(k.tolerance, m.tolerance) as tolerance,
       (e.residual_score is not null and e.residual_score > coalesce(k.tolerance, m.tolerance)) as out_of_tolerance,
       (e.residual_score is not null and e.residual_score <= coalesce(k.appetite, m.appetite)) as within_appetite,
       exists (select 1 from public.actions a where a.risk_entry_id = e.id and a.status <> 'cancelada') as has_treatment,
       (select count(*) from public.risk_entry_controls rc where rc.entry_id = e.id) as controls_count,
       m.version as methodology_version
  from public.risk_entries e
  join public.risks r on r.id = e.risk_id
  left join public.risk_causes c on c.id = e.cause_id
  left join public.risk_factors f on f.id = c.factor_id
  left join public.risk_categories k on k.id = e.category_id
  left join public.risk_methodologies m on m.id = e.methodology_id;
grant select on public.risk_entries_view to authenticated;

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('risk_methodologies',  'risks.read', 'risks.configure'),
      ('risk_categories',     'risks.read', 'risks.write'),
      ('risk_factors',        'risks.read', 'risks.write'),
      ('risks',               'risks.read', 'risks.write'),
      ('risk_causes',         'risks.read', 'risks.write'),
      ('risk_entries',        'risks.read', 'risks.write'),
      ('risk_entry_controls', 'risks.read', 'risks.write')
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

-- Apetito y tolerancia por categoría: solo quien parametriza la metodología
create or replace function app.risk_categories_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_org_id() is not null and not app.has_permission('risks.configure') then
    if tg_op = 'INSERT' then
      new.appetite := null; new.tolerance := null;
    else
      new.appetite := old.appetite; new.tolerance := old.tolerance;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.risk_categories_guard() from public, anon;
create trigger risk_categories_guard before insert or update on public.risk_categories
  for each row execute function app.risk_categories_guard();

-- Procesos nuevos también desde riesgos y planes
create or replace function public.ensure_process(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid := app.current_org_id();
  v_name text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 160);
  v_id   uuid;
begin
  if v_org is null or not (app.has_permission('assets.write') or app.has_permission('controls.write')
                           or app.has_permission('documents.write') or app.has_permission('risks.write')
                           or app.has_permission('plans.write')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(v_name) < 2 then
    raise exception 'El nombre del proceso debe tener al menos 2 caracteres' using errcode = '22023';
  end if;
  select p.id into v_id from public.processes p
   where p.organization_id = v_org and (lower(p.name) = lower(v_name) or lower(p.code) = lower(v_name))
   order by p.active desc limit 1;
  if v_id is null then
    insert into public.processes (organization_id, name) values (v_org, v_name) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- La metodología solo cambia con risk_methodology_save; no se borra
revoke insert, update, delete on public.risk_methodologies from authenticated;
revoke update on public.risk_entries from authenticated;
grant update (risk_id, cause_id, category_id, threat_event, consequence, process_id, asset_type_id, owner_id, owner_text,
              treatment_strategy, treatment_description, materialized_count, last_materialized_on, active)
  on public.risk_entries to authenticated;
grant update (risk_entry_id) on public.actions to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['risk_methodologies', 'risks', 'risk_causes', 'risk_entries'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
                   t || '_touch', t);
  end loop;
end $$;
