import { randomUUID } from "crypto"
import type { PoolClient } from "pg"
import { createCodeList } from "@/lib/wms/code-lists"
import { WEB_OPERATOR_DEVICE_UID } from "@/lib/wms/devices"
import { WmsHttpError } from "@/lib/wms/errors"
import { getLabelCodeOrder } from "@/lib/wms/label-code-orders"
import { tryGetPool } from "@/lib/wms/pool"
import { ensurePrintedStickerItem } from "@/lib/wms/printed-sticker-item"
import { sampleCrptLotDates } from "@/lib/wms/receiving-crpt"
import { normalizeTsdDocumentId } from "@/lib/wms/receiving-tsd-sessions"
import { getSiteId } from "@/lib/wms/resolve"
import { withStickerNamePrefix } from "@/lib/wms/sticker-item-name"

export function printedOrderDocumentId(orderId: string): string {
  const compact = orderId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase()
  return normalizeTsdDocumentId(`PRT-${compact || "ORDER"}`)
}

function normKm(raw: string): string {
  return String(raw || "").replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, "").trim()
}

async function existingDocumentCodes(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<Set<string>> {
  const r = await client.query<{ code: string }>(
    `SELECT e->>'code' AS code
     FROM wms_code_lists cl
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
     ) AS e
     WHERE cl.site_id = $1
       AND cl.list_type = 'receiving_scan_event'
       AND upper(trim(COALESCE(e->>'documentId', ''))) = $2
       AND trim(COALESCE(e->>'code', '')) <> ''`,
    [siteId, documentId]
  )
  return new Set(r.rows.map((row) => normKm(row.code)).filter(Boolean))
}

async function sessionExists(client: PoolClient, siteId: number, documentId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1
     FROM wms_code_lists cl
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json ELSE '[]'::jsonb END
     ) AS e
     WHERE cl.site_id = $1
       AND cl.list_type = 'receiving_session_status'
       AND upper(trim(COALESCE(e->>'documentId', e->>'code', ''))) = $2
     LIMIT 1`,
    [siteId, documentId]
  )
  return r.rowCount != null && r.rowCount > 0
}

export async function ingestLabelOrderToReceiving(input: {
  orderId: string
  siteCode?: string
}): Promise<{ documentId: string; codesCount: number; already?: boolean }> {
  const order = await getLabelCodeOrder(input.orderId, true)
  const codes = (order.codes || []).map((c) => String(c || "").trim()).filter(Boolean)
  if (codes.length === 0) {
    throw new WmsHttpError(400, "В заказе нет кодов — сначала получите КМ", "label_order_no_codes")
  }

  const pool = tryGetPool()
  if (!pool) {
    throw new WmsHttpError(503, "База WMS не настроена", "database_not_configured")
  }

  const siteCode = (input.siteCode || "DEFAULT").trim() || "DEFAULT"
  const documentId = printedOrderDocumentId(order.id)
  const scannedAtIso = new Date().toISOString()
  const gtin = String(order.gtin || "").replace(/\D/g, "").padStart(14, "0").slice(-14)
  const itemName = withStickerNamePrefix(order.nomenclatureName?.trim() || `GTIN ${order.gtin}`)

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      throw new WmsHttpError(404, "Неизвестный склад", "unknown_site")
    }
    const sticker = await ensurePrintedStickerItem(client, siteId, {
      gtin,
      productName: itemName,
    })
    const already = await existingDocumentCodes(client, siteId, documentId)
    const fresh = codes.filter((code) => !already.has(normKm(code)))
    if (fresh.length === 0 && (await sessionExists(client, siteId, documentId))) {
      return { documentId, codesCount: already.size, already: true }
    }

    const crptSample = await sampleCrptLotDates(fresh.length > 0 ? fresh : codes)
    const emissionAtIso = crptSample?.emissionAt ?? scannedAtIso

    const chunkSize = 800
    for (let offset = 0; offset < fresh.length; offset += chunkSize) {
      const slice = fresh.slice(offset, offset + chunkSize)
      await createCodeList(client, siteId, {
        requestId: randomUUID(),
        deviceUid: WEB_OPERATOR_DEVICE_UID,
        listType: "receiving_scan_event",
        entries: slice.map((code) => ({
          kind: "scan",
          code,
          scannedAtIso,
          documentId,
          itemCode: sticker.itemCode,
          itemName: sticker.name,
          qty: 1,
          note: `label-order:${order.id}`,
          stickerStatus: "EMITTED",
          itemStatus: "эмитирован",
          emissionAtIso,
          expiryAtIso: crptSample?.expiresAt ?? null,
          expiryState: "ok",
        })),
      })
    }

    const totalCount = already.size + fresh.length
    await createCodeList(client, siteId, {
      requestId: randomUUID(),
      deviceUid: WEB_OPERATOR_DEVICE_UID,
      listType: "receiving_session_status",
      entries: [
        {
          kind: "code",
          code: documentId,
          documentId,
          scannedAtIso,
          note: "active",
          qty: totalCount,
          itemCode: "stickers",
          itemName: sticker.name,
        },
      ],
    })

    return { documentId, codesCount: totalCount }
  } finally {
    client.release()
  }
}
