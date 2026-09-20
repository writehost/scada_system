ALTER TABLE wms_users
  ADD COLUMN IF NOT EXISTS password_hash TEXT NULL;

ALTER TABLE wms_users
  ADD COLUMN IF NOT EXISTS position TEXT NULL;

CREATE INDEX IF NOT EXISTS ix_wms_users_login_lower
  ON wms_users (lower(login));
