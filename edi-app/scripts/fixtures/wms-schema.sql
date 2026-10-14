-- Минимальная схема WMS ТОЛЬКО для интеграционного теста EDI на пустой базе.
-- Это не миграция: на заводе эти таблицы уже есть в wms_edge (полная схема WMS в этом репозитории не хранится).
-- Набор колонок восстановлен по запросам маршрутов WMS, которые вызывает EDI:
--   /api/wms/items, /api/wms/lookup, /api/wms/item-aliases/search, /api/wms/items/[code]/aliases,
--   /api/wms/directories/suppliers, /api/wms/receiving/inbound, /api/wms/receiving/stock-posts, /api/wms/notifications.

CREATE TABLE IF NOT EXISTS wms_sites (
  site_id SERIAL PRIMARY KEY,
  site_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  license_type TEXT,
  license_expires_at TIMESTAMPTZ,
  plan_code TEXT,
  features JSONB,
  max_users INT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS wms_users (
  user_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id),
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  position TEXT,
  external_code TEXT,
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS wms_roles (
  role_id SMALLSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT
);

CREATE TABLE IF NOT EXISTS wms_user_roles (
  user_id BIGINT NOT NULL REFERENCES wms_users(user_id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES wms_roles(role_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS wms_items (
  item_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id),
  item_code TEXT NOT NULL,
  short_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  item_type_code TEXT,
  sku TEXT,
  name TEXT NOT NULL,
  material_type TEXT,
  product_group TEXT,
  item_group_code TEXT,
  item_class_code TEXT,
  item_subgroup TEXT,
  packaging_format TEXT,
  packaging_profile TEXT,
  item_attrs_json JSONB,
  nomenclature TEXT,
  line_group TEXT,
  uom_code TEXT,
  is_marked BOOLEAN,
  is_perishable BOOLEAN,
  rotation_policy TEXT,
  shelf_life_days INT,
  expiry_warning_days INT,
  UNIQUE (site_id, item_code)
);

CREATE TABLE IF NOT EXISTS wms_item_barcodes (
  item_barcode_id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES wms_items(item_id),
  barcode TEXT NOT NULL UNIQUE,
  barcode_type TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_item_aliases (
  alias_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  item_id BIGINT NOT NULL REFERENCES wms_items(item_id),
  supplier_code TEXT,
  supplier_name TEXT,
  alias_name TEXT NOT NULL,
  alias_sku TEXT,
  gtin TEXT,
  source TEXT,
  confidence NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wms_item_aliases_uq
  ON wms_item_aliases (site_id, item_id, lower(alias_name), COALESCE(lower(supplier_code), '')) WHERE is_active;

CREATE TABLE IF NOT EXISTS ref_wms_accuracy_status (accuracy_status_id SMALLINT PRIMARY KEY, code TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ref_wms_location_status (location_status_id SMALLINT PRIMARY KEY, code TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS wms_locations (
  location_id BIGSERIAL PRIMARY KEY,
  site_id INT,
  location_code TEXT NOT NULL,
  location_status_id SMALLINT
);

CREATE TABLE IF NOT EXISTS wms_stock_balances (
  site_id INT NOT NULL,
  item_id BIGINT NOT NULL,
  location_id BIGINT,
  available_qty NUMERIC NOT NULL DEFAULT 0,
  reserved_qty NUMERIC NOT NULL DEFAULT 0,
  in_production_qty NUMERIC NOT NULL DEFAULT 0,
  in_transit_qty NUMERIC NOT NULL DEFAULT 0,
  quarantine_qty NUMERIC NOT NULL DEFAULT 0,
  rejected_qty NUMERIC NOT NULL DEFAULT 0,
  accuracy_status_id SMALLINT
);

CREATE TABLE IF NOT EXISTS wms_suppliers (
  supplier_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  supplier_code TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_id TEXT,
  meta_json JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS wms_code_lists (
  code_list_id BIGSERIAL PRIMARY KEY,
  request_id UUID UNIQUE,
  site_id INT NOT NULL,
  device_id BIGINT,
  device_uid TEXT,
  list_type TEXT NOT NULL,
  pallet_code TEXT,
  reason_code TEXT,
  entries_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_operation_events (
  event_id BIGSERIAL PRIMARY KEY,
  site_id INT,
  event_type TEXT,
  actor_user_id BIGINT,
  device_uid TEXT,
  document_id BIGINT,
  item_id BIGINT,
  location_id BIGINT,
  code_value TEXT,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_notifications (
  notification_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT,
  created_by_user_id BIGINT,
  ref_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_notification_recipients (
  notification_id BIGINT NOT NULL REFERENCES wms_notifications(notification_id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (notification_id, user_id)
);
