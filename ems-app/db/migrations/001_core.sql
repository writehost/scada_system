-- SCADA EMS: основная схема.
-- Все таблицы с данными клиента несут org_id и закрыты политикой RLS
-- (см. конец файла). Приложение выставляет ems.org_id на транзакцию;
-- фоновые задачи явно включают ems.scope = 'system'.

CREATE TABLE ems_organizations (
  org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'corporate')),
  segment TEXT NOT NULL CHECK (segment IN ('home', 'industrial')),
  scada_org_slug TEXT UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE ems_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scada_subject TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL,
  is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  personal_org_id UUID REFERENCES ems_organizations(org_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE ems_memberships (
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ems_users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'engineer', 'accountant', 'viewer')),
  source TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner', 'scada_id', 'invite')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX ems_memberships_user ON ems_memberships (user_id);

CREATE TABLE ems_invitations (
  invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'engineer', 'accountant', 'viewer')),
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX ems_invitations_email ON ems_invitations (lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE ems_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ems_users(user_id) ON DELETE CASCADE,
  active_org_id UUID REFERENCES ems_organizations(org_id),
  kind TEXT NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'mobile')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX ems_sessions_user ON ems_sessions (user_id) WHERE revoked_at IS NULL;

-- ── Объекты и иерархия ──────────────────────────────────────────────

CREATE TABLE ems_sites (
  site_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('apartment', 'house', 'garage', 'office', 'workshop',
    'plant', 'warehouse', 'commercial', 'utility', 'other')),
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  shifts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX ems_sites_org ON ems_sites (org_id) WHERE archived_at IS NULL;

CREATE TABLE ems_nodes (
  node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES ems_sites(site_id) ON DELETE CASCADE,
  parent_id UUID REFERENCES ems_nodes(node_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('building', 'zone', 'line', 'cabinet', 'point', 'other')),
  name TEXT NOT NULL,
  code TEXT,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX ems_nodes_site ON ems_nodes (site_id);

-- ── Оборудование ───────────────────────────────────────────────────

CREATE TABLE ems_gateways (
  gateway_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES ems_sites(site_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'online', 'offline', 'disabled')),
  secret_hash TEXT,
  secret_rotated_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  last_ip TEXT,
  agent_version TEXT,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX ems_gateways_org ON ems_gateways (org_id);

CREATE TABLE ems_gateway_enrollments (
  code_hash TEXT PRIMARY KEY,
  gateway_id UUID NOT NULL REFERENCES ems_gateways(gateway_id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE ems_meters (
  meter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES ems_sites(site_id) ON DELETE CASCADE,
  node_id UUID REFERENCES ems_nodes(node_id) ON DELETE SET NULL,
  resource TEXT NOT NULL CHECK (resource IN ('electricity', 'cold_water', 'hot_water', 'heat', 'gas', 'leak', 'other')),
  name TEXT NOT NULL,
  serial_number TEXT,
  manufacturer TEXT,
  model TEXT,
  catalog_model_id TEXT,
  connection TEXT NOT NULL DEFAULT 'manual' CHECK (connection IN ('manual', 'modbus_tcp', 'http_push')),
  gateway_id UUID REFERENCES ems_gateways(gateway_id) ON DELETE SET NULL,
  connection_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  poll_interval_sec INT,
  telemetry_timeout_min INT NOT NULL DEFAULT 120,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'replaced', 'archived')),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  replaces_meter_id UUID REFERENCES ems_meters(meter_id),
  verification_due DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ems_meters_site ON ems_meters (site_id);
CREATE INDEX ems_meters_gateway ON ems_meters (gateway_id) WHERE gateway_id IS NOT NULL;

CREATE TABLE ems_channels (
  channel_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  meter_id UUID NOT NULL REFERENCES ems_meters(meter_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity TEXT NOT NULL CHECK (quantity IN ('energy_active', 'energy_reactive', 'power_active',
    'volume', 'flow_rate', 'heat_energy', 'pulse', 'temperature', 'leak')),
  measure_kind TEXT NOT NULL CHECK (measure_kind IN ('cumulative', 'instant')),
  unit TEXT NOT NULL,
  tariff_zone TEXT,
  is_billing BOOLEAN NOT NULL DEFAULT TRUE,
  register JSONB,
  multiplier DOUBLE PRECISION NOT NULL DEFAULT 1,
  value_offset DOUBLE PRECISION NOT NULL DEFAULT 0,
  rollover_at DOUBLE PRECISION,
  max_rate_per_hour DOUBLE PRECISION,
  decimals SMALLINT NOT NULL DEFAULT 3,
  last_value DOUBLE PRECISION,
  last_at TIMESTAMPTZ,
  last_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (meter_id, code)
);
CREATE INDEX ems_channels_org ON ems_channels (org_id);

-- История коэффициентов трансформации/импульса. Показание нормализуется
-- коэффициентом, действовавшим на момент измерения.
CREATE TABLE ems_channel_coefficients (
  channel_id BIGINT NOT NULL REFERENCES ems_channels(channel_id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  effective_from TIMESTAMPTZ NOT NULL,
  multiplier DOUBLE PRECISION NOT NULL,
  value_offset DOUBLE PRECISION NOT NULL DEFAULT 0,
  boundary_raw DOUBLE PRECISION,
  reason TEXT,
  changed_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, effective_from)
);

-- ── Телеметрия ─────────────────────────────────────────────────────
-- Показания секционированы по месяцам. Ключ (channel_id, measured_at)
-- одновременно защищает от повторной доставки.

CREATE TABLE ems_readings (
  org_id UUID NOT NULL,
  channel_id BIGINT NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_value DOUBLE PRECISION NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  coef DOUBLE PRECISION NOT NULL DEFAULT 1,
  delta DOUBLE PRECISION,
  prev_at TIMESTAMPTZ,
  delta_kind TEXT,
  quality TEXT NOT NULL CHECK (quality IN ('good', 'suspect', 'bad')),
  flags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL CHECK (source IN ('manual', 'modbus_tcp', 'http_push', 'gateway', 'import', 'demo')),
  entered_by UUID,
  note TEXT,
  PRIMARY KEY (channel_id, measured_at)
) PARTITION BY RANGE (measured_at);
CREATE INDEX ems_readings_attention ON ems_readings (org_id, measured_at) WHERE quality <> 'good';

CREATE TABLE ems_reading_corrections (
  correction_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES ems_channels(channel_id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'reject', 'restore', 'edit')),
  old_value DOUBLE PRECISION,
  new_value DOUBLE PRECISION,
  old_quality TEXT,
  new_quality TEXT,
  reason TEXT,
  actor_id UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ems_reading_corrections_channel ON ems_reading_corrections (channel_id, created_at DESC);

CREATE TABLE ems_reading_conflicts (
  conflict_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES ems_channels(channel_id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  existing_value DOUBLE PRECISION,
  incoming_value DOUBLE PRECISION,
  source TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Агрегаты. delta — потребление за интервал (накопительные каналы),
-- allocated — часть delta, распределённая пропорционально времени из
-- интервала между показаниями длиннее одной корзины.
CREATE TABLE ems_agg_hourly (
  channel_id BIGINT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  org_id UUID NOT NULL,
  delta DOUBLE PRECISION,
  allocated DOUBLE PRECISION NOT NULL DEFAULT 0,
  n INT NOT NULL DEFAULT 0,
  v_avg DOUBLE PRECISION,
  v_min DOUBLE PRECISION,
  v_max DOUBLE PRECISION,
  PRIMARY KEY (channel_id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE ems_agg_daily (
  channel_id BIGINT NOT NULL,
  day DATE NOT NULL,
  org_id UUID NOT NULL,
  delta DOUBLE PRECISION,
  allocated DOUBLE PRECISION NOT NULL DEFAULT 0,
  n INT NOT NULL DEFAULT 0,
  v_avg DOUBLE PRECISION,
  v_min DOUBLE PRECISION,
  v_max DOUBLE PRECISION,
  PRIMARY KEY (channel_id, day)
);
CREATE INDEX ems_agg_daily_org ON ems_agg_daily (org_id, day);

CREATE TABLE ems_partitions (
  table_name TEXT NOT NULL,
  month DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, month)
);

-- Создаёт месячную секцию, если её ещё нет. Вызывается при приёме данных
-- и плановой задачей на несколько месяцев вперёд.
CREATE OR REPLACE FUNCTION ems_ensure_month_partition(p_table TEXT, p_month DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m DATE := date_trunc('month', p_month)::date;
  part TEXT := p_table || '_' || to_char(m, 'YYYYMM');
BEGIN
  IF p_table NOT IN ('ems_readings', 'ems_agg_hourly') THEN
    RAISE EXCEPTION 'unsupported partitioned table %', p_table;
  END IF;
  IF EXISTS (SELECT 1 FROM ems_partitions WHERE table_name = p_table AND month = m) THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ems_partition:' || part));
  IF to_regclass(part) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
      part, p_table,
      (m::timestamp AT TIME ZONE 'UTC'),
      ((m + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC')
    );
  END IF;
  INSERT INTO ems_partitions (table_name, month) VALUES (p_table, m) ON CONFLICT DO NOTHING;
END;
$$;
-- Роль приложения создаёт секции только через эту функцию и не нуждается в правах DDL.
REVOKE ALL ON FUNCTION ems_ensure_month_partition(TEXT, DATE) FROM PUBLIC;

-- Выпуск продукции (опциональная интеграция с MES/APS/WMS).
CREATE TABLE ems_production (
  production_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES ems_sites(site_id) ON DELETE CASCADE,
  node_id UUID REFERENCES ems_nodes(node_id) ON DELETE SET NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  external_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);
CREATE UNIQUE INDEX ems_production_dedup ON ems_production (org_id, site_id, COALESCE(node_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end, source);

CREATE TABLE ems_gateway_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  gateway_id UUID NOT NULL REFERENCES ems_gateways(gateway_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('probe', 'reload_config')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'expired')),
  result JSONB,
  error TEXT,
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  picked_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX ems_gateway_jobs_queue ON ems_gateway_jobs (gateway_id, created_at) WHERE status = 'queued';

CREATE TABLE ems_connection_log (
  log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  gateway_id UUID REFERENCES ems_gateways(gateway_id) ON DELETE CASCADE,
  meter_id UUID REFERENCES ems_meters(meter_id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ems_connection_log_meter ON ems_connection_log (meter_id, created_at DESC);
CREATE INDEX ems_connection_log_gateway ON ems_connection_log (gateway_id, created_at DESC);

CREATE TABLE ems_meter_tokens (
  token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  meter_id UUID NOT NULL REFERENCES ems_meters(meter_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE ems_api_tokens (
  token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- ── Финансы ────────────────────────────────────────────────────────

CREATE TABLE ems_providers (
  provider_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Лицевой счёт / услуга объекта.
CREATE TABLE ems_accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES ems_sites(site_id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('electricity', 'cold_water', 'hot_water', 'wastewater',
    'heating', 'gas', 'internet', 'other')),
  title TEXT NOT NULL,
  provider_id UUID REFERENCES ems_providers(provider_id) ON DELETE SET NULL,
  account_number TEXT,
  calc_method TEXT NOT NULL CHECK (calc_method IN ('meter', 'fixed', 'manual')),
  budget_month NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX ems_accounts_site ON ems_accounts (site_id);

CREATE TABLE ems_tariffs (
  tariff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES ems_accounts(account_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('single', 'zones', 'hot_water', 'fixed', 'wastewater')),
  valid_from DATE NOT NULL,
  valid_to DATE,
  currency TEXT NOT NULL DEFAULT 'RUB',
  config JSONB NOT NULL,
  source_note TEXT,
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ems_tariffs_account ON ems_tariffs (account_id, valid_from);

-- Начисление: фактическое (из квитанции) или рассчитанное и зафиксированное.
CREATE TABLE ems_charges (
  charge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES ems_accounts(account_id) ON DELETE CASCADE,
  period DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('actual', 'calculated')),
  quantity DOUBLE PRECISION,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, period, source)
);

CREATE TABLE ems_obligations (
  obligation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  site_id UUID REFERENCES ems_sites(site_id) ON DELETE CASCADE,
  account_id UUID REFERENCES ems_accounts(account_id) ON DELETE SET NULL,
  series_id UUID NOT NULL DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  service TEXT NOT NULL,
  provider_name TEXT,
  account_number TEXT,
  amount_mode TEXT NOT NULL CHECK (amount_mode IN ('fixed', 'calculated', 'manual')),
  amount NUMERIC(12, 2),
  due_date DATE NOT NULL,
  readings_due_date DATE,
  recurrence JSONB NOT NULL DEFAULT '{"freq":"none"}'::jsonb,
  remind_days SMALLINT NOT NULL DEFAULT 3 CHECK (remind_days BETWEEN 0 AND 60),
  readings_remind_days SMALLINT NOT NULL DEFAULT 2 CHECK (readings_remind_days BETWEEN 0 AND 60),
  recipient_ids UUID[] NOT NULL DEFAULT '{}',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at TIMESTAMPTZ,
  paid_amount NUMERIC(12, 2),
  paid_by UUID REFERENCES ems_users(user_id),
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ems_obligations_due ON ems_obligations (org_id, due_date) WHERE status = 'pending';
CREATE UNIQUE INDEX ems_obligations_series_due ON ems_obligations (series_id, due_date);

CREATE TABLE ems_payments (
  payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  obligation_id UUID NOT NULL REFERENCES ems_obligations(obligation_id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  paid_on DATE NOT NULL,
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'integration')),
  confirmed_by UUID REFERENCES ems_users(user_id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Уведомления и события ──────────────────────────────────────────

CREATE TABLE ems_email_recipients (
  recipient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  label TEXT,
  verified_at TIMESTAMPTZ,
  verify_token_hash TEXT,
  verify_expires_at TIMESTAMPTZ,
  verify_sent_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  paused_until TIMESTAMPTZ,
  kinds TEXT[] NOT NULL DEFAULT ARRAY['payment_due', 'readings_due', 'anomaly', 'telemetry_lost', 'leak', 'limit', 'equipment'],
  site_ids UUID[],
  send_hour SMALLINT NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ems_email_recipients_unique ON ems_email_recipients (org_id, lower(email));

CREATE TABLE ems_alert_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  site_id UUID REFERENCES ems_sites(site_id) ON DELETE CASCADE,
  meter_id UUID REFERENCES ems_meters(meter_id) ON DELETE CASCADE,
  channel_id BIGINT REFERENCES ems_channels(channel_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('telemetry_lost', 'power_over', 'flow_over', 'continuous_flow',
    'night_usage', 'consumption_growth', 'budget_over', 'monthly_limit')),
  name TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notify BOOLEAN NOT NULL DEFAULT TRUE,
  repeat_minutes INT CHECK (repeat_minutes IS NULL OR repeat_minutes >= 15),
  window_from SMALLINT CHECK (window_from BETWEEN 0 AND 23),
  window_to SMALLINT CHECK (window_to BETWEEN 0 AND 24),
  last_evaluated_at TIMESTAMPTZ,
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ems_alert_rules_org ON ems_alert_rules (org_id) WHERE enabled;

CREATE TABLE ems_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  site_id UUID REFERENCES ems_sites(site_id) ON DELETE CASCADE,
  meter_id UUID REFERENCES ems_meters(meter_id) ON DELETE CASCADE,
  channel_id BIGINT REFERENCES ems_channels(channel_id) ON DELETE CASCADE,
  gateway_id UUID REFERENCES ems_gateways(gateway_id) ON DELETE CASCADE,
  rule_id UUID REFERENCES ems_alert_rules(rule_id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('anomaly', 'telemetry_lost', 'leak', 'limit', 'equipment', 'data_quality', 'billing')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  dedup_key TEXT NOT NULL,
  occurrences INT NOT NULL DEFAULT 1,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES ems_users(user_id),
  ack_note TEXT,
  resolved_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX ems_events_open_dedup ON ems_events (org_id, dedup_key) WHERE status <> 'resolved';
CREATE INDEX ems_events_org_time ON ems_events (org_id, opened_at DESC);

CREATE TABLE ems_notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  recipient TEXT NOT NULL,
  recipient_id UUID REFERENCES ems_email_recipients(recipient_id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  link TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  dedup_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, dedup_key)
);
CREATE INDEX ems_notifications_queue ON ems_notifications (next_attempt_at) WHERE status IN ('queued', 'failed');

-- Лента для мобильного клиента: одна запись на логическое уведомление.
CREATE TABLE ems_feed (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  site_id UUID,
  dedup_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, dedup_key)
);
CREATE INDEX ems_feed_org_seq ON ems_feed (org_id, seq);

-- ── Подписки SCADA EMS (не путать с коммунальными платежами) ───────

CREATE TABLE ems_plans (
  plan_code TEXT PRIMARY KEY,
  segment TEXT NOT NULL CHECK (segment IN ('home', 'industrial')),
  name TEXT NOT NULL,
  description TEXT,
  price_month NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'RUB',
  limits JSONB NOT NULL,
  features TEXT[] NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  is_trial BOOLEAN NOT NULL DEFAULT FALSE,
  sort INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES ems_users(user_id)
);

CREATE TABLE ems_subscriptions (
  org_id UUID PRIMARY KEY REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES ems_plans(plan_code),
  status TEXT NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'expired', 'cancelled')),
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  limits_override JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ems_subscription_history (
  history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  from_plan TEXT,
  to_plan TEXT,
  from_status TEXT,
  to_status TEXT,
  period_end TIMESTAMPTZ,
  actor_id UUID REFERENCES ems_users(user_id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ems_usage_counters (
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  month DATE NOT NULL,
  emails_sent INT NOT NULL DEFAULT 0,
  readings_ingested BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, month)
);

-- ── Каталог совместимого оборудования ──────────────────────────────

CREATE TABLE ems_catalog_models (
  model_id TEXT PRIMARY KEY,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  device_kind TEXT NOT NULL CHECK (device_kind IN ('meter', 'gateway', 'pulse_module', 'sensor', 'converter')),
  resource TEXT,
  protocols TEXT[] NOT NULL DEFAULT '{}',
  requires TEXT,
  power TEXT,
  transport TEXT,
  instruction TEXT NOT NULL,
  compatibility TEXT NOT NULL CHECK (compatibility IN ('verified', 'profile_untested', 'manual_only', 'planned')),
  channel_template JSONB NOT NULL DEFAULT '[]'::jsonb,
  connection_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  orderable BOOLEAN NOT NULL DEFAULT FALSE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE ems_device_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES ems_catalog_models(model_id),
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  contact_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processing', 'closed')),
  created_by UUID REFERENCES ems_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Журнал действий ────────────────────────────────────────────────

CREATE TABLE ems_audit_log (
  audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id UUID,
  actor_id UUID,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'gateway', 'system', 'api_token', 'device')),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ems_audit_org ON ems_audit_log (org_id, created_at DESC);

-- ── Изоляция организаций (Row Level Security) ──────────────────────

CREATE OR REPLACE FUNCTION ems_current_org() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('ems.org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION ems_system_scope() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('ems.scope', true), '') = 'system'
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ems_sites', 'ems_nodes', 'ems_gateways', 'ems_gateway_enrollments', 'ems_meters', 'ems_channels',
    'ems_channel_coefficients', 'ems_readings', 'ems_reading_corrections', 'ems_reading_conflicts',
    'ems_agg_hourly', 'ems_agg_daily', 'ems_production', 'ems_gateway_jobs', 'ems_connection_log',
    'ems_meter_tokens', 'ems_api_tokens', 'ems_providers', 'ems_accounts', 'ems_tariffs', 'ems_charges',
    'ems_obligations', 'ems_payments', 'ems_email_recipients', 'ems_alert_rules', 'ems_events',
    'ems_notifications', 'ems_feed', 'ems_subscriptions', 'ems_subscription_history', 'ems_usage_counters',
    'ems_device_requests', 'ems_invitations', 'ems_memberships'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (ems_system_scope() OR org_id = ems_current_org()) '
      'WITH CHECK (ems_system_scope() OR org_id = ems_current_org())', t);
  END LOOP;
END $$;
