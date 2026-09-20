import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import {
  createTransferOrderInOneCAndWms,
  listErpTransferOrders,
} from "@/lib/wms/one-c-transfer-orders"
import { parseRequestId } from "@/lib/wms/uuid"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

async function requireSession(req: Request) {
  const token = await readAuthTokenFromRequest(req)
  const session = token ? await verifySessionToken(token) : null
  if (!session) return null
  return session
}

export async function GET(req: Request) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() || ""
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message }, { status: conn.status })

  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const data = await listErpTransferOrders(conn.client, siteId, {
      query: url.searchParams.get("query") ?? "",
      limit: Number(url.searchParams.get("limit") ?? "40"),
      onlyOpen: url.searchParams.get("onlyOpen") === "1",
    })
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : "не удалось прочитать заказы ERP"
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    conn.client.release()
  }
}

export async function POST(req: Request) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    siteCode?: string
    requestId?: string
    comment?: string
    sourceWarehouseKey?: string
    targetWarehouseKey?: string
    organizationKey?: string
    recipientOrganizationKey?: string
    priorityKey?: string
    authorKey?: string
    departmentKey?: string
    responsibleKey?: string
    status?: string
    operation?: string
    deliveryMethod?: string
    activity?: string
    acceptanceVariant?: string
    supplyVariant?: string
    lines?: Array<{ itemCode?: string; nomenclatureKey?: string; qty?: number }>
  }
  const siteCode = String(body.siteCode || "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message }, { status: conn.status })

  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const result = await createTransferOrderInOneCAndWms(conn.client, siteId, {
      requestId: parseRequestId(body.requestId) || undefined,
      comment: body.comment,
      sourceWarehouseKey: String(body.sourceWarehouseKey || "").trim(),
      targetWarehouseKey: String(body.targetWarehouseKey || "").trim(),
      organizationKey: body.organizationKey,
      recipientOrganizationKey: body.recipientOrganizationKey,
      priorityKey: body.priorityKey,
      authorKey: body.authorKey,
      departmentKey: body.departmentKey,
      responsibleKey: body.responsibleKey,
      status: body.status,
      operation: body.operation,
      deliveryMethod: body.deliveryMethod,
      activity: body.activity,
      acceptanceVariant: body.acceptanceVariant,
      supplyVariant: body.supplyVariant,
      lines: (body.lines || []).map((line) => ({
        itemCode: String(line.itemCode || "").trim(),
        nomenclatureKey: line.nomenclatureKey,
        qty: Number(line.qty),
      })),
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "не удалось создать заказ на перемещение"
    return NextResponse.json({ error: message }, { status: 502 })
  } finally {
    conn.client.release()
  }
}
