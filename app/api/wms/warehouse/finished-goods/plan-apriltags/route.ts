import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { requireWmsActor } from "@/lib/wms/require-actor"
import {
  normalizePlanAprilTags,
  readFgPlanAprilTags,
  writeFgPlanAprilTags,
} from "@/lib/wms/fg-plan-apriltags-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? ""
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const snapshot = await readFgPlanAprilTags(siteId)
    return NextResponse.json(snapshot)
  } finally {
    client.release()
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = typeof (body as { siteCode?: string }).siteCode === "string" ? body.siteCode.trim() : ""
  const tagsRaw = (body as { tags?: unknown }).tags
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  const tags = normalizePlanAprilTags(tagsRaw)

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const snapshot = await writeFgPlanAprilTags(siteId, tags)
    return NextResponse.json(snapshot)
  } finally {
    client.release()
  }
}
