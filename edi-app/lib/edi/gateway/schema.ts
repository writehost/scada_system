export const GATEWAY_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS edi_documents_tenant_id ON edi_documents (site_id, document_id);
CREATE TABLE edi_provider_connections (
  connection_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id),
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  external_org_id TEXT,
  participant_id TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_enc TEXT,
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured','disabled','connected','error')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  incoming_cursor TEXT,
  outgoing_cursor TEXT,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  verified_at TIMESTAMPTZ,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, connection_id)
);
CREATE TABLE edi_external_instances (
  instance_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  connection_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL,
  external_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  status TEXT NOT NULL,
  business_fingerprint TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, connection_id) REFERENCES edi_provider_connections (site_id, connection_id),
  FOREIGN KEY (site_id, document_id) REFERENCES edi_documents (site_id, document_id),
  UNIQUE (connection_id, external_id),
  UNIQUE (site_id, instance_id)
);
CREATE INDEX edi_external_instances_journal ON edi_external_instances (site_id, connection_id, status, instance_id DESC);
CREATE INDEX edi_external_instances_duplicates ON edi_external_instances (site_id, business_fingerprint) WHERE business_fingerprint IS NOT NULL;
CREATE TABLE edi_provider_events (
  event_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  instance_id BIGINT NOT NULL,
  external_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, instance_id) REFERENCES edi_external_instances (site_id, instance_id),
  UNIQUE (instance_id, external_event_id)
);
`
