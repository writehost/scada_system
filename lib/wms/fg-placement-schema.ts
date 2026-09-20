import type { PoolClient } from "pg"

let schemaReady = false

export async function ensureFgPlacementSchema(client: PoolClient): Promise<void> {
  if (schemaReady) return

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_placement_policy (
      site_id INT PRIMARY KEY REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      storage_strategy TEXT NOT NULL DEFAULT 'fifo_lane',
      allocation_strategy TEXT NOT NULL DEFAULT 'fefo',
      conflict_policy TEXT NOT NULL DEFAULT 'next_accessible',
      allowed_mode TEXT NOT NULL DEFAULT 'any',
      placement_priority INT NOT NULL DEFAULT 50,
      max_occupancy INT NOT NULL DEFAULT 100,
      allow_mixed_sku BOOLEAN NOT NULL DEFAULT TRUE,
      allow_mixed_lot BOOLEAN NOT NULL DEFAULT TRUE,
      allow_reserve BOOLEAN NOT NULL DEFAULT TRUE,
      allow_quarantine BOOLEAN NOT NULL DEFAULT FALSE,
      load_side TEXT NOT NULL DEFAULT 'end',
      pick_side TEXT NOT NULL DEFAULT 'start',
      use_expiry BOOLEAN NOT NULL DEFAULT TRUE,
      use_mfg BOOLEAN NOT NULL DEFAULT FALSE,
      min_remaining_days INT NOT NULL DEFAULT 0,
      weights_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      production_plan_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_zone_placement (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      zone_code TEXT NOT NULL,
      storage_strategy TEXT,
      allocation_strategy TEXT,
      conflict_policy TEXT,
      allowed_mode TEXT NOT NULL DEFAULT 'inherit',
      placement_priority INT,
      max_occupancy INT,
      allow_mixed_sku BOOLEAN,
      allow_mixed_lot BOOLEAN,
      allow_reserve BOOLEAN,
      allow_quarantine BOOLEAN,
      load_side TEXT,
      pick_side TEXT,
      use_expiry BOOLEAN,
      use_mfg BOOLEAN,
      min_remaining_days INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, zone_code)
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_zone_allowed_products (
      site_id INT NOT NULL,
      zone_code TEXT NOT NULL,
      match_kind TEXT NOT NULL,
      match_value TEXT NOT NULL,
      match_label TEXT,
      PRIMARY KEY (site_id, zone_code, match_kind, match_value)
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_placement_rules (
      rule_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      storage_strategy TEXT,
      allocation_strategy TEXT,
      conflict_policy TEXT,
      placement_priority INT NOT NULL DEFAULT 80,
      max_occupancy INT,
      allow_mixed_sku BOOLEAN,
      allow_mixed_lot BOOLEAN,
      allow_reserve BOOLEAN,
      allow_quarantine BOOLEAN,
      zone_codes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      row_from TEXT,
      row_to TEXT,
      row_codes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      production_plan_priority INT NOT NULL DEFAULT 0,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (site_id, code)
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_placement_rule_products (
      rule_id BIGINT NOT NULL REFERENCES wms_fg_placement_rules(rule_id) ON DELETE CASCADE,
      match_kind TEXT NOT NULL,
      match_value TEXT NOT NULL,
      match_label TEXT,
      PRIMARY KEY (rule_id, match_kind, match_value)
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_row_placement (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      location_id BIGINT NOT NULL,
      inherit BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      storage_strategy TEXT,
      allocation_strategy TEXT,
      conflict_policy TEXT,
      allowed_mode TEXT NOT NULL DEFAULT 'inherit',
      placement_priority INT,
      max_occupancy INT,
      allow_mixed_sku BOOLEAN,
      allow_mixed_lot BOOLEAN,
      allow_reserve BOOLEAN,
      allow_quarantine BOOLEAN,
      load_side TEXT,
      pick_side TEXT,
      use_expiry BOOLEAN,
      use_mfg BOOLEAN,
      min_remaining_days INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, location_id)
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_row_allowed_products (
      site_id INT NOT NULL,
      location_id BIGINT NOT NULL,
      match_kind TEXT NOT NULL,
      match_value TEXT NOT NULL,
      match_label TEXT,
      PRIMARY KEY (site_id, location_id, match_kind, match_value)
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_placement_audit (
      audit_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      after_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )`)
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_fg_placement_audit_site
      ON wms_fg_placement_audit(site_id, at DESC)`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_placement_reservations (
      site_id INT NOT NULL,
      lpn TEXT NOT NULL,
      task_id TEXT NOT NULL,
      reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, lpn)
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_placement_tasks (
      site_id INT NOT NULL,
      task_id TEXT NOT NULL,
      item_query TEXT NOT NULL,
      item_code TEXT,
      item_name TEXT,
      requested_qty INT NOT NULL,
      allocation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, task_id)
    )`)

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_placement_demo_pallets (
      site_id INT NOT NULL,
      lpn TEXT NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      lot_code TEXT,
      expiry_at TIMESTAMPTZ,
      manufactured_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ,
      plan_row_id TEXT NOT NULL,
      location_id BIGINT,
      position INT NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'available',
      PRIMARY KEY (site_id, lpn)
    )`)

  schemaReady = true
}

export async function writePlacementAudit(
  client: PoolClient,
  siteId: number,
  input: {
    actor: string
    kind: string
    target: string
    detail: string
    beforeJson?: unknown
    afterJson?: unknown
  }
): Promise<void> {
  await ensureFgPlacementSchema(client)
  await client.query(
    `INSERT INTO wms_fg_placement_audit
       (site_id, actor, kind, target, detail, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      siteId,
      input.actor || "system",
      input.kind,
      input.target,
      input.detail,
      JSON.stringify(input.beforeJson ?? {}),
      JSON.stringify(input.afterJson ?? {}),
    ]
  )
}
