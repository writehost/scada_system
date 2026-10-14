import { NextResponse } from "next/server"
import { loadScadaIdConfig } from "@/lib/auth/scada-id.ts"
import { publicOrigin } from "@/lib/auth/origin.ts"
import { tryGetPool } from "@/lib/db.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const pool = tryGetPool()
  let scadaId = false
  if (pool) {
    const client = await pool.connect().catch(() => null)
    if (client) {
      try {
        scadaId = Boolean(await loadScadaIdConfig(client, publicOrigin(req)))
      } catch {
        scadaId = false
      } finally {
        client.release()
      }
    }
  }
  return NextResponse.json({ password: true, scadaId, database: Boolean(pool) })
}
