import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { getDocument, touch } from "./documents.ts"
import { resolveIntegration } from "./integrations/config.ts"
import { requireFeature } from "./saas.ts"

/**
 * EDI Provider Gateway — слой подключения операторов ЭДО через их официальные API.
 * Ядро EDI работает только с этим контрактом; адаптер конкретного оператора добавляется
 * отдельным модулем и регистрируется в PROVIDERS без переписывания backend.
 *
 * Сейчас в реестре нет ни одного адаптера: ни один оператор не проверен на реальном API
 * или официальном тестовом контуре (нет доступов). Поэтому отправка через оператора
 * в интерфейсе не показывается, а обмен не имитируется.
 */

export type OutgoingPackage = {
  documentId: string
  idempotencyKey: string
  recipient: { inn: string; kpp: string | null; boxId: string | null }
  files: Array<{ fileName: string; mime: string; bytes: Uint8Array; signature?: Uint8Array }>
  formatCode: string | null
}

export type ProviderStatus = {
  providerMessageId: string
  status: "sent" | "delivered" | "accepted" | "rejected" | "clarification" | "error"
  receipts: Array<{ kind: string; at: string; fileName?: string; bytes?: Uint8Array; payload?: Record<string, unknown> }>
  message?: string
}

export interface EdoProvider {
  code: string
  name: string
  /** Где проверено: "production" | "sandbox". Провайдер без проверки в реестр не добавляется. */
  verifiedOn: "production" | "sandbox"
  testConnection(cfg: Record<string, unknown>, secret: string): Promise<{ ok: boolean; message: string; boxes?: Array<{ boxId: string; title: string }> }>
  send(cfg: Record<string, unknown>, secret: string, pkg: OutgoingPackage): Promise<ProviderStatus>
  status(cfg: Record<string, unknown>, secret: string, providerMessageId: string): Promise<ProviderStatus>
  fetchIncoming(cfg: Record<string, unknown>, secret: string, since: string | null): Promise<Array<{ providerMessageId: string; sender: { inn: string; kpp: string | null }; files: OutgoingPackage["files"] }>>
  /** Проверка подписи входящего вебхука оператора (если оператор их присылает). */
  verifyWebhook?(headers: Headers, body: Uint8Array, secret: string): boolean
}

export const PROVIDERS: EdoProvider[] = []

export function providerByCode(code: string): EdoProvider | null {
  return PROVIDERS.find((p) => p.code === code) ?? null
}

/** Подключён ли проверенный оператор для организации — от этого зависит показ действия «Отправить через ЭДО». */
export async function edoAvailable(client: PoolClient, siteId: number): Promise<{ available: boolean; provider: string | null; reason: string }> {
  if (PROVIDERS.length === 0) return { available: false, provider: null, reason: "Нет проверенных адаптеров операторов ЭДО" }
  const cfg = await resolveIntegration(client, siteId, "edo")
  if (!cfg || !cfg.enabled) return { available: false, provider: null, reason: "Оператор ЭДО не подключён" }
  if (!providerByCode(cfg.provider)) return { available: false, provider: cfg.provider, reason: `Адаптер «${cfg.provider}» отсутствует` }
  return { available: true, provider: cfg.provider, reason: "" }
}

export async function sendViaEdo(client: PoolClient, actor: Actor, documentId: string) {
  requirePermission(actor, "edi.doc.send")
  await requireFeature(client, actor.siteId, "edo", "Обмен через оператора ЭДО")
  const avail = await edoAvailable(client, actor.siteId)
  if (!avail.available) throw new HttpError(409, avail.reason, "edo_unavailable")
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  if (doc.signedVersion == null) throw new HttpError(409, "Юридически значимая отправка — только подписанной версии", "not_signed")
  const cfg = (await resolveIntegration(client, actor.siteId, "edo"))!
  const provider = providerByCode(cfg.provider)!
  const key = `send:${documentId}:v${doc.signedVersion}`
  const existing = await client.query(`SELECT exchange_id FROM edi_exchanges WHERE site_id = $1 AND idempotency_key = $2`, [actor.siteId, key])
  if (existing.rows[0]) throw new HttpError(409, "Эта версия уже отправлена", "already_sent")
  const ex = await client.query<{ exchange_id: string }>(
    `INSERT INTO edi_exchanges (site_id, document_id, integration_id, direction, idempotency_key, status, request)
     VALUES ($1, $2::bigint, $3::bigint, 'out', $4, 'queued', $5::jsonb) RETURNING exchange_id::text`,
    [actor.siteId, documentId, cfg.integrationId, key, JSON.stringify({ version: doc.signedVersion })]
  )
  await touch(client, documentId, "exchange.sent", { exchange_status: "queued" })
  await recordEvent(client, actorEvent(actor, "exchange.sent", documentId, { provider: provider.code, exchangeId: ex.rows[0].exchange_id }))
  return { exchangeId: ex.rows[0].exchange_id }
}

export async function listExchanges(client: PoolClient, documentId: string) {
  const r = await client.query(
    `SELECT e.exchange_id::text AS "exchangeId", e.direction, e.status, e.provider_message_id AS "providerMessageId", e.error,
            e.created_at AS "createdAt", e.updated_at AS "updatedAt", i.provider,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', r.kind, 'at', r.received_at, 'fileId', r.file_id::text) ORDER BY r.receipt_id), '[]'::jsonb)
               FROM edi_exchange_receipts r WHERE r.exchange_id = e.exchange_id) AS receipts
     FROM edi_exchanges e LEFT JOIN edi_integrations i ON i.integration_id = e.integration_id
     WHERE e.document_id = $1::bigint ORDER BY e.exchange_id DESC`,
    [documentId]
  )
  return r.rows
}
