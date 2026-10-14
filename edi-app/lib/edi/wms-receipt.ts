import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { docType } from "./doc-types.ts"
import { createDocument, getDocument, loadLines, refreshSearchText, relateDocuments, touch } from "./documents.ts"
import { WmsUnavailable, wmsClientFor, type WmsStockPost } from "./integrations/wms.ts"
import { notifyUsers } from "./notify.ts"
import { requireFeature } from "./saas.ts"

/** Номер заказа на приход в WMS для документа EDI (ТСД нормализует документы к верхнему регистру). */
export function wmsInboundId(documentId: string): string {
  return `EDI-${documentId}`
}

export type ReceiptLine = { itemCode: string; itemName: string; expected: number; received: number; diff: number }

export function compareReceipt(
  expected: Array<{ itemCode: string; itemName: string; qty: number }>,
  post: Pick<WmsStockPost, "postedLines" | "dismissedEmpty"> | null
): { lines: ReceiptLine[]; hasDiscrepancy: boolean; complete: boolean } {
  const exp = new Map<string, { itemName: string; qty: number }>()
  for (const e of expected) {
    const key = e.itemCode.trim().toUpperCase()
    const cur = exp.get(key)
    exp.set(key, { itemName: cur?.itemName || e.itemName, qty: (cur?.qty ?? 0) + e.qty })
  }
  const got = new Map<string, number>()
  for (const p of post?.postedLines ?? []) {
    const key = p.itemCode.trim().toUpperCase()
    got.set(key, (got.get(key) ?? 0) + (Number(p.qty) || 0))
  }
  const keys = [...new Set([...exp.keys(), ...got.keys()])]
  const lines = keys.map((k) => {
    const e = exp.get(k)
    const received = Math.round((got.get(k) ?? 0) * 1000) / 1000
    const expectedQty = Math.round((e?.qty ?? 0) * 1000) / 1000
    return { itemCode: k, itemName: e?.itemName ?? "", expected: expectedQty, received, diff: Math.round((received - expectedQty) * 1000) / 1000 }
  })
  const hasDiscrepancy = lines.some((l) => Math.abs(l.diff) > 1e-9)
  return { lines, hasDiscrepancy, complete: Boolean(post) && !post?.dismissedEmpty }
}

/**
 * Создаёт в WMS заказ на приход по строкам документа. Это ожидание поставки для ТСД:
 * складские остатки не меняются, проведение делает склад после фактической приёмки.
 */
export async function createReceiptDraft(client: PoolClient, actor: Actor, documentId: string) {
  requirePermission(actor, "edi.wms.receipt")
  await requireFeature(client, actor.siteId, "integrations", "Интеграция с WMS")
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  const type = docType(doc.docType)
  if (!type?.wmsReceipt || doc.direction !== "incoming") throw new HttpError(409, "Приёмку в WMS создают по входящему УПД", "not_receivable")
  if (["cancelled", "rejected"].includes(doc.status)) throw new HttpError(409, "Документ аннулирован или отклонён", "bad_status")
  const lines = await loadLines(client, documentId)
  const unmatched = lines.filter((l) => !l.itemCode)
  if (unmatched.length) {
    throw new HttpError(409, `Не сопоставлены с номенклатурой WMS строки: ${unmatched.map((l) => l.lineNo).join(", ")}`, "unmatched_lines", {
      lines: unmatched.map((l) => l.lineNo),
    })
  }
  const wms = await wmsClientFor(client, actor.siteId, actor.siteCode)
  if (!wms) throw new HttpError(409, "Интеграция с WMS не настроена (Администрирование → Интеграции)", "wms_not_configured")
  const cp = doc.counterpartyId
    ? (await client.query<{ name: string; inn: string | null }>(`SELECT name, inn FROM edi_counterparties WHERE counterparty_id = $1::bigint`, [doc.counterpartyId])).rows[0]
    : null
  const inboundId = wmsInboundId(documentId)
  const payloadLines = lines.map((l) => ({
    itemCode: l.itemCode!,
    itemName: l.itemName || l.name,
    expectedQty: Math.round(l.qty * (l.uomFactor || 1) * 1000) / 1000,
    lotCode: l.lotCode || "",
    targetLocationCode: "",
  }))
  let inbound
  try {
    inbound = await wms.putInbound({
      documentId: inboundId,
      supplier: cp ? `${cp.name}${cp.inn ? ` (ИНН ${cp.inn})` : ""}` : "",
      expectedBatch: "",
      comment: `SCADA EDI: ${doc.title}`,
      lines: payloadLines,
    })
  } catch (e) {
    if (e instanceof WmsUnavailable) {
      await touch(client, documentId, "wms.receipt_draft", { wms_status: "link_error" })
      throw new HttpError(502, e.message, "wms_unavailable")
    }
    throw e
  }
  await client.query(
    `INSERT INTO edi_external_links (site_id, document_id, system, object_type, object_id, url, status, payload, synced_at, created_by)
     VALUES ($1, $2::bigint, 'wms', 'receiving_inbound', $3, $4, 'draft_created', $5::jsonb, now(), $6::bigint)
     ON CONFLICT (document_id, system, object_type, object_id) DO UPDATE
       SET status = 'draft_created', payload = EXCLUDED.payload, synced_at = now(), sync_error = NULL`,
    [actor.siteId, documentId, inboundId, wms.receivingUrl(inboundId), JSON.stringify({ expected: payloadLines, inboundUpdatedAt: inbound?.updatedAt ?? null }), actor.userId]
  )
  await touch(client, documentId, "wms.receipt_draft", { wms_status: "draft_created" })
  await refreshSearchText(client, documentId)
  await recordEvent(client, actorEvent(actor, "wms.receipt_draft", documentId, { inboundId, lines: payloadLines.length }))
  return { inboundId, lines: payloadLines.length }
}

/** Обновляет статус приёмки по проведениям WMS. Возвращает новый wms_status. */
export async function syncReceiptForDocument(
  client: PoolClient,
  siteId: number,
  documentId: string,
  posts: WmsStockPost[] | null,
  error?: string | null
): Promise<string | null> {
  const link = await client.query<{ link_id: string; object_id: string; payload: { expected?: Array<{ itemCode: string; itemName: string; expectedQty: number }> }; status: string }>(
    `SELECT link_id::text, object_id, payload, status FROM edi_external_links
     WHERE document_id = $1::bigint AND system = 'wms' AND object_type = 'receiving_inbound' ORDER BY link_id DESC LIMIT 1`,
    [documentId]
  )
  const row = link.rows[0]
  if (!row) return null
  if (posts == null) {
    await client.query(`UPDATE edi_external_links SET sync_error = $2, synced_at = now() WHERE link_id = $1::bigint`, [row.link_id, error ?? "WMS недоступна"])
    return row.status
  }
  const post = posts.find((p) => p.documentId.toUpperCase() === row.object_id.toUpperCase()) ?? null
  const expected = (row.payload.expected ?? []).map((e) => ({ itemCode: e.itemCode, itemName: e.itemName, qty: Number(e.expectedQty) || 0 }))
  const cmp = compareReceipt(expected, post)
  const status = !post ? "draft_created" : cmp.hasDiscrepancy ? "received_with_discrepancies" : "received"
  await client.query(
    `UPDATE edi_external_links SET status = $2, payload = payload || $3::jsonb, synced_at = now(), sync_error = NULL WHERE link_id = $1::bigint`,
    [row.link_id, status, JSON.stringify({ comparison: cmp.lines, postedAt: post?.postedAtIso ?? null, locationCode: post?.locationCode ?? null })]
  )
  if (status !== row.status) {
    const doc = await client.query<{ responsible_user_id: string | null; author_user_id: string | null; title: string }>(
      `UPDATE edi_documents SET wms_status = $2, updated_at = now(), last_action = 'wms.receipt_synced', last_action_at = now()
       WHERE document_id = $1::bigint RETURNING responsible_user_id::text, author_user_id::text, title`,
      [documentId, status]
    )
    await recordEvent(client, { siteId, documentId, action: "wms.receipt_synced", actorName: "SCADA WMS", details: { status, lines: cmp.lines } })
    const d = doc.rows[0]
    const users = [d?.responsible_user_id, d?.author_user_id].filter((x): x is string => Boolean(x))
    if (status !== "draft_created" && users.length) {
      await notifyUsers(client, {
        siteId,
        userIds: users,
        event: status === "received" ? "wms.received" : "wms.discrepancy",
        title: status === "received" ? "Склад принял товар по документу" : "Приёмка с расхождениями",
        body: d.title,
        documentId,
        dedupeKey: `wms:${documentId}:${status}`,
      })
    }
  }
  return status
}

/** Фоновая сверка: один запрос проведений к WMS на организацию, затем все ожидающие документы. */
export async function syncPendingReceipts(client: PoolClient, siteId: number, siteCode: string): Promise<{ checked: number; changed: number; error?: string }> {
  const docs = await client.query<{ document_id: string; wms_status: string }>(
    `SELECT document_id::text, wms_status FROM edi_documents
     WHERE site_id = $1 AND wms_status IN ('draft_created','receiving','link_error') AND deleted_at IS NULL LIMIT 500`,
    [siteId]
  )
  if (docs.rows.length === 0) return { checked: 0, changed: 0 }
  const wms = await wmsClientFor(client, siteId, siteCode)
  let posts: WmsStockPost[] | null = null
  let error: string | undefined
  if (!wms) error = "Интеграция с WMS не настроена"
  else {
    try {
      posts = await wms.stockPosts()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
  let changed = 0
  for (const d of docs.rows) {
    const s = await syncReceiptForDocument(client, siteId, d.document_id, posts, error)
    if (s && s !== d.wms_status) changed++
  }
  return { checked: docs.rows.length, changed, ...(error ? { error } : {}) }
}

/** Акт расхождений по результату приёмки: строки с отклонением факта от УПД, связь с исходным документом. */
export async function createDiscrepancyAct(client: PoolClient, actor: Actor, documentId: string) {
  requirePermission(actor, "edi.doc.create")
  const doc = await getDocument(client, actor, documentId)
  const link = await client.query<{ payload: { comparison?: ReceiptLine[] } }>(
    `SELECT payload FROM edi_external_links WHERE document_id = $1::bigint AND system = 'wms' AND object_type = 'receiving_inbound'
     ORDER BY link_id DESC LIMIT 1`,
    [documentId]
  )
  const diffs = (link.rows[0]?.payload.comparison ?? []).filter((l) => Math.abs(l.diff) > 1e-9)
  if (!diffs.length) throw new HttpError(409, "Расхождений по приёмке нет", "no_discrepancies")
  const src = await loadLines(client, documentId)
  const priceOf = (code: string) => src.find((l) => (l.itemCode ?? "").toUpperCase() === code)?.price ?? null
  const vatOf = (code: string) => src.find((l) => (l.itemCode ?? "").toUpperCase() === code)?.vatRate ?? null
  const act = await createDocument(client, actor, {
    docType: "discrepancy_act",
    direction: "outgoing",
    counterpartyId: doc.counterpartyId,
    basis: doc.title,
    fields: {
      basis: doc.title,
      findings: diffs.map((d) => `${d.itemCode} ${d.itemName}: по документу ${d.expected}, принято ${d.received} (${d.diff > 0 ? "+" : ""}${d.diff})`).join("\n"),
    },
    lines: diffs.map((d) => ({
      name: d.itemName || d.itemCode,
      itemCode: d.itemCode,
      qty: Math.abs(d.diff),
      price: priceOf(d.itemCode),
      vatRate: vatOf(d.itemCode),
      extra: { expected: d.expected, received: d.received, diff: d.diff },
    })),
  })
  await relateDocuments(client, actor, act.documentId, documentId, "basis")
  return { documentId: act.documentId }
}

/** Ручное обновление статуса приёмки по одному документу (кнопка в карточке). */
export async function syncOneReceipt(client: PoolClient, actor: Actor, documentId: string) {
  await getDocument(client, actor, documentId)
  const wms = await wmsClientFor(client, actor.siteId, actor.siteCode)
  if (!wms) throw new HttpError(409, "Интеграция с WMS не настроена", "wms_not_configured")
  let posts: WmsStockPost[] | null = null
  let error: string | null = null
  try {
    posts = await wms.stockPosts()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const status = await syncReceiptForDocument(client, actor.siteId, documentId, posts, error)
  if (error) throw new HttpError(502, error, "wms_unavailable")
  return { wmsStatus: status }
}
