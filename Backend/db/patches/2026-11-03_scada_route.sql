-- SCADA System Route: таблицы навигатора погрузчика (YMS, база wms_edge).
-- То же самое создаёт приложение при первом обращении к /api/route/* (lib/route/schema.ts).
-- Остатки, палеты, адреса и пользователи WMS не меняются; новые таблицы — только route_*.
-- Роли/права Route добавляются приложением в wms_roles/wms_permissions (route_driver, route_dispatcher, ...).
BEGIN;
CREATE TABLE IF NOT EXISTS route_forklift_profiles (
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  kara_id TEXT NOT NULL,
  forklift_type TEXT NOT NULL DEFAULT 'counterbalance',
  width_m NUMERIC(5,2),
  height_m NUMERIC(5,2),
  capacity_kg NUMERIC(8,1),
  status TEXT NOT NULL DEFAULT 'active',
  auto_assign BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, kara_id)
);

CREATE TABLE IF NOT EXISTS route_driver_sessions (
  session_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  user_id TEXT,
  login TEXT NOT NULL,
  fio TEXT NOT NULL,
  kara_id TEXT NOT NULL,
  kara_name TEXT,
  shift_code TEXT,
  device_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS route_driver_sessions_user_uidx
  ON route_driver_sessions (site_id, lower(login)) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS route_driver_sessions_kara_uidx
  ON route_driver_sessions (site_id, kara_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS route_map_versions (
  map_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  version INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT,
  geometry JSONB NOT NULL,
  based_on INT,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by TEXT,
  published_at TIMESTAMPTZ,
  revision INT NOT NULL DEFAULT 1,
  UNIQUE (site_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS route_map_published_uidx
  ON route_map_versions (site_id) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS route_map_changes (
  change_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  map_id BIGINT NOT NULL REFERENCES route_map_versions(map_id) ON DELETE CASCADE,
  version INT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor_login TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route_edge_blocks (
  block_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  until_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  released_by TEXT
);
CREATE INDEX IF NOT EXISTS route_edge_blocks_active_idx
  ON route_edge_blocks (site_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS route_tasks (
  task_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  task_no TEXT NOT NULL,
  task_type TEXT NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 50,
  status TEXT NOT NULL,
  resume_status TEXT,
  version INT NOT NULL DEFAULT 1,
  kara_id TEXT,
  driver_login TEXT,
  driver_user_id TEXT,
  source_code TEXT NOT NULL,
  source_node_id TEXT,
  dest_code TEXT NOT NULL,
  dest_node_id TEXT,
  hu_code TEXT NOT NULL,
  item_code TEXT,
  item_name TEXT,
  lot_code TEXT,
  qty NUMERIC(14,3),
  expiry_at TIMESTAMPTZ,
  wms_ref_kind TEXT,
  wms_ref_id TEXT,
  load_scan_id BIGINT,
  address_scan_id BIGINT,
  wms_movement_request_id UUID,
  wms_movement_status TEXT,
  wms_movement_result JSONB,
  blocked_reason TEXT,
  cancel_reason TEXT,
  note TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  offered_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  loaded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (site_id, task_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS route_tasks_wms_ref_uidx
  ON route_tasks (site_id, wms_ref_kind, wms_ref_id)
  WHERE wms_ref_id IS NOT NULL AND status NOT IN ('CANCELLED');
CREATE UNIQUE INDEX IF NOT EXISTS route_tasks_one_active_per_kara_uidx
  ON route_tasks (site_id, kara_id)
  WHERE kara_id IS NOT NULL AND status IN ('ACCEPTED','EN_ROUTE_PICKUP','AT_PICKUP','LOAD_CONFIRMED','EN_ROUTE_DROPOFF','AT_DROPOFF');
CREATE UNIQUE INDEX IF NOT EXISTS route_tasks_one_open_per_hu_uidx
  ON route_tasks (site_id, hu_code)
  WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE INDEX IF NOT EXISTS route_tasks_queue_idx ON route_tasks (site_id, status, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS route_task_events (
  event_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  task_id BIGINT NOT NULL REFERENCES route_tasks(task_id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  version INT,
  actor_login TEXT,
  actor_user_id TEXT,
  kara_id TEXT,
  reason TEXT,
  client_request_id TEXT,
  wms_state JSONB,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS route_task_events_request_uidx
  ON route_task_events (site_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS route_task_events_task_idx ON route_task_events (task_id, event_id);

CREATE TABLE IF NOT EXISTS route_scan_events (
  scan_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  task_id BIGINT REFERENCES route_tasks(task_id) ON DELETE CASCADE,
  task_version INT,
  code TEXT NOT NULL,
  code_type TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'scanner',
  manual_reason TEXT,
  result TEXT NOT NULL,
  reject_code TEXT,
  message TEXT,
  expected_code TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_login TEXT,
  device_id TEXT,
  client_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS route_scan_events_request_uidx
  ON route_scan_events (site_id, client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS route_exceptions (
  exception_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  task_id BIGINT REFERENCES route_tasks(task_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  actor_login TEXT,
  kara_id TEXT,
  task_status TEXT,
  wms_state JSONB,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  client_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS route_exceptions_request_uidx
  ON route_exceptions (site_id, client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS route_positions (
  site_id INT NOT NULL,
  kara_id TEXT NOT NULL,
  x NUMERIC(10,2) NOT NULL,
  y NUMERIC(10,2) NOT NULL,
  z NUMERIC(8,3),
  heading_deg NUMERIC(6,2),
  quality NUMERIC(4,3) NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  tag_ids INT[] NOT NULL DEFAULT '{}',
  reproj_error_px NUMERIC(8,3),
  measured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  set_by TEXT,
  PRIMARY KEY (site_id, kara_id)
);

CREATE TABLE IF NOT EXISTS route_position_log (
  log_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  kara_id TEXT NOT NULL,
  x NUMERIC(10,2),
  y NUMERIC(10,2),
  heading_deg NUMERIC(6,2),
  quality NUMERIC(4,3),
  source TEXT NOT NULL,
  state TEXT NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS route_position_log_kara_idx ON route_position_log (site_id, kara_id, log_id DESC);

CREATE TABLE IF NOT EXISTS route_apriltag_markers (
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  tag_id INT NOT NULL,
  zone TEXT,
  object_code TEXT,
  x NUMERIC(10,2) NOT NULL,
  y NUMERIC(10,2) NOT NULL,
  z_m NUMERIC(6,3) NOT NULL DEFAULT 0,
  yaw_deg NUMERIC(6,2) NOT NULL DEFAULT 0,
  pitch_deg NUMERIC(6,2) NOT NULL DEFAULT 0,
  roll_deg NUMERIC(6,2) NOT NULL DEFAULT 0,
  size_m NUMERIC(6,4) NOT NULL,
  mount_height_m NUMERIC(6,3),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  calibrated_at TIMESTAMPTZ,
  note TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, family, tag_id)
);

CREATE TABLE IF NOT EXISTS route_camera_calibrations (
  calibration_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  kara_id TEXT,
  camera_serial TEXT NOT NULL,
  lens TEXT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  version INT NOT NULL,
  camera_matrix JSONB NOT NULL,
  dist_coeffs JSONB NOT NULL,
  rms_px NUMERIC(8,4),
  camera_to_forklift JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, camera_serial, lens, width, height, version)
);

CREATE TABLE IF NOT EXISTS route_devices (
  device_id TEXT NOT NULL,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  kara_id TEXT,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (site_id, device_id)
);

CREATE TABLE IF NOT EXISTS route_events (
  event_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  topic TEXT NOT NULL,
  kara_id TEXT,
  task_id BIGINT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS route_events_site_idx ON route_events (site_id, event_id);

CREATE TABLE IF NOT EXISTS route_settings (
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, key)
);
COMMIT;
