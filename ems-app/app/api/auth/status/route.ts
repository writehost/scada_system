import { NextResponse } from "next/server"
import { scadaIdConfigured } from "@/lib/server/scada-id.ts"
import { devLoginEnabled } from "@/lib/server/login.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ scadaId: scadaIdConfigured(), devLogin: devLoginEnabled() })
}
