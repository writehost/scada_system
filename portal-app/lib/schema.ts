/**
 * Таблицы портала. Живут в той же базе, что и WMS/YMS, но только с префиксом
 * `portal_` — существующие таблицы не трогаются.
 */
export const PORTAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS portal_access_requests (
  id BIGSERIAL PRIMARY KEY,
  public_no TEXT GENERATED ALWAYS AS ('SR-' || lpad(id::text, 6, '0')) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  job_title TEXT NOT NULL,
  phone TEXT,
  comment TEXT,
  consent_at TIMESTAMPTZ NOT NULL,
  consent_version TEXT NOT NULL,
  requested_modules TEXT[] NOT NULL,
  approved_modules TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_review','approved','rejected','invited','access_granted')),
  assignee_subject TEXT,
  assignee_name TEXT,
  organization_ref TEXT,
  organization_name TEXT,
  decision_note TEXT,
  submitted_subject TEXT,
  scada_user_id TEXT,
  invite_kind TEXT CHECK (invite_kind IN ('new_user','existing_user')),
  invite_token_hash TEXT,
  invite_expires_at TIMESTAMPTZ,
  invite_sent_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  ip_hash TEXT,
  user_agent TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_access_requests_public_no ON portal_access_requests (public_no);
CREATE INDEX IF NOT EXISTS portal_access_requests_status ON portal_access_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_access_requests_email ON portal_access_requests (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS portal_access_requests_invite ON portal_access_requests (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS portal_request_events (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES portal_access_requests(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('applicant','admin','system')),
  actor_subject TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS portal_request_events_request ON portal_request_events (request_id, at);

CREATE TABLE IF NOT EXISTS portal_access_grants (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES portal_access_requests(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  scada_id_app TEXT NOT NULL,
  organization_ref TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','provisioned','manual','failed')),
  detail TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, product_key)
);

CREATE TABLE IF NOT EXISTS portal_mail_outbox (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT REFERENCES portal_access_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  recipients TEXT[] NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS portal_mail_outbox_request ON portal_mail_outbox (request_id);

CREATE TABLE IF NOT EXISTS portal_rate_hits (
  bucket TEXT NOT NULL,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_rate_hits_bucket ON portal_rate_hits (bucket, hit_at DESC);
`
