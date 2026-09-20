#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import pg from "pg"

function readDatabaseUrl() {
  const envUrl = process.env.DATABASE_URL || process.env.PG_URL
  if (envUrl) return envUrl

  const candidates = [
    path.resolve("Backend/wms-config.json"),
    path.resolve("Backend/web/wms-config.json"),
    path.resolve("wms-config.json"),
  ]
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"))
    if (cfg.databaseUrl) return cfg.databaseUrl
  }
  throw new Error("DATABASE_URL/PG_URL not set and wms-config.json not found")
}

const checks = [
  ["wms_notifications table", "to_regclass('public.wms_notifications') IS NOT NULL"],
  ["wms_notification_recipients table", "to_regclass('public.wms_notification_recipients') IS NOT NULL"],
  ["wms_notifications.ref_key", `EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wms_notifications' AND column_name = 'ref_key'
  )`],
  ["wms_issue_recipient_defs table", "to_regclass('public.wms_issue_recipient_defs') IS NOT NULL"],
  ["wms_users.position", `EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wms_users' AND column_name = 'position'
  )`],
  ["wms_users.password_hash", `EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wms_users' AND column_name = 'password_hash'
  )`],
  ["wms_packaging_profile_defs table", "to_regclass('public.wms_packaging_profile_defs') IS NOT NULL"],
  ["wms_nomenclature_type_defs table", "to_regclass('public.wms_nomenclature_type_defs') IS NOT NULL"],
  ["wms_slot_profile_option_defs table", "to_regclass('public.wms_slot_profile_option_defs') IS NOT NULL"],
  ["wms_item_groups table", "to_regclass('public.wms_item_groups') IS NOT NULL"],
  ["RECV location", `EXISTS (
    SELECT 1 FROM wms_locations WHERE location_code = 'OS-RECV-ST01-S01-P01-B01'
  )`],
  ["slot field materialType", `EXISTS (
    SELECT 1 FROM wms_slot_profile_option_defs WHERE field_key = 'materialType' AND option_code = 'ST'
  )`],
  ["slot field processType RECV", `EXISTS (
    SELECT 1 FROM wms_slot_profile_option_defs WHERE field_key = 'processType' AND option_code = 'RECV'
  )`],
  ["slot field processType BAGG", `EXISTS (
    SELECT 1 FROM wms_slot_profile_option_defs WHERE field_key = 'processType' AND option_code = 'BAGG'
  )`],
  ["slot field productGroup ANY", `EXISTS (
    SELECT 1 FROM wms_slot_profile_option_defs WHERE field_key = 'productGroup' AND option_code = 'ANY'
  )`],
  ["packaging profile custom", `EXISTS (
    SELECT 1 FROM wms_packaging_profile_defs WHERE profile_code = 'custom'
  )`],
  ["nomenclature type STICKER", `EXISTS (
    SELECT 1 FROM wms_nomenclature_type_defs WHERE type_code = 'STICKER'
  )`],
  ["item group water", `EXISTS (
    SELECT 1 FROM wms_item_groups WHERE group_code = 'water'
  )`],
  ["item groups count >= 5", `(
    SELECT COUNT(*)::int >= 5 FROM wms_item_groups
  )`],
  ["wms_uom_defs table", "to_regclass('public.wms_uom_defs') IS NOT NULL"],
  ["uom pcs", `EXISTS (
    SELECT 1 FROM wms_uom_defs WHERE uom_code = 'pcs'
  )`],
  ["slot equipment APPLICATOR-NOVEXX", `EXISTS (
    SELECT 1 FROM wms_slot_profile_option_defs
    WHERE field_key = 'equipment' AND option_code IN ('APPLICATOR-NOVEXX', 'АППЛИКАТОР-NOVEXX')
  )`],
]

const pool = new pg.Pool({ connectionString: readDatabaseUrl() })
const failures = []

try {
  for (const [name, sql] of checks) {
    const r = await pool.query(`SELECT ${sql} AS ok`)
    const ok = Boolean(r.rows[0]?.ok)
    console.log(`${ok ? "OK" : "MISSING"} ${name}`)
    if (!ok) failures.push(name)
  }
} finally {
  await pool.end()
}

if (failures.length) {
  console.error("\nMissing DB objects:")
  for (const name of failures) console.error(`- ${name}`)
  console.error("\nSuggested patches:")
  console.error("- Backend/db/patches/2026-05-26_users_password_auth.sql")
  console.error("- Backend/db/patches/2026-05-26_expiry_sticker_alerts.sql")
  console.error("- Backend/db/patches/2026-05-26_issue_recipient_defs.sql")
  console.error("- Backend/db/patches/2026-05-29_receiving_reference_defaults.sql")
  console.error("- Backend/db/patches/2026-05-29_wms_uom_defs.sql")
  console.error("- Backend/db/patches/2026-05-22_ensure_item_groups_from_items.sql")
  console.error("- Backend/db/patches/2026-05-29_slot_profile_equipment.sql")
  process.exit(1)
}

console.log("\nDB preflight OK")
