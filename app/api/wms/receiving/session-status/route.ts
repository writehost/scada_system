import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { createCodeList } from "@/lib/wms/code-lists"
import { WmsHttpError } from "@/lib/wms/errors"
import { tryGetPool } from "@/lib/wms/pool"
import { normalizeTsdDocumentId } from "@/lib/wms/receiving-tsd-sessions"
import { getSiteId } from "@/lib/wms/resolve"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED = new Set(["active", "paused", "closed"])

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }

  let body: {
    siteCode?: string
    documentId?: string
    status?: string
    lineCount?: number | null
    deviceUid?: string | null
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const siteCode = String(body.siteCode ?? "").trim()
  const documentId = normalizeTsdDocumentId(String(body.documentId ?? ""))
  const status = String(body.status ?? "").trim().toLowerCase()
  const deviceUid = String(body.deviceUid ?? "web-operator").trim() || "web-operator"
  const lineCount = Number.isFinite(Number(body.lineCount)) ? Number(body.lineCount) : null

  if (!siteCode || !documentId) {
    return NextResponse.json({ error: "siteCode and documentId are required" }, { status: 400 })
  }
  if (!ALLOWED.has(status)) {
    return NextResponse.json({ error: "status must be active, paused, or closed" }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const scannedAtIso = new Date().toISOString()
    const data = await createCodeList(client, siteId, {
      requestId: randomUUID(),
      deviceUid,
      listType: "receiving_session_status",
      entries: [
        {
          kind: "code",
          code: documentId,
          documentId,
          scannedAtIso,
          note: status,
          qty: lineCount ?? undefined,
        },
      ],
    })
    return NextResponse.json({ ok: true, documentId, status, ...data })
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error(error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}
