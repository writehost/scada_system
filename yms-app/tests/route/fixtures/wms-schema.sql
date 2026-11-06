-- Тестовая схема WMS (подмножество таблиц wms_edge, которые читает/пишет Route и интеграционный слой WMS).
-- Колонки взяты из запросов в lib/wms/* основного приложения. НЕ миграция для прода.

CREATE TABLE wms_sites (site_id SERIAL PRIMARY KEY, site_code TEXT UNIQUE NOT NULL, name TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE);

CREATE TABLE wms_users (
  user_id BIGSERIAL PRIMARY KEY, site_id INT NOT NULL REFERENCES wms_sites(site_id), login TEXT NOT NULL,
  display_name TEXT NOT NULL, position TEXT, external_code TEXT, phone TEXT, password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX wms_users_login_uidx ON wms_users (lower(login));
CREATE TABLE wms_roles (role_id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT);
CREATE TABLE wms_user_roles (user_id BIGINT REFERENCES wms_users(user_id) ON DELETE CASCADE, role_id INT REFERENCES wms_roles(role_id), PRIMARY KEY (user_id, role_id));
CREATE TABLE wms_permissions (permission_id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT);
CREATE TABLE wms_role_permissions (role_id INT REFERENCES wms_roles(role_id), permission_id INT REFERENCES wms_permissions(permission_id), PRIMARY KEY (role_id, permission_id));

CREATE TABLE wms_items (
  item_id BIGSERIAL PRIMARY KEY, site_id INT NOT NULL, item_code TEXT NOT NULL, name TEXT NOT NULL, uom_code TEXT DEFAULT 'pcs',
  item_type_code TEXT DEFAULT 'finished_goods', is_active BOOLEAN DEFAULT TRUE, sku TEXT, item_group_code TEXT, product_group TEXT,
  item_class_code TEXT, item_subgroup TEXT, item_nomenclature TEXT
);
CREATE TABLE wms_lots (lot_id BIGSERIAL PRIMARY KEY, site_id INT, item_id BIGINT, lot_code TEXT, expiry_at TIMESTAMPTZ, best_before_at TIMESTAMPTZ, is_blocked BOOLEAN DEFAULT FALSE);
CREATE TABLE codes (
  code_id BIGSERIAL PRIMARY KEY, ai01_gtin TEXT, ai21_serial TEXT, raw BYTEA, parent_code_id BIGINT REFERENCES codes(code_id),
  lot_id BIGINT, ai93 TEXT, ai93_tail TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE code_state (code_id BIGINT PRIMARY KEY, status_id INT, introduced_at TIMESTAMPTZ, emitted_at TIMESTAMPTZ);

CREATE TABLE wms_warehouses (warehouse_id BIGSERIAL PRIMARY KEY, site_id INT, warehouse_code TEXT, name TEXT, warehouse_type TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE (site_id, warehouse_code));
CREATE TABLE wms_zones (zone_id BIGSERIAL PRIMARY KEY, warehouse_id BIGINT, zone_code TEXT, name TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (warehouse_id, zone_code));
CREATE TABLE wms_locations (
  location_id BIGSERIAL PRIMARY KEY, site_id INT NOT NULL, warehouse_id BIGINT, zone_id BIGINT, location_code TEXT NOT NULL, display_name TEXT,
  location_status_id SMALLINT NOT NULL DEFAULT 1, accuracy_status_id SMALLINT DEFAULT 1, is_pick_face BOOLEAN DEFAULT FALSE, revision_version INT DEFAULT 1,
  location_attrs_json JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE (site_id, location_code)
);
CREATE TABLE wms_item_codes (
  wms_item_code_id BIGSERIAL PRIMARY KEY, code_id BIGINT NOT NULL REFERENCES codes(code_id), item_id BIGINT NOT NULL REFERENCES wms_items(item_id),
  current_site_id INT, current_location_id BIGINT REFERENCES wms_locations(location_id), pack_level TEXT, linked_at TIMESTAMPTZ DEFAULT now(), unlinked_at TIMESTAMPTZ
);
CREATE TABLE wms_stock_balances (
  balance_id BIGSERIAL PRIMARY KEY, site_id INT, location_id BIGINT, item_id BIGINT, available_qty NUMERIC(14,3) DEFAULT 0, reserved_qty NUMERIC(14,3) DEFAULT 0,
  in_production_qty NUMERIC(14,3) DEFAULT 0, in_transit_qty NUMERIC(14,3) DEFAULT 0, quarantine_qty NUMERIC(14,3) DEFAULT 0, rejected_qty NUMERIC(14,3) DEFAULT 0,
  accuracy_status_id SMALLINT DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE (site_id, location_id, item_id)
);
CREATE TABLE wms_stock_lots (
  stock_lot_id BIGSERIAL PRIMARY KEY, balance_id BIGINT, lot_id BIGINT, lot_code TEXT, batch_label TEXT, expiry_at TIMESTAMPTZ,
  available_qty NUMERIC(14,3) DEFAULT 0, reserved_qty NUMERIC(14,3) DEFAULT 0, in_production_qty NUMERIC(14,3) DEFAULT 0, in_transit_qty NUMERIC(14,3) DEFAULT 0,
  quarantine_qty NUMERIC(14,3) DEFAULT 0, rejected_qty NUMERIC(14,3) DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE (balance_id, lot_code)
);
CREATE TABLE wms_stock_movements (
  movement_id BIGSERIAL PRIMARY KEY, site_id INT, movement_type_id INT, document_id BIGINT, document_line_id BIGINT, item_id BIGINT, lot_id BIGINT,
  from_location_id BIGINT, to_location_id BIGINT, from_bucket_id INT, to_bucket_id INT, qty NUMERIC(14,3), request_id UUID, payload_json JSONB, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE wms_stock_events (
  event_id BIGSERIAL PRIMARY KEY, site_id INT, event_type TEXT, actor_user_id BIGINT, device_uid TEXT, document_id BIGINT, item_id BIGINT, location_id BIGINT,
  payload_json JSONB, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE wms_operation_events (
  event_id BIGSERIAL PRIMARY KEY, site_id INT, event_type TEXT, actor_user_id BIGINT, device_uid TEXT, document_id BIGINT, item_id BIGINT, location_id BIGINT,
  code_value TEXT, payload_json JSONB, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE wms_request_log (
  request_id UUID PRIMARY KEY, site_id INT, operation_code TEXT, request_status_id SMALLINT, request_payload JSONB, response_payload JSONB, applied_at TIMESTAMPTZ
);
CREATE TABLE wms_document_lines (document_line_id BIGSERIAL PRIMARY KEY, document_id BIGINT, load_unit_id BIGINT, requested_qty NUMERIC, confirmed_qty NUMERIC, source_location_id BIGINT);
CREATE TABLE wms_load_units (load_unit_id BIGSERIAL PRIMARY KEY, site_id INT, load_unit_code TEXT, document_id BIGINT, status_code TEXT, label TEXT);
CREATE TABLE wms_tasks (
  task_id BIGSERIAL PRIMARY KEY, site_id INT, task_type_id SMALLINT, task_status_id SMALLINT, task_priority_id SMALLINT, task_code TEXT UNIQUE,
  document_id BIGINT, document_line_id BIGINT, item_id BIGINT, source_warehouse_id BIGINT, target_warehouse_id BIGINT,
  source_location_id BIGINT, target_location_id BIGINT, planned_qty NUMERIC DEFAULT 1, confirmed_qty NUMERIC DEFAULT 0, sequence_no INT,
  due_at TIMESTAMPTZ, released_at TIMESTAMPTZ, claimed_at TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT now(),
  task_payload JSONB DEFAULT '{}'::jsonb, assigned_user_id BIGINT, assigned_device_id BIGINT, exception_code TEXT, exception_note TEXT
);
CREATE TABLE wms_fg_placement_reservations (site_id INT, lpn TEXT, task_id TEXT, reserved_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (site_id, lpn));
