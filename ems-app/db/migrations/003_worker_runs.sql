-- Состояние фоновых задач для мониторинга платформы.
CREATE TABLE ems_worker_runs (
  job TEXT PRIMARY KEY,
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  last_duration_ms INT,
  last_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  runs BIGINT NOT NULL DEFAULT 0,
  failures BIGINT NOT NULL DEFAULT 0
);

-- Напоминания об обязательствах: одно напоминание каждого вида на срок.
CREATE TABLE ems_reminders_sent (
  obligation_id UUID NOT NULL REFERENCES ems_obligations(obligation_id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES ems_organizations(org_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('payment_due', 'payment_overdue', 'readings_due')),
  due_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (obligation_id, kind, due_date)
);
ALTER TABLE ems_reminders_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE ems_reminders_sent FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ems_reminders_sent USING (ems_system_scope() OR org_id = ems_current_org()) WITH CHECK (ems_system_scope() OR org_id = ems_current_org());
