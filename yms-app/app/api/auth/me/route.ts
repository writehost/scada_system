import { NextResponse } from "next/server"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const gate = await requireWmsActor(req)
  if ("error" in gate) return gate.error
  const session = gate.actor.session
  return NextResponse.json({
    login: session?.login || "",
    fio: session?.fio || "",
    position: session?.position || "",
  })
}
