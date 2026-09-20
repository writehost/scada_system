import type { PoolClient } from "pg"
import {
  saveTorg1DocumentForm,
  saveTorg1SessionDraft,
  type Torg1Fields,
} from "@/lib/wms/torg1"
import { loadTorg1ForDocument, loadTorg1ForSession } from "@/lib/wms/torg1-load"

export type Torg1SessionRefreshHints = {
  documentNo?: string | null
  composedAt?: string | null
  locationCode?: string | null
  comment?: string | null
  externalRef?: string | null
  warehouseCode?: string | null
}

export type Torg1SessionRefreshTarget = {
  sessionId: string
  hints?: Torg1SessionRefreshHints
}

/** Поля, которые берутся из шаблона (Настройки → ТОРГ-1). */
const TORG1_TEMPLATE_FIELD_KEYS: Array<keyof Torg1Fields> = [
  "orgName",
  "orgAddress",
  "orgPhone",
  "okpo",
  "okud",
  "okdp",
  "approveTitle",
  "approveName",
]

export type Torg1RefreshMode = "template" | "full_reset"

export type Torg1RefreshResult = {
  documentsUpdated: number
  sessionsUpdated: number
  errors: Array<{ id: string; kind: "document" | "session"; message: string }>
}

async function listReceivingDocumentIds(client: PoolClient, siteId: number): Promise<string[]> {
  const r = await client.query<{ id: string }>(
    `SELECT d.document_id::text AS id
     FROM wms_documents d
     JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
     WHERE d.site_id = $1 AND dt.code = 'receiving'
     ORDER BY d.created_at DESC`,
    [siteId]
  )
  return r.rows.map((row) => row.id)
}

async function inferSessionHints(
  client: PoolClient,
  siteId: number,
  sessionId: string
): Promise<Torg1SessionRefreshHints> {
  try {
    const r = await client.query<{ composedAt: string | null; deviceUid: string | null }>(
      `SELECT
         min(COALESCE(NULLIF(trim(e->>'scannedAtIso'), ''), cl.created_at::text)) AS "composedAt",
         max(NULLIF(trim(cl.device_uid), '')) AS "deviceUid"
       FROM wms_code_lists cl
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json
           ELSE '[]'::jsonb
         END
       ) AS e
       WHERE cl.site_id = $1
         AND cl.list_type IN ('receiving_scan_event', 'receiving_session_status')
         AND upper(trim(
           CASE
             WHEN cl.list_type = 'receiving_scan_event' THEN COALESCE(e->>'documentId', '')
             ELSE COALESCE(e->>'documentId', e->>'code', '')
           END
         )) = upper(trim($2))`,
      [siteId, sessionId]
    )
    const row = r.rows[0]
    return {
      documentNo: `Приёмка ${sessionId}`,
      composedAt: row?.composedAt ?? null,
      externalRef: row?.deviceUid ? `ТСД ${row.deviceUid}` : null,
    }
  } catch {
    return { documentNo: `Приёмка ${sessionId}` }
  }
}

async function listReceivingSessionIds(client: PoolClient, siteId: number): Promise<string[]> {
  const ids = new Set<string>()
  const drafts = await client.query<{ setting_key: string }>(
    `SELECT setting_key
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key LIKE 'torg1_session:%'`,
    [siteId]
  )
  for (const row of drafts.rows) {
    const id = row.setting_key.slice("torg1_session:".length).trim()
    if (id) ids.add(id)
  }
  const sessions = await client.query<{ documentId: string | null }>(
    `SELECT DISTINCT
       upper(trim(
         CASE
           WHEN cl.list_type = 'receiving_scan_event' THEN COALESCE(e->>'documentId', '')
           ELSE COALESCE(e->>'documentId', e->>'code', '')
         END
       )) AS "documentId"
     FROM wms_code_lists cl
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(cl.entries_json) = 'array' THEN cl.entries_json
         ELSE '[]'::jsonb
       END
     ) AS e
     WHERE cl.site_id = $1
       AND cl.list_type IN ('receiving_scan_event', 'receiving_session_status')
       AND trim(
         CASE
           WHEN cl.list_type = 'receiving_scan_event' THEN COALESCE(e->>'documentId', '')
           ELSE COALESCE(e->>'documentId', e->>'code', '')
         END
       ) <> ''`,
    [siteId]
  )
  for (const row of sessions.rows) {
    const id = (row.documentId || "").trim()
    if (id) ids.add(id)
  }
  return [...ids]
}

function stripTemplateOverrides(overrides: Partial<Torg1Fields>): Partial<Torg1Fields> {
  const next = { ...overrides }
  for (const key of TORG1_TEMPLATE_FIELD_KEYS) delete next[key]
  delete next.lines
  return next
}

function overridesForMode(
  formOverrides: Partial<Torg1Fields>,
  mode: Torg1RefreshMode
): Partial<Torg1Fields> {
  if (mode === "full_reset") return {}
  return stripTemplateOverrides(formOverrides)
}

export async function refreshReceivingTorg1Forms(
  client: PoolClient,
  siteId: number,
  mode: Torg1RefreshMode = "template",
  opts?: {
    documentIds?: string[]
    sessionIds?: string[]
    sessions?: Torg1SessionRefreshTarget[]
  }
): Promise<Torg1RefreshResult> {
  const result: Torg1RefreshResult = {
    documentsUpdated: 0,
    sessionsUpdated: 0,
    errors: [],
  }

  const documentIds = opts?.documentIds?.length
    ? opts.documentIds
    : opts?.sessions?.length || opts?.sessionIds?.length
      ? []
      : await listReceivingDocumentIds(client, siteId)

  let sessionTargets: Torg1SessionRefreshTarget[] = []
  if (opts?.sessions?.length) {
    sessionTargets = opts.sessions
  } else if (opts?.sessionIds?.length) {
    sessionTargets = opts.sessionIds.map((sessionId) => ({ sessionId }))
  } else if (!opts?.documentIds?.length) {
    const ids = await listReceivingSessionIds(client, siteId)
    sessionTargets = ids.map((sessionId) => ({ sessionId }))
  }

  for (const documentId of documentIds) {
    try {
      const form = await loadTorg1ForDocument(client, siteId, documentId)
      if (!form) {
        result.errors.push({ id: documentId, kind: "document", message: "документ не найден" })
        continue
      }
      const overrides = overridesForMode(form.overrides, mode)
      await saveTorg1DocumentForm(
        client,
        siteId,
        documentId,
        overrides,
        form.title || `ТОРГ-1 № ${form.fields.documentNo || documentId}`
      )
      result.documentsUpdated += 1
    } catch (e) {
      result.errors.push({
        id: documentId,
        kind: "document",
        message: e instanceof Error ? e.message : "ошибка обновления",
      })
    }
  }

  for (const target of sessionTargets) {
    const sessionId = target.sessionId
    try {
      const hints = target.hints ?? (await inferSessionHints(client, siteId, sessionId))
      const form = await loadTorg1ForSession(client, siteId, sessionId, hints)
      const overrides = overridesForMode(form.overrides, mode)
      await saveTorg1SessionDraft(client, siteId, sessionId, overrides)
      result.sessionsUpdated += 1
    } catch (e) {
      result.errors.push({
        id: sessionId,
        kind: "session",
        message: e instanceof Error ? e.message : "ошибка обновления",
      })
    }
  }

  return result
}

export async function refreshSingleDocumentTorg1(
  client: PoolClient,
  siteId: number,
  documentId: string,
  mode: Torg1RefreshMode = "template"
): Promise<Torg1RefreshResult> {
  return refreshReceivingTorg1Forms(client, siteId, mode, { documentIds: [documentId] })
}

export async function refreshSingleSessionTorg1(
  client: PoolClient,
  siteId: number,
  sessionId: string,
  mode: Torg1RefreshMode = "template"
): Promise<Torg1RefreshResult> {
  return refreshReceivingTorg1Forms(client, siteId, mode, { sessionIds: [sessionId] })
}
