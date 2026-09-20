import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import {
  defaultStorageClassDirectory,
  deriveStorageClassFromItemRow,
  isLegacyItemClassCode,
  isStorageClassCode,
  legacyItemClassDirectoryRow,
  LEGACY_ITEM_CLASS_CODES,
} from "@/lib/wms/physical-profile"
import type { PoolClient } from "pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ItemClassBody = {
  siteCode?: string
  code?: string
  name?: string
  groupCode?: string | null
  sortOrder?: number
  isActive?: boolean
  seedDefaults?: boolean
}

const DEFAULT_CLASSES = defaultStorageClassDirectory()

/**
 * Запрос к базе идёт через туннель на завод (~130 мс), поэтому DDL и посев
 * значений по умолчанию выполняются один раз за жизнь процесса, а не на каждом
 * чтении справочника.
 */
let tableReady = false
const seededSites = new Set<number>()

function classKind(code: string): "storage" | "legacy" | "custom" {
  if (isStorageClassCode(code)) return "storage"
  if (isLegacyItemClassCode(code)) return "legacy"
  return "custom"
}

async function ensureTable(client: PoolClient) {
  if (tableReady) return
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_item_classes (
      site_id INT NOT NULL REFERENCES wms_sites(site_id),
      class_code TEXT NOT NULL,
      group_code TEXT NULL,
      name TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 100,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, class_code)
    )
  `)
  tableReady = true
}

async function mapClass(client: PoolClient, siteId: number, code: string) {
  const r = await client.query(
    `SELECT
       c.class_code AS code,
       c.group_code AS "groupCode",
       c.name,
       COALESCE(c.sort_order, 100)::int AS "sortOrder",
       COALESCE(c.is_active, TRUE) AS "isActive",
       c.created_at AS "createdAt",
       c.updated_at AS "updatedAt",
       COUNT(i.item_id)::int AS "itemCount"
     FROM wms_item_classes c
     LEFT JOIN wms_items i ON i.site_id = c.site_id AND i.item_class_code = c.class_code
     WHERE c.site_id = $1 AND c.class_code = $2
     GROUP BY c.class_code, c.group_code, c.name, c.sort_order, c.is_active, c.created_at, c.updated_at`,
    [siteId, code]
  )
  const row = r.rows[0]
  if (!row) return null
  return { ...row, kind: classKind(String(row.code)) }
}

async function rematerializeLegacyItemClasses(client: PoolClient, siteId: number): Promise<number> {
  const items = await client.query<{
    item_id: string
    name: string | null
    item_type_code: string | null
    item_class_code: string | null
    item_group_code: string | null
    product_group: string | null
    material_type: string | null
    nomenclature: string | null
    item_attrs_json: unknown
  }>(
    `SELECT
       item_id::text,
       name,
       item_type_code,
       item_class_code,
       item_group_code,
       product_group,
       material_type,
       nomenclature,
       item_attrs_json
     FROM wms_items
     WHERE site_id = $1`,
    [siteId]
  )
  const byClass = new Map<string, string[]>()
  for (const row of items.rows) {
    const next = deriveStorageClassFromItemRow(row)
    if (next === (row.item_class_code || "").trim().toUpperCase()) continue
    const list = byClass.get(next) ?? []
    list.push(row.item_id)
    byClass.set(next, list)
  }
  let updated = 0
  for (const [code, ids] of byClass) {
    const r = await client.query(
      `UPDATE wms_items
       SET item_class_code = $3, updated_at = now()
       WHERE site_id = $1 AND item_id = ANY($2::bigint[])`,
      [siteId, ids, code]
    )
    updated += r.rowCount ?? ids.length
  }
  return updated
}

async function seedDefaults(client: PoolClient, siteId: number, force = false): Promise<number> {
  if (!force && seededSites.has(siteId)) return 0
  await client.query(
    `INSERT INTO wms_item_classes (site_id, class_code, group_code, name, sort_order, is_active, updated_at)
     SELECT $1, code, NULL, name, sort_order, TRUE, now()
     FROM unnest($2::text[], $3::text[], $4::int[]) AS t(code, name, sort_order)
     ON CONFLICT (site_id, class_code) DO UPDATE SET
       name = EXCLUDED.name,
       sort_order = EXCLUDED.sort_order,
       is_active = TRUE,
       updated_at = now()`,
    [
      siteId,
      DEFAULT_CLASSES.map((row) => row.code),
      DEFAULT_CLASSES.map((row) => row.name),
      DEFAULT_CLASSES.map((row) => row.sortOrder),
    ]
  )
  for (const code of LEGACY_ITEM_CLASS_CODES) {
    const legacy = legacyItemClassDirectoryRow(code)
    if (!legacy) continue
    await client.query(
      `UPDATE wms_item_classes
       SET name = $3, sort_order = $4, is_active = FALSE, updated_at = now()
       WHERE site_id = $1 AND class_code = $2`,
      [siteId, legacy.code, legacy.name, legacy.sortOrder]
    )
  }
  const rematerialized = await rematerializeLegacyItemClasses(client, siteId)
  seededSites.add(siteId)
  return rematerialized
}

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }

  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode") ?? ""
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const seed = url.searchParams.get("seedDefaults") === "1"

  const conn = await tryConnect(pool)
  if (!conn.ok) {
    return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  }

  const client = conn.client
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureTable(client)
    if (seed) await seedDefaults(client, siteId)

    const r = await client.query(
      `SELECT
         c.class_code AS code,
         c.group_code AS "groupCode",
         c.name,
         COALESCE(c.sort_order, 100)::int AS "sortOrder",
         COALESCE(c.is_active, TRUE) AS "isActive",
         c.created_at AS "createdAt",
         c.updated_at AS "updatedAt",
         COUNT(i.item_id)::int AS "itemCount"
       FROM wms_item_classes c
       LEFT JOIN wms_items i ON i.site_id = c.site_id AND i.item_class_code = c.class_code
       WHERE c.site_id = $1
       GROUP BY c.class_code, c.group_code, c.name, c.sort_order, c.is_active, c.created_at, c.updated_at
       ORDER BY COALESCE(c.sort_order, 100), c.class_code`,
      [siteId]
    )
    return NextResponse.json({
      classes: r.rows.map((row) => ({ ...row, kind: classKind(String(row.code)) })),
    })
  } catch (e) {
    const err = e as { code?: string }
    if (err?.code === "42P01" || err?.code === "42703") {
      return NextResponse.json({ classes: [], tableMissing: true })
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function POST(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }
  let body: ItemClassBody
  try {
    body = (await req.json()) as ItemClassBody
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = String(body.siteCode ?? "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureTable(client)

    if (body.seedDefaults) {
      const rematerialized = await seedDefaults(client, siteId, true)
      return NextResponse.json({ ok: true, seeded: true, rematerialized })
    }

    const code = String(body.code ?? "").trim().toUpperCase()
    const name = String(body.name ?? "").trim()
    if (!code || !name) {
      return NextResponse.json({ error: "code and name are required" }, { status: 400 })
    }
    await client.query(
      `INSERT INTO wms_item_classes (site_id, class_code, group_code, name, sort_order, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, now())
       ON CONFLICT (site_id, class_code)
       DO UPDATE SET
         group_code = EXCLUDED.group_code,
         name = EXCLUDED.name,
         sort_order = EXCLUDED.sort_order,
         is_active = TRUE,
         updated_at = now()`,
      [
        siteId,
        code,
        body.groupCode?.trim() || null,
        name,
        Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
      ]
    )
    return NextResponse.json({ class: await mapClass(client, siteId, code) })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function PATCH(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }
  let body: ItemClassBody
  try {
    body = (await req.json()) as ItemClassBody
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = String(body.siteCode ?? "").trim()
  const code = String(body.code ?? "").trim()
  if (!siteCode || !code) {
    return NextResponse.json({ error: "siteCode and code are required" }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureTable(client)

    const sets: string[] = []
    const params: unknown[] = [siteId, code]
    let i = 3
    if (body.name != null) {
      sets.push(`name = $${i++}`)
      params.push(String(body.name).trim())
    }
    if ("groupCode" in body) {
      sets.push(`group_code = $${i++}`)
      params.push(body.groupCode?.trim() || null)
    }
    if (body.sortOrder != null && Number.isFinite(Number(body.sortOrder))) {
      sets.push(`sort_order = $${i++}`)
      params.push(Number(body.sortOrder))
    }
    if (typeof body.isActive === "boolean") {
      sets.push(`is_active = $${i++}`)
      params.push(body.isActive)
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 })
    }
    sets.push("updated_at = now()")
    await client.query(
      `UPDATE wms_item_classes SET ${sets.join(", ")} WHERE site_id = $1 AND class_code = $2`,
      params
    )
    return NextResponse.json({ class: await mapClass(client, siteId, code) })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function DELETE(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode") ?? ""
  const code = url.searchParams.get("code") ?? ""
  if (!siteCode.trim() || !code.trim()) {
    return NextResponse.json({ error: "siteCode and code are required" }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureTable(client)
    if (isStorageClassCode(code)) {
      return NextResponse.json(
        { error: "Системный класс S1–S5 удалять нельзя. Можно только переименовать." },
        { status: 400 }
      )
    }
    await client.query(
      `UPDATE wms_items SET item_class_code = NULL, updated_at = now()
       WHERE site_id = $1 AND item_class_code = $2`,
      [siteId, code.trim()]
    )
    await client.query(`DELETE FROM wms_item_classes WHERE site_id = $1 AND class_code = $2`, [
      siteId,
      code.trim(),
    ])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 })
  } finally {
    client.release()
  }
}
