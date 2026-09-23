import type { PoolClient } from "pg"

export type WmsOrderCard = {
  documentId: string
  documentNo: string | null
  documentType: string
  documentStatus: string
  comment: string | null
  counterparty: string | null
  plannedQty: number
  confirmedQty: number
  remainingQty: number
  palletCount: number
  openTaskCount: number
  locations: string | null
  ready: boolean
}

export async function searchWmsOrders(
  client: PoolClient,
  siteId: number,
  query: string,
  limit: number
): Promise<WmsOrderCard[]> {
  const q = query.trim()
  const r = await client.query(
    `SELECT
       d.document_id::text AS "documentId",
       d.document_no AS "documentNo",
       dt.code AS "documentType",
       ds.code AS "documentStatus",
       d.comment AS "comment",
       NULLIF(trim(COALESCE(
         d.payload_json->>'counterparty',
         d.payload_json->>'customer',
         d.payload_json->>'partner',
         ''
       )), '') AS "counterparty",
       COALESCE(SUM(dl.requested_qty), 0)::float AS "plannedQty",
       COALESCE(SUM(dl.confirmed_qty), 0)::float AS "confirmedQty",
       COUNT(DISTINCT dl.load_unit_id) FILTER (WHERE dl.load_unit_id IS NOT NULL)::int AS "palletCount",
       COUNT(DISTINCT t.task_id) FILTER (WHERE t.task_status_id = ANY (ARRAY[1,2,3]::smallint[]))::int AS "openTaskCount",
       NULLIF(string_agg(DISTINCT sl.location_code, ', '), '') AS "locations"
     FROM wms_documents d
     JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
     JOIN ref_wms_document_status ds ON ds.document_status_id = d.document_status_id
     LEFT JOIN wms_document_lines dl ON dl.document_id = d.document_id
     LEFT JOIN wms_locations sl ON sl.location_id = dl.source_location_id
     LEFT JOIN wms_tasks t ON t.document_id = d.document_id
     WHERE d.site_id = $1
       AND dt.code = ANY($2::text[])
       AND (
         $3::text = ''
         OR COALESCE(d.document_no, '') ILIKE '%' || $3 || '%'
         OR d.document_id::text = $3
         OR COALESCE(d.comment, '') ILIKE '%' || $3 || '%'
       )
     GROUP BY d.document_id, dt.code, ds.code
     ORDER BY d.document_id DESC
     LIMIT $4`,
    [siteId, ["shipping", "picking"], q, limit]
  )
  return r.rows.map(mapOrder)
}

export async function getWmsOrder(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<WmsOrderCard | null> {
  if (!/^\d+$/.test(documentId)) return null
  const rows = await searchWmsOrders(client, siteId, documentId, 5)
  return rows.find((row) => row.documentId === documentId) ?? null
}

export async function resolveWmsOrder(
  client: PoolClient,
  siteId: number,
  raw: string
): Promise<WmsOrderCard | null> {
  const rows = await searchWmsOrders(client, siteId, raw, 8)
  return (
    rows.find((row) => row.documentId === raw) ??
    rows.find((row) => row.documentNo === raw) ??
    (rows.length === 1 ? rows[0] : null)
  )
}

function mapOrder(row: {
  documentId: string
  documentNo: string | null
  documentType: string
  documentStatus: string
  comment: string | null
  counterparty: string | null
  plannedQty: number
  confirmedQty: number
  palletCount: number
  openTaskCount: number
  locations: string | null
}): WmsOrderCard {
  const plannedQty = Number(row.plannedQty) || 0
  const confirmedQty = Number(row.confirmedQty) || 0
  const remainingQty = Math.max(0, plannedQty - confirmedQty)
  return {
    documentId: row.documentId,
    documentNo: row.documentNo,
    documentType: row.documentType,
    documentStatus: row.documentStatus,
    comment: row.comment,
    counterparty: row.counterparty,
    plannedQty,
    confirmedQty,
    remainingQty,
    palletCount: Number(row.palletCount) || 0,
    openTaskCount: Number(row.openTaskCount) || 0,
    locations: row.locations,
    ready: plannedQty > 0 && remainingQty <= 0.0001,
  }
}
