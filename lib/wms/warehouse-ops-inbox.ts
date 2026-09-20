import type { PoolClient } from "pg"
import { createDocumentWithTasks } from "@/lib/wms/documents"
import { listMaterialsWarehouse } from "@/lib/wms/materials-warehouse"
import { pickDistinctStops, tuggerLoopForCell } from "@/lib/wms/warehouse-ops"

export type OpsReplenishRow = {
  itemCode: string
  name: string
  reason: "kanban" | "two-bin" | "starvation" | "below_min"
  qty: number
  availableQty: number
  lineSideQty: number
  fromLocation: string | null
  toLocation: string | null
  loopId: string | null
  loopLabel: string | null
}

export type OpsWaveRow = {
  waveId: string
  label: string
  taskCount: number
  qty: number
  tasks: Array<{ taskId: string; taskCode: string; itemName: string | null; type: string }>
}

export type WarehouseOpsInbox = {
  replenish: OpsReplenishRow[]
  milkRun: { stopCount: number; qty: number; items: OpsReplenishRow[] }
  waves: OpsWaveRow[]
  substitutes: Array<{
    itemCode: string
    itemName: string
    aliasSku: string | null
    gtin: string | null
    mateCode: string | null
    mateName: string | null
    mateQty: number
  }>
  shrinkage: { totalQty: number; rows: Array<{ at: string; qty: number; reason: string; itemName: string }> }
  damage: { totalQty: number; rows: Array<{ at: string; qty: number; reason: string; itemName: string }> }
  accuracy: { scorePct: number | null; revisionMoves: number; note: string }
  dockToStockHours: number | null
  suppliers: Array<{ name: string; receipts: number }>
  docks: Array<{ title: string; startsAt: string; kind: string }>
  heatmap: Array<{ locationCode: string; moves: number }>
  genealogy: Array<{ at: string; qty: number; itemName: string; lotCode: string | null }>
  fefoExceptions: Array<{ at: string; itemCode: string; lotCode: string | null; reason: string }>
  certificates: Array<{ itemCode: string; name: string; url: string }>
  tugger: {
    loops: Array<{ loopId: string; label: string; stopCount: number; qty: number; items: OpsReplenishRow[] }>
  }
  supplierQuality: Array<{ name: string; receipts: number; scorePct: number | null; note: string }>
  openReplenishTasks: number
}

async function ensureOpsLog(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_warehouse_ops_log (
      log_id bigserial PRIMARY KEY,
      site_id integer NOT NULL,
      kind text NOT NULL,
      item_code text,
      lot_code text,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    console.error("[warehouse-ops-inbox]", error)
    return fallback
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

export async function listWorkshopStops(client: PoolClient, siteId: number): Promise<string[]> {
  const empty = await client.query<{ locationCode: string }>(
    `SELECT l.location_code AS "locationCode"
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id AND w.site_id = l.site_id
     LEFT JOIN wms_zones z ON z.zone_id = l.zone_id
     LEFT JOIN wms_stock_balances sb ON sb.location_id = l.location_id AND sb.site_id = l.site_id
     WHERE l.site_id = $1
       AND (
         w.warehouse_code IN ('Цех №1', 'Цех №2')
         OR COALESCE(z.zone_code, '') IN ('LINE', 'ST-SER', 'ST-BAGG')
         OR l.location_code ~ '^A-[0-9]+$'
       )
     GROUP BY l.location_code
     HAVING SUM(COALESCE(sb.available_qty,0)+COALESCE(sb.in_production_qty,0)+COALESCE(sb.reserved_qty,0)) = 0
     ORDER BY
       CASE WHEN l.location_code ~ '^A-[0-9]+$'
            THEN CAST(substring(l.location_code from 3) AS int)
            ELSE 9999
       END,
       l.location_code
     LIMIT 80`,
    [siteId]
  )
  if (empty.rows.length) return empty.rows.map((row) => row.locationCode)
  const any = await client.query<{ locationCode: string }>(
    `SELECT l.location_code AS "locationCode"
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     WHERE l.site_id = $1 AND (w.warehouse_code IN ('Цех №1', 'Цех №2') OR l.location_code ~ '^A-[0-9]+$')
     ORDER BY
       CASE WHEN l.location_code ~ '^A-[0-9]+$'
            THEN CAST(substring(l.location_code from 3) AS int)
            ELSE 9999
       END
     LIMIT 20`,
    [siteId]
  )
  return any.rows.map((row) => row.locationCode)
}

export async function suggestWorkshopCell(client: PoolClient, siteId: number): Promise<string | null> {
  const stops = await listWorkshopStops(client, siteId)
  return stops[0] ?? "A-1"
}

async function warehouseCodeForLocation(
  client: PoolClient,
  siteId: number,
  locationCode: string | null | undefined
): Promise<string | null> {
  if (!locationCode) return null
  const r = await client.query<{ warehouseCode: string }>(
    `SELECT w.warehouse_code AS "warehouseCode"
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     WHERE l.site_id = $1 AND l.location_code = $2
     LIMIT 1`,
    [siteId, locationCode]
  )
  return r.rows[0]?.warehouseCode ?? null
}

export async function loadWarehouseOpsInbox(client: PoolClient, siteId: number): Promise<WarehouseOpsInbox> {
  await ensureOpsLog(client)
  const materials = await listMaterialsWarehouse(client, siteId)
  const emptyStops = await safe(() => listWorkshopStops(client, siteId), ["A-1"])

  const pending: Array<Omit<OpsReplenishRow, "toLocation" | "loopId" | "loopLabel">> = []
  const certificates: WarehouseOpsInbox["certificates"] = []

  for (const row of materials) {
    const reason: OpsReplenishRow["reason"] | null = row.kanban
      ? row.lineSideQty <= 0
        ? "starvation"
        : "kanban"
      : row.twoBin
        ? "two-bin"
        : row.policyState === "below_min" || row.policyState === "safety" || row.policyState === "reorder"
          ? "below_min"
          : null
    if (reason && row.availableQty > 0) {
      // Сигнал пополнения, не 15% склада: иначе two-bin по этикетке даёт десятки тысяч в одном задании.
      const need = Math.min(row.availableQty, Math.max(1, Math.min(200, Math.round(row.availableQty * 0.15) || 1)))
      pending.push({
        itemCode: row.itemCode,
        name: row.name,
        reason,
        qty: need,
        availableQty: row.availableQty,
        lineSideQty: row.inProductionQty,
        fromLocation: row.fefoLocationCode,
      })
    }
  }

  const assignedStops = pickDistinctStops(emptyStops, pending.length)
  const replenish: OpsReplenishRow[] = pending.map((row, index) => {
    const toLocation = assignedStops[index] ?? emptyStops[0] ?? "A-1"
    const loop = tuggerLoopForCell(toLocation)
    return {
      ...row,
      toLocation,
      loopId: loop?.loopId ?? null,
      loopLabel: loop?.label ?? null,
    }
  })

  await safe(async () => {
    const codes = materials.map((r) => r.itemCode)
    if (codes.length === 0) return
    const r = await client.query<{ itemCode: string; itemAttrs: unknown }>(
      `SELECT item_code AS "itemCode", item_attrs_json AS "itemAttrs"
       FROM wms_items WHERE site_id = $1 AND item_code = ANY($2::text[])`,
      [siteId, codes]
    )
    const byCode = new Map(materials.map((row) => [row.itemCode, row]))
    for (const row of r.rows) {
      const nom = asRecord(asRecord(row.itemAttrs)?.nomenclature) ?? asRecord(row.itemAttrs) ?? {}
      const url = String(nom.certificateUrl ?? nom.coaUrl ?? "").trim()
      const name = byCode.get(row.itemCode)?.name ?? row.itemCode
      if (url) certificates.push({ itemCode: row.itemCode, name, url })
    }
  }, undefined)

  const substitutes = await safe(async () => {
    const r = await client.query<{
      itemCode: string
      itemName: string
      aliasSku: string | null
      gtin: string | null
      mateCode: string | null
      mateName: string | null
      mateQty: string | number | null
    }>(
      `SELECT i.item_code AS "itemCode", i.name AS "itemName",
              a.alias_sku AS "aliasSku", a.gtin AS gtin,
              i2.item_code AS "mateCode", i2.name AS "mateName",
              COALESCE(s.qty, 0) AS "mateQty"
       FROM wms_item_aliases a
       JOIN wms_items i ON i.item_id = a.item_id AND i.site_id = a.site_id
       LEFT JOIN wms_items i2
         ON i2.site_id = a.site_id AND i2.item_id <> i.item_id
        AND (
          (NULLIF(BTRIM(a.gtin),'') IS NOT NULL AND (
            i2.sku = a.gtin OR i2.item_code = a.gtin
            OR COALESCE(i2.item_attrs_json->'nomenclature'->>'gtin','') = a.gtin
          ))
          OR (NULLIF(BTRIM(a.alias_sku),'') IS NOT NULL AND (i2.sku = a.alias_sku OR i2.item_code = a.alias_sku))
        )
       LEFT JOIN LATERAL (
         SELECT SUM(COALESCE(sb.available_qty,0)+COALESCE(sb.in_production_qty,0)) AS qty
         FROM wms_stock_balances sb WHERE sb.item_id = i2.item_id AND sb.site_id = i2.site_id
       ) s ON TRUE
       WHERE a.site_id = $1 AND COALESCE(a.is_active, TRUE)
       ORDER BY i.name
       LIMIT 40`,
      [siteId]
    )
    return r.rows.map((row) => ({
      itemCode: row.itemCode,
      itemName: row.itemName,
      aliasSku: row.aliasSku,
      gtin: row.gtin,
      mateCode: row.mateCode,
      mateName: row.mateName,
      mateQty: Number(row.mateQty) || 0,
    }))
  }, [])

  const shrinkage = await safe(async () => {
    const r = await client.query<{ at: Date; qty: string | number; reason: string; itemName: string }>(
      `SELECT m.movement_at AS at, ABS(m.qty) AS qty,
              COALESCE(mt.code, 'writeoff') AS reason,
              i.name AS "itemName"
       FROM wms_stock_movements m
       JOIN wms_items i ON i.item_id = m.item_id AND i.site_id = m.site_id
       LEFT JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
       WHERE m.site_id = $1
         AND COALESCE(mt.code,'') IN ('writeoff', 'revision_adjustment')
         AND m.movement_at >= NOW() - INTERVAL '180 days'
       ORDER BY m.movement_at DESC
       LIMIT 30`,
      [siteId]
    )
    const rows = r.rows.map((row) => ({
      at: new Date(row.at).toISOString(),
      qty: Number(row.qty) || 0,
      reason: row.reason,
      itemName: row.itemName,
    }))
    return { totalQty: rows.reduce((s, x) => s + x.qty, 0), rows }
  }, { totalQty: 0, rows: [] })

  const damage = {
    totalQty: shrinkage.rows.filter((r) => /бой|поврежд|damage|брак/i.test(r.reason)).reduce((s, x) => s + x.qty, 0),
    rows: shrinkage.rows.filter((r) => /бой|поврежд|damage|брак/i.test(r.reason)),
  }

  const accuracy = await safe(async () => {
    const r = await client.query<{ n: string | number; adj: string | number }>(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(ABS(m.qty)),0) AS adj
       FROM wms_stock_movements m
       LEFT JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
       WHERE m.site_id = $1 AND COALESCE(mt.code,'') = 'revision_adjustment'
         AND m.movement_at >= NOW() - INTERVAL '180 days'`,
      [siteId]
    )
    const n = Number(r.rows[0]?.n) || 0
    const adj = Number(r.rows[0]?.adj) || 0
    const stock = materials.reduce((s, x) => s + x.availableQty + x.inProductionQty, 0)
    if (n === 0) {
      return { scorePct: null, revisionMoves: 0, note: "Ревизий за 180 дней не было — процент точности ещё не из чего считать." }
    }
    const score = stock > 0 ? Math.max(0, Math.min(100, Math.round((1 - adj / stock) * 1000) / 10)) : 100
    return { scorePct: score, revisionMoves: n, note: `${n} корректировок ревизии, сумма расхождений ${adj}.` }
  }, { scorePct: null, revisionMoves: 0, note: "Нет данных ревизии." })

  const dockToStockHours = await safe(async () => {
    const r = await client.query<{ hours: string | number }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (put.first_putaway - rec.received_at)) / 3600.0) AS hours
       FROM (
         SELECT i.item_id, MIN(m.movement_at) AS received_at
         FROM wms_stock_movements m
         JOIN wms_items i ON i.item_id = m.item_id
         LEFT JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
         WHERE m.site_id = $1 AND COALESCE(mt.code,'') = 'receiving'
           AND m.movement_at >= NOW() - INTERVAL '180 days'
         GROUP BY i.item_id
       ) rec
       JOIN (
         SELECT i.item_id, MIN(m.movement_at) AS first_putaway
         FROM wms_stock_movements m
         JOIN wms_items i ON i.item_id = m.item_id
         LEFT JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
         WHERE m.site_id = $1 AND COALESCE(mt.code,'') IN ('putaway','transfer')
           AND m.movement_at >= NOW() - INTERVAL '180 days'
         GROUP BY i.item_id
       ) put ON put.item_id = rec.item_id
       WHERE put.first_putaway >= rec.received_at`,
      [siteId]
    )
    const h = Number(r.rows[0]?.hours)
    return Number.isFinite(h) ? Math.round(h * 10) / 10 : null
  }, null)

  const suppliers = await safe(async () => {
    const docs = await client.query<{ name: string; receipts: string | number }>(
      `SELECT COALESCE(
                NULLIF(BTRIM(d.payload_json->>'supplierName'),''),
                NULLIF(BTRIM(d.comment),''),
                'приёмка'
              ) AS name, COUNT(*)::int AS receipts
       FROM wms_documents d
       JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
       WHERE d.site_id = $1 AND dt.code = 'receiving'
       GROUP BY 1 ORDER BY receipts DESC LIMIT 8`,
      [siteId]
    )
    return docs.rows.map((row) => ({ name: row.name, receipts: Number(row.receipts) || 0 }))
  }, [])

  const docks = await safe(async () => {
    const r = await client.query<{ title: string; startsAt: Date; kind: string }>(
      `SELECT title,
              start_at AS "startsAt",
              type_code AS kind
       FROM wms_calendar_events
       WHERE site_id = $1
         AND deleted_at IS NULL
         AND start_at >= NOW() - INTERVAL '180 days'
       ORDER BY start_at DESC
       LIMIT 16`,
      [siteId]
    )
    return r.rows
      .filter((row) => row.startsAt)
      .map((row) => ({
        title: row.title,
        startsAt: new Date(row.startsAt).toISOString(),
        kind: row.kind,
      }))
  }, [])

  const heatmap = await safe(async () => {
    const r = await client.query<{ locationCode: string; moves: string | number }>(
      `SELECT COALESCE(l.location_code, '(без ячейки)') AS "locationCode", COUNT(*)::int AS moves
       FROM wms_stock_movements m
       LEFT JOIN wms_locations l ON l.location_id = COALESCE(m.to_location_id, m.from_location_id)
       WHERE m.site_id = $1 AND m.movement_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1
       ORDER BY moves DESC
       LIMIT 12`,
      [siteId]
    )
    return r.rows.map((row) => ({ locationCode: row.locationCode, moves: Number(row.moves) || 0 }))
  }, [])

  const genealogy = await safe(async () => {
    const r = await client.query<{ at: Date; qty: string | number; itemName: string; lotCode: string | null }>(
      `SELECT m.movement_at AS at, ABS(m.qty) AS qty, i.name AS "itemName",
              wl.lot_code AS "lotCode"
       FROM wms_stock_movements m
       JOIN wms_items i ON i.item_id = m.item_id
       LEFT JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
       LEFT JOIN wms_lots wl ON wl.lot_id = m.lot_id
       WHERE m.site_id = $1
         AND COALESCE(mt.code,'') IN ('production_consume','issue')
         AND m.movement_at >= NOW() - INTERVAL '180 days'
       ORDER BY m.movement_at DESC
       LIMIT 20`,
      [siteId]
    )
    return r.rows.map((row) => ({
      at: new Date(row.at).toISOString(),
      qty: Number(row.qty) || 0,
      itemName: row.itemName,
      lotCode: row.lotCode,
    }))
  }, [])

  const fefoExceptions = await safe(async () => {
    const r = await client.query<{ at: Date; itemCode: string; lotCode: string | null; reason: string }>(
      `SELECT created_at AS at, item_code AS "itemCode", lot_code AS "lotCode",
              COALESCE(payload_json->>'reason', kind) AS reason
       FROM wms_warehouse_ops_log
       WHERE site_id = $1 AND kind = 'fefo_exception'
       ORDER BY created_at DESC
       LIMIT 20`,
      [siteId]
    )
    return r.rows.map((row) => ({
      at: new Date(row.at).toISOString(),
      itemCode: row.itemCode,
      lotCode: row.lotCode,
      reason: row.reason,
    }))
  }, [])

  const waves = await safe(async () => {
    const r = await client.query<{
      taskId: string
      taskCode: string
      type: string
      itemName: string | null
      qty: string | number
      dueAt: Date | null
      wave: string | null
    }>(
      `SELECT t.task_id::text AS "taskId", t.task_code AS "taskCode", tt.code AS type,
              i.name AS "itemName", t.planned_qty AS qty, t.due_at AS "dueAt",
              NULLIF(BTRIM(t.task_payload->>'waveId'), '') AS wave
       FROM wms_tasks t
       JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
       JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
       LEFT JOIN wms_items i ON i.item_id = t.item_id
       WHERE t.site_id = $1
         AND t.completed_at IS NULL
         AND ts.code NOT IN ('cancelled','canceled','completed','done')
         AND tt.code IN ('pick','ship','replenishment','issue_to_line')
       ORDER BY t.due_at NULLS LAST, t.task_id
       LIMIT 40`,
      [siteId]
    )
    const groups = new Map<string, OpsWaveRow>()
    for (const row of r.rows) {
      const day = row.dueAt ? new Date(row.dueAt).toISOString().slice(0, 10) : "без срока"
      const waveId = row.wave || `wave-${row.type}-${day}`
      const g = groups.get(waveId) ?? {
        waveId,
        label: row.wave
          ? `Волна ${row.wave}`
          : `${({ pick: "Отбор", ship: "Отгрузка", replenishment: "Пополнение", issue_to_line: "Выдача в цех" } as Record<string, string>)[row.type] ?? row.type} · ${day}`,
        taskCount: 0,
        qty: 0,
        tasks: [],
      }
      g.taskCount += 1
      g.qty += Number(row.qty) || 0
      g.tasks.push({
        taskId: row.taskId,
        taskCode: row.taskCode,
        itemName: row.itemName,
        type: row.type,
      })
      groups.set(waveId, g)
    }
    return [...groups.values()]
  }, [])

  const openReplenishTasks = await safe(async () => {
    const r = await client.query<{ n: string | number }>(
      `SELECT COUNT(*)::int AS n
       FROM wms_tasks t
       JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
       JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
       WHERE t.site_id = $1 AND tt.code = 'replenishment'
         AND t.completed_at IS NULL
         AND ts.code NOT IN ('cancelled','canceled','completed','done')`,
      [siteId]
    )
    return Number(r.rows[0]?.n) || 0
  }, 0)

  const tuggerLoops = new Map<string, { loopId: string; label: string; stopCount: number; qty: number; items: OpsReplenishRow[] }>()
  for (const row of replenish) {
    const loopId = row.loopId ?? "T?"
    const g = tuggerLoops.get(loopId) ?? {
      loopId,
      label: row.loopLabel ?? "Без петли",
      stopCount: 0,
      qty: 0,
      items: [],
    }
    g.stopCount += 1
    g.qty += row.qty
    g.items.push(row)
    tuggerLoops.set(loopId, g)
  }

  const supplierQuality = suppliers.map((s) => ({
    name: s.name,
    receipts: s.receipts,
    scorePct: null as number | null,
    note:
      shrinkage.totalQty > 0
        ? "Списания за 180 дней есть, но к поставщику не привязаны — балл не считаем, только объём приёмки."
        : "Рекламаций нет — балл качества не выставляем, только объём приёмки.",
  }))

  return {
    replenish,
    milkRun: {
      stopCount: replenish.length,
      qty: replenish.reduce((s, x) => s + x.qty, 0),
      items: replenish,
    },
    tugger: { loops: [...tuggerLoops.values()] },
    waves,
    substitutes,
    shrinkage,
    damage,
    accuracy,
    dockToStockHours,
    suppliers,
    supplierQuality,
    docks,
    heatmap,
    genealogy,
    fefoExceptions,
    certificates,
    openReplenishTasks,
  }
}

export async function createOpsReplenish(
  client: PoolClient,
  siteId: number,
  input: { itemCodes?: string[]; milkRun?: boolean; tugger?: boolean; comment?: string }
) {
  const inbox = await loadWarehouseOpsInbox(client, siteId)
  const selected = input.milkRun || input.tugger
    ? [...inbox.replenish].sort((a, b) => (a.loopId ?? "").localeCompare(b.loopId ?? "") || (a.toLocation ?? "").localeCompare(b.toLocation ?? ""))
    : inbox.replenish.filter((row) => (input.itemCodes ?? []).includes(row.itemCode))
  if (selected.length === 0) {
    throw new Error("Нет позиций на пополнение")
  }
  const targetWarehouseCode =
    (await warehouseCodeForLocation(client, siteId, selected[0]?.toLocation)) ?? "Цех №2"
  const kind = input.tugger ? "tugger" : input.milkRun ? "milk_run" : "ekanban"
  const created = await createDocumentWithTasks(client, siteId, {
    requestId: crypto.randomUUID(),
    siteCode: "skeet",
    documentType: "replenishment",
    sourceWarehouseCode: "OS",
    targetWarehouseCode,
    priorityCode: "high",
    comment:
      input.comment ||
      (input.tugger
        ? "Tugger: петли к линии"
        : input.milkRun
          ? "Milk run: подвоз к линии"
          : "e-Kanban / two-bin пополнение"),
    lines: selected.map((row, index) => ({
      itemCode: row.itemCode,
      qty: row.qty,
      sourceLocationCode: row.fromLocation ?? undefined,
      targetLocationCode: row.toLocation ?? undefined,
      comment: row.reason,
      taskPayload: {
        kind,
        reason: row.reason,
        loopId: row.loopId,
        sequence: (index + 1) * 10,
      },
    })),
  })
  await client.query(
    `INSERT INTO wms_warehouse_ops_log (site_id, kind, payload_json)
     VALUES ($1, $2, $3::jsonb)`,
    [
      siteId,
      kind,
      JSON.stringify({ documentId: created.documentId, items: selected.map((r) => r.itemCode) }),
    ]
  )
  return created
}

export async function tagOpsWave(client: PoolClient, siteId: number, taskIds: string[]) {
  if (taskIds.length === 0) throw new Error("Нет заданий для волны")
  const waveId = `W${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${taskIds.length}`
  await client.query(
    `UPDATE wms_tasks
     SET task_payload = COALESCE(task_payload, '{}'::jsonb) || jsonb_build_object('waveId', $3::text, 'waveAt', now())
     WHERE site_id = $1 AND task_id = ANY($2::bigint[])`,
    [siteId, taskIds, waveId]
  )
  await ensureOpsLog(client)
  await client.query(
    `INSERT INTO wms_warehouse_ops_log (site_id, kind, payload_json)
     VALUES ($1, 'wave', $2::jsonb)`,
    [siteId, JSON.stringify({ waveId, taskIds })]
  )
  return { waveId, taskCount: taskIds.length }
}

export async function logFefoException(
  client: PoolClient,
  siteId: number,
  input: { itemCode: string; lotCode?: string; reason: string }
) {
  const reason = input.reason.trim()
  if (reason.length < 3) throw new Error("Укажите причину отклонения от FEFO")
  await ensureOpsLog(client)
  await client.query(
    `INSERT INTO wms_warehouse_ops_log (site_id, kind, item_code, lot_code, payload_json)
     VALUES ($1, 'fefo_exception', $2, $3, $4::jsonb)`,
    [siteId, input.itemCode.trim(), input.lotCode?.trim() || null, JSON.stringify({ reason })]
  )
  return { ok: true }
}
