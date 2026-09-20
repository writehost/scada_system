-- Справочник получателей для выдачи в цех (свободная выдача).
CREATE TABLE IF NOT EXISTS wms_issue_recipient_defs (
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  recipient_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  position TEXT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, recipient_code)
);

CREATE INDEX IF NOT EXISTS ix_wms_issue_recipient_defs_site_sort
  ON wms_issue_recipient_defs(site_id, sort_order, display_name);
