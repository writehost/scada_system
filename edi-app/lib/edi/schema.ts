import type { PoolClient } from "pg"

/**
 * Схема EDI в общей базе wms_edge. Только добавляющие операции (CREATE ... IF NOT EXISTS,
 * ADD COLUMN IF NOT EXISTS): существующие таблицы WMS не изменяются и не удаляются.
 * Организация = wms_sites (арендатор SaaS), пользователь = wms_users.
 */
export const EDI_SCHEMA_VERSION = 1

const DDL = `
CREATE TABLE IF NOT EXISTS edi_schema_meta (
  id INT PRIMARY KEY DEFAULT 1,
  version INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_user_roles (
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES wms_users(user_id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,
  department TEXT,
  granted_by BIGINT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, user_id, role_code)
);

CREATE TABLE IF NOT EXISTS edi_user_profiles (
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES wms_users(user_id) ON DELETE CASCADE,
  department TEXT,
  email TEXT,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, user_id)
);

CREATE TABLE IF NOT EXISTS edi_org_settings (
  site_id INT PRIMARY KEY REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  legal_name TEXT,
  inn TEXT,
  kpp TEXT,
  ogrn TEXT,
  address TEXT,
  bank_name TEXT,
  bank_bik TEXT,
  bank_account TEXT,
  corr_account TEXT,
  phone TEXT,
  email TEXT,
  director TEXT,
  accountant TEXT,
  logo_file_id BIGINT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_counterparties (
  counterparty_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'legal',
  name TEXT NOT NULL,
  short_name TEXT,
  inn TEXT,
  kpp TEXT,
  ogrn TEXT,
  address_legal TEXT,
  address_actual TEXT,
  phone TEXT,
  email TEXT,
  contact_person TEXT,
  bank_name TEXT,
  bank_bik TEXT,
  bank_account TEXT,
  corr_account TEXT,
  edo_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  roles TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  wms_supplier_code TEXT,
  note TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS edi_counterparties_inn_kpp
  ON edi_counterparties (site_id, inn, COALESCE(kpp, '')) WHERE inn IS NOT NULL AND inn <> '';
CREATE UNIQUE INDEX IF NOT EXISTS edi_counterparties_wms
  ON edi_counterparties (site_id, upper(wms_supplier_code)) WHERE wms_supplier_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS edi_counterparties_name ON edi_counterparties (site_id, lower(name));

CREATE TABLE IF NOT EXISTS edi_files (
  file_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  document_id BIGINT,
  version_no INT,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  text_content TEXT,
  uploaded_by BIGINT,
  retention_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edi_files_document ON edi_files (document_id);

CREATE TABLE IF NOT EXISTS edi_documents (
  document_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  number TEXT,
  doc_date DATE,
  title TEXT NOT NULL,
  counterparty_id BIGINT REFERENCES edi_counterparties(counterparty_id),
  currency TEXT NOT NULL DEFAULT 'RUB',
  amount_net NUMERIC(18,2),
  amount_vat NUMERIC(18,2),
  amount_total NUMERIC(18,2),
  status TEXT NOT NULL DEFAULT 'draft',
  exchange_status TEXT NOT NULL DEFAULT 'none',
  wms_status TEXT,
  author_user_id BIGINT,
  responsible_user_id BIGINT,
  department TEXT,
  confidential BOOLEAN NOT NULL DEFAULT FALSE,
  current_version INT NOT NULL DEFAULT 1,
  signed_version INT,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  format_code TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  template_id BIGINT,
  due_date DATE,
  basis TEXT,
  last_action TEXT,
  last_action_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  search_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE edi_documents ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', search_text)) STORED;
CREATE INDEX IF NOT EXISTS edi_documents_site_updated ON edi_documents (site_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS edi_documents_site_status ON edi_documents (site_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS edi_documents_site_type ON edi_documents (site_id, doc_type);
CREATE INDEX IF NOT EXISTS edi_documents_site_cp ON edi_documents (site_id, counterparty_id);
CREATE INDEX IF NOT EXISTS edi_documents_site_date ON edi_documents (site_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS edi_documents_tsv ON edi_documents USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS edi_documents_number ON edi_documents (site_id, lower(number));

CREATE TABLE IF NOT EXISTS edi_document_lines (
  line_id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  name TEXT NOT NULL,
  supplier_code TEXT,
  gtin TEXT,
  okei TEXT,
  uom_name TEXT,
  qty NUMERIC(18,3) NOT NULL DEFAULT 0,
  price NUMERIC(18,4),
  amount_net NUMERIC(18,2),
  vat_rate TEXT,
  vat_amount NUMERIC(18,2),
  amount_total NUMERIC(18,2),
  item_code TEXT,
  item_name TEXT,
  match_source TEXT,
  uom_factor NUMERIC(18,6) NOT NULL DEFAULT 1,
  marking_codes TEXT[] NOT NULL DEFAULT '{}',
  lot_code TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS edi_document_lines_doc ON edi_document_lines (document_id, line_no);

CREATE TABLE IF NOT EXISTS edi_document_versions (
  version_id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  snapshot JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  reason TEXT,
  created_by BIGINT,
  created_by_name TEXT,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no)
);

CREATE TABLE IF NOT EXISTS edi_document_access (
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  access TEXT NOT NULL DEFAULT 'read',
  granted_by BIGINT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);

CREATE TABLE IF NOT EXISTS edi_relations (
  relation_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  from_document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  to_document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'related',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_document_id, to_document_id, kind)
);

CREATE TABLE IF NOT EXISTS edi_external_links (
  link_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  system TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  url TEXT,
  status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ,
  sync_error TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, system, object_type, object_id)
);
CREATE INDEX IF NOT EXISTS edi_external_links_obj ON edi_external_links (site_id, system, object_type, object_id);

CREATE TABLE IF NOT EXISTS edi_events (
  event_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  document_id BIGINT,
  actor_user_id BIGINT,
  actor_name TEXT,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edi_events_doc ON edi_events (document_id, event_id);
CREATE INDEX IF NOT EXISTS edi_events_site ON edi_events (site_id, event_id DESC);

CREATE TABLE IF NOT EXISTS edi_comments (
  comment_id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  author_user_id BIGINT,
  author_name TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_favorites (
  user_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_id)
);

CREATE TABLE IF NOT EXISTS edi_saved_views (
  view_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'filter',
  query JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_folder_items (
  view_id BIGINT NOT NULL REFERENCES edi_saved_views(view_id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  PRIMARY KEY (view_id, document_id)
);

CREATE TABLE IF NOT EXISTS edi_counters (
  site_id INT NOT NULL,
  counter_key TEXT NOT NULL,
  period TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, counter_key, period)
);

CREATE TABLE IF NOT EXISTS edi_templates (
  template_id BIGSERIAL PRIMARY KEY,
  site_id INT REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  layout JSONB NOT NULL DEFAULT '{}'::jsonb,
  numbering JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_roles TEXT[] NOT NULL DEFAULT '{}',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS edi_templates_code_ver ON edi_templates (COALESCE(site_id, 0), code, version);

CREATE TABLE IF NOT EXISTS edi_formats (
  format_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  doc_types TEXT[] NOT NULL DEFAULT '{}',
  knd TEXT,
  version TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  legal_basis TEXT,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_imports (
  import_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  created_by BIGINT,
  status TEXT NOT NULL DEFAULT 'parsed',
  source TEXT NOT NULL DEFAULT 'upload',
  file_id BIGINT REFERENCES edi_files(file_id),
  batch_key TEXT,
  detected_type TEXT,
  format_code TEXT,
  parsed JSONB NOT NULL DEFAULT '{}'::jsonb,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  document_id BIGINT REFERENCES edi_documents(document_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edi_imports_site ON edi_imports (site_id, import_id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS edi_imports_dedupe ON edi_imports (site_id, file_id) WHERE status IN ('parsed','needs_review','confirmed');

CREATE TABLE IF NOT EXISTS edi_item_mappings (
  mapping_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  supplier_inn TEXT NOT NULL,
  supplier_key TEXT NOT NULL,
  supplier_code TEXT,
  supplier_name TEXT NOT NULL,
  gtin TEXT,
  item_code TEXT NOT NULL,
  item_name TEXT,
  uom_factor NUMERIC(18,6) NOT NULL DEFAULT 1,
  use_count INT NOT NULL DEFAULT 0,
  confirmed_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, supplier_inn, supplier_key)
);

CREATE TABLE IF NOT EXISTS edi_workflow_defs (
  def_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  version INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  doc_types TEXT[] NOT NULL DEFAULT '{}',
  priority INT NOT NULL DEFAULT 100,
  definition JSONB NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, code, version)
);

CREATE TABLE IF NOT EXISTS edi_workflow_instances (
  instance_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  def_id BIGINT NOT NULL REFERENCES edi_workflow_defs(def_id),
  def_version INT NOT NULL,
  definition JSONB NOT NULL,
  document_version INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_by BIGINT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS edi_wf_instances_doc ON edi_workflow_instances (document_id, instance_id DESC);

CREATE TABLE IF NOT EXISTS edi_tasks (
  task_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  instance_id BIGINT REFERENCES edi_workflow_instances(instance_id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  step_id TEXT,
  step_index INT,
  step_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'approval',
  assignee_user_id BIGINT,
  assignee_role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT,
  comment TEXT,
  due_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  escalate_to_user_id BIGINT,
  completed_by BIGINT,
  completed_by_name TEXT,
  on_behalf_of BIGINT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edi_tasks_user ON edi_tasks (site_id, assignee_user_id, status);
CREATE INDEX IF NOT EXISTS edi_tasks_doc ON edi_tasks (document_id, task_id);
CREATE INDEX IF NOT EXISTS edi_tasks_due ON edi_tasks (status, due_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS edi_delegations (
  delegation_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  from_user_id BIGINT NOT NULL,
  to_user_id BIGINT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  reason TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS edi_notifications (
  notification_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  event TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  document_id BIGINT REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  task_id BIGINT,
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS edi_notifications_user ON edi_notifications (site_id, user_id, notification_id DESC);

CREATE TABLE IF NOT EXISTS edi_deliveries (
  delivery_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  notification_id BIGINT REFERENCES edi_notifications(notification_id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edi_deliveries_queue ON edi_deliveries (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS edi_jobs (
  job_id BIGSERIAL PRIMARY KEY,
  site_id INT,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS edi_jobs_dedupe ON edi_jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');
CREATE INDEX IF NOT EXISTS edi_jobs_queue ON edi_jobs (status, run_at);

CREATE TABLE IF NOT EXISTS edi_integrations (
  integration_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_enc TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  last_check_at TIMESTAMPTZ,
  last_check JSONB,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, kind, provider)
);

CREATE TABLE IF NOT EXISTS edi_exchanges (
  exchange_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  document_id BIGINT REFERENCES edi_documents(document_id) ON DELETE SET NULL,
  integration_id BIGINT REFERENCES edi_integrations(integration_id),
  direction TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL,
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  response JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS edi_exchange_receipts (
  receipt_id BIGSERIAL PRIMARY KEY,
  exchange_id BIGINT NOT NULL REFERENCES edi_exchanges(exchange_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_id BIGINT REFERENCES edi_files(file_id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_signatures (
  signature_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES edi_documents(document_id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  signed_file_id BIGINT NOT NULL REFERENCES edi_files(file_id),
  signature_file_id BIGINT NOT NULL REFERENCES edi_files(file_id),
  kind TEXT NOT NULL DEFAULT 'cades_detached',
  source TEXT NOT NULL DEFAULT 'upload',
  side TEXT NOT NULL DEFAULT 'own',
  signer_name TEXT,
  signer_inn TEXT,
  signer_title TEXT,
  cert_serial TEXT,
  cert_issuer TEXT,
  cert_valid_from TIMESTAMPTZ,
  cert_valid_to TIMESTAMPTZ,
  poa_number TEXT,
  signed_at TIMESTAMPTZ,
  verification_status TEXT NOT NULL DEFAULT 'not_verified',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_signature_checks (
  check_id BIGSERIAL PRIMARY KEY,
  signature_id BIGINT NOT NULL REFERENCES edi_signatures(signature_id) ON DELETE CASCADE,
  verifier TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_webhooks (
  webhook_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_plans (
  plan_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_note TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_subscriptions (
  site_id INT PRIMARY KEY REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES edi_plans(plan_code),
  status TEXT NOT NULL DEFAULT 'active',
  valid_to DATE,
  custom_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_usage_events (
  usage_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  kind TEXT NOT NULL,
  quantity NUMERIC(18,3) NOT NULL DEFAULT 1,
  document_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edi_usage_site ON edi_usage_events (site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS edi_retention_rules (
  site_id INT NOT NULL,
  doc_type TEXT NOT NULL,
  years INT NOT NULL,
  basis TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, doc_type)
);
`

export async function ensureEdiSchema(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock(hashtext('edi_schema'))")
  try {
    await client.query(DDL)
    await client.query(
      `INSERT INTO edi_schema_meta (id, version) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET version = GREATEST(edi_schema_meta.version, EXCLUDED.version), updated_at = now()`,
      [EDI_SCHEMA_VERSION]
    )
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('edi_schema'))")
  }
}

let ensured: Promise<void> | null = null

/** Один раз на процесс: схема EDI и справочные данные. */
export function ensureOnce(client: PoolClient, seed: (c: PoolClient) => Promise<void>): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ensureEdiSchema(client)
      await seed(client)
    })().catch((e) => {
      ensured = null
      throw e
    })
  }
  return ensured
}
