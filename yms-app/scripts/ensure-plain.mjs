import pg from "pg"

const DDL = `
CREATE TABLE IF NOT EXISTS yms_vehicles (
  vehicle_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'tent',
  carrier_name TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  body_length_m NUMERIC(6,2),
  capacity_kg NUMERIC(10,1),
  restrictions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, plate)
);

CREATE TABLE IF NOT EXISTS yms_yard_objects (
  object_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'free',
  x NUMERIC(8,2) NOT NULL DEFAULT 0,
  y NUMERIC(8,2) NOT NULL DEFAULT 0,
  w NUMERIC(8,2) NOT NULL DEFAULT 40,
  h NUMERIC(8,2) NOT NULL DEFAULT 24,
  allowed_vehicle_types TEXT[] NOT NULL DEFAULT '{}',
  allowed_operations TEXT[] NOT NULL DEFAULT '{}',
  current_visit_id BIGINT,
  blocked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

CREATE TABLE IF NOT EXISTS yms_visits (
  visit_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  visit_no TEXT NOT NULL,
  vehicle_id BIGINT NOT NULL REFERENCES yms_vehicles(vehicle_id),
  trailer_plate TEXT,
  carrier_name TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  counterparty TEXT,
  operation TEXT NOT NULL,
  planned_arrival TIMESTAMPTZ,
  actual_arrival TIMESTAMPTZ,
  parking_object_id BIGINT REFERENCES yms_yard_objects(object_id),
  dock_object_id BIGINT REFERENCES yms_yard_objects(object_id),
  wms_document_id BIGINT,
  related_visit_id BIGINT,
  status TEXT NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 0,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, visit_no)
);

CREATE TABLE IF NOT EXISTS yms_visit_events (
  event_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  visit_id BIGINT NOT NULL REFERENCES yms_visits(visit_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  action TEXT,
  actor_user_id TEXT,
  actor_login TEXT,
  reason TEXT,
  client_request_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS yms_visit_events_request_uidx
  ON yms_visit_events (site_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS yms_visits_site_status_idx
  ON yms_visits (site_id, status, planned_arrival);

CREATE INDEX IF NOT EXISTS yms_visits_plate_idx
  ON yms_visits (site_id, vehicle_id);

CREATE UNIQUE INDEX IF NOT EXISTS yms_dock_single_visit_uidx
  ON yms_yard_objects (current_visit_id)
  WHERE current_visit_id IS NOT NULL AND kind IN ('dock', 'parking');

CREATE TABLE IF NOT EXISTS yms_visit_discrepancies (
  discrepancy_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  visit_id BIGINT NOT NULL REFERENCES yms_visits(visit_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  qty NUMERIC(14,3),
  note TEXT,
  acknowledged BOOLEAN NOT NULL DEFAULT TRUE,
  actor_login TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yms_notifications (
  notification_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  visit_id BIGINT REFERENCES yms_visits(visit_id) ON DELETE CASCADE,
  audience TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS yms_notifications_site_idx
  ON yms_notifications (site_id, created_at DESC);
`

const STARTER = [
  { code: "BOUND", name: "Граница территории", kind: "boundary", x: 16, y: 16, w: 968, h: 760 },
  { code: "WH-1", name: "Склад ГП", kind: "building", x: 80, y: 70, w: 520, h: 280 },
  { code: "ROAD", name: "Проезд", kind: "road", x: 70, y: 390, w: 860, h: 70 },
  { code: "GATE-IN", name: "КПП въезд", kind: "gate_in", x: 70, y: 640, w: 150, h: 70 },
  { code: "GATE-OUT", name: "КПП выезд", kind: "gate_out", x: 760, y: 640, w: 150, h: 70 },
  { code: "WAIT", name: "Зона ожидания", kind: "wait_zone", x: 250, y: 500, w: 220, h: 90 },
  { code: "UNLOAD", name: "Зона разгрузки", kind: "unload_zone", x: 620, y: 180, w: 180, h: 120 },
  { code: "D-01", name: "Док D-01", kind: "dock", x: 100, y: 300, w: 110, h: 48, operations: ["OUTBOUND", "CROSS_DOCK"] },
  { code: "D-02", name: "Док D-02", kind: "dock", x: 230, y: 300, w: 110, h: 48, operations: ["OUTBOUND", "INBOUND"] },
  { code: "D-03", name: "Док D-03", kind: "dock", x: 360, y: 300, w: 110, h: 48, operations: ["INBOUND", "RETURN"] },
  { code: "D-04", name: "Док D-04", kind: "dock", x: 490, y: 300, w: 110, h: 48 },
  { code: "P-01", name: "Стоянка P-01", kind: "parking", x: 680, y: 80, w: 120, h: 56 },
  { code: "P-02", name: "Стоянка P-02", kind: "parking", x: 820, y: 80, w: 120, h: 56 },
  { code: "P-03", name: "Стоянка P-03", kind: "parking", x: 680, y: 160, w: 120, h: 56 },
  { code: "P-04", name: "Стоянка P-04", kind: "parking", x: 820, y: 160, w: 120, h: 56 },
  { code: "P-05", name: "Стоянка P-05", kind: "parking", x: 680, y: 250, w: 120, h: 56 },
  { code: "P-06", name: "Стоянка P-06", kind: "parking", x: 820, y: 250, w: 120, h: 56 },
]


function num(v) { return v ?? [] }

const url = process.env.DATABASE_URL || process.env.PG_URL || ""
if (!url) throw new Error("DATABASE_URL is missing")
const parsed = new URL(url)
const client = new pg.Client({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 5432,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\/+/, ""),
  ssl: parsed.searchParams.get("sslmode") === "disable" ? false : undefined,
})
await client.connect()
await client.query(DDL)
const siteCode = (process.env.WMS_SITE_CODE || "skeet").trim() || "skeet"
const site = await client.query(
  "SELECT site_id FROM wms_sites WHERE is_active AND (site_code = $1 OR site_code = 'skeet') ORDER BY site_id LIMIT 1",
  [siteCode]
)
const siteId = site.rows[0] && site.rows[0].site_id
if (!siteId) throw new Error("site not found")
const existing = await client.query("SELECT 1 FROM yms_yard_objects WHERE site_id = $1 LIMIT 1", [siteId])
if (!existing.rowCount) {
  for (const item of STARTER) {
    await client.query(
      `INSERT INTO yms_yard_objects (
         site_id, code, name, kind, status, x, y, w, h, allowed_vehicle_types, allowed_operations
       ) VALUES ($1,$2,$3,$4,'free',$5,$6,$7,$8,$9::text[],$10::text[])
       ON CONFLICT (site_id, code) DO NOTHING`,
      [siteId, item.code, item.name, item.kind, item.x, item.y, item.w, item.h, item.vehicleTypes || [], item.operations || []]
    )
  }
}
const count = await client.query("SELECT count(*)::int AS n FROM yms_yard_objects WHERE site_id = $1", [siteId])
console.log("yms_ready", count.rows[0].n)
await client.end()
