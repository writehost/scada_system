import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/db.ts"
import { assertSchemaReady } from "@/lib/edi/schema.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const pool = tryGetPool()
  if (!pool || !process.env.SCADA_ID_EDI_CLIENT_SECRET) {
    return NextResponse.json({ status: "setup_required" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
  try {
    const client = await pool.connect()
    try { await assertSchemaReady(client) } finally { client.release() }
    return NextResponse.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
