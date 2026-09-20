import type { PoolClient } from "pg"

const OUTBOUND_TYPES = [
  "shipping",
  "shipment",
  "ship",
  "picking",
  "pick",
  "issue",
  "interwarehouse_ship",
  "interwarehouse_transfer",
]

const DONE = ["done", "completed", "cancelled", "canceled", "closed", "failed", "void"]

export type CrossDockHint = {
  itemCode: string
  itemName: string
  dockCode: string
  documentNo: string | null
  taskCode: string | null
  qty: number
  dueAt: string | null
  reason: string
}

export function normalizeDockCode(raw: string | null | undefined, fallback = "SHIP-01"): string {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/^FG-/, "")
  if (!s) return fallback
  if (/^(SHIP|DOCK|GATE|RAMP|ОТГР)/.test(s)) return s
  return fallback
}

export function crossDockReason(hint: Pick<CrossDockHint, "dockCode" | "documentNo" | "qty">): string {
  const doc = hint.documentNo ? ` ${hint.documentNo}` : ""
  const qty = hint.qty > 0 ? ` · ${hint.qty} шт` : ""
  return `CROSS-DOCK → ${hint.dockCode}${doc}${qty}. Не класть на хранение — сразу на отгрузку.`
}

export async function loadOutboundDemand(
  client: PoolClient,
  siteId: number,
  itemCodes?: string[]
): Promise<CrossDockHint[]> {
  const codes = (itemCodes ?? []).map((c) => String(c || "").trim()).filter(Boolean)
  try {
    const r = await client.query<{
      itemCode: string
      itemName: string
      dock: string | null
      documentNo: string | null
      taskCode: string | null
      qty: string
      dueAt: Date | string | null
    }>(
      `SELECT i.item_code AS "itemCode",
              COALESCE(i.name, i.item_code) AS "itemName",
              COALESCE(tl.location_code, tw.code) AS dock,
              d.document_no AS "documentNo",
              t.task_code AS "taskCode",
              COALESCE(t.planned_qty, 0)::text AS qty,
              t.due_at AS "dueAt"
       FROM wms_tasks t
       JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
       JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
       LEFT JOIN wms_items i ON i.item_id = t.item_id
       LEFT JOIN wms_documents d ON d.document_id = t.document_id
       LEFT JOIN wms_locations tl ON tl.location_id = t.target_location_id
       LEFT JOIN wms_warehouses tw ON tw.warehouse_id = t.target_warehouse_id
       WHERE t.site_id = $1
         AND LOWER(tt.code) = ANY($2::text[])
         AND LOWER(COALESCE(ts.code, '')) <> ALL($3::text[])
         AND ($4::text[] IS NULL OR i.item_code = ANY($4::text[]))
         AND (t.due_at IS NULL OR t.due_at <= now() + interval '36 hours')
       ORDER BY t.due_at NULLS LAST, t.task_id DESC
       LIMIT 80`,
      [siteId, OUTBOUND_TYPES, DONE, codes.length ? codes : null]
    )
    const seen = new Set<string>()
    const out: CrossDockHint[] = []
    for (const row of r.rows) {
      const itemCode = String(row.itemCode || "").trim()
      if (!itemCode || seen.has(itemCode)) continue
      seen.add(itemCode)
      const dockCode = normalizeDockCode(row.dock)
      const qty = Number(row.qty) || 0
      const documentNo = row.documentNo ? String(row.documentNo) : null
      out.push({
        itemCode,
        itemName: row.itemName,
        dockCode,
        documentNo,
        taskCode: row.taskCode,
        qty,
        dueAt: row.dueAt ? new Date(row.dueAt).toISOString() : null,
        reason: crossDockReason({ dockCode, documentNo, qty }),
      })
    }
    return out
  } catch (error) {
    console.error("[cross-dock] outbound", error)
    return []
  }
}

export async function findCrossDockForItem(
  client: PoolClient,
  siteId: number,
  itemCode: string
): Promise<CrossDockHint | null> {
  const code = String(itemCode || "").trim()
  if (!code) return null
  const rows = await loadOutboundDemand(client, siteId, [code])
  return rows.find((row) => row.itemCode === code) ?? null
}
