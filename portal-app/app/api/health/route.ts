import { NextResponse } from "next/server"
import { withClient } from "@/lib/db"
import { loginConfigured, provisioningConfigured } from "@/lib/scada-id/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  let database = false
  try {
    await withClient((c) => c.query("SELECT 1"))
    database = true
  } catch {
    database = false
  }
  return NextResponse.json(
    { ok: database, database, scadaIdLogin: loginConfigured(), scadaIdProvisioning: provisioningConfigured() },
    { status: database ? 200 : 503 }
  )
}
