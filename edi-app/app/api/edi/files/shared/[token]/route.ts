import { NextResponse } from "next/server"
import { verifyPayload } from "@/lib/auth/session.ts"
import { withClient } from "@/lib/db.ts"
import { errorResponse, prepare } from "@/lib/http.ts"
import { actorForUser } from "@/lib/edi/actor.ts"
import { fileForActor, fileResponse } from "@/lib/edi/download.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, seg: { params: Promise<{ token: string }> }) {
  const { token } = await seg.params
  const p = await verifyPayload<{ f: string; s: number; u: string; exp: number; k: string }>(decodeURIComponent(token))
  if (!p || p.k !== "file" || p.exp < Date.now()) {
    return NextResponse.json({ error: "Ссылка недействительна или истекла", code: "link_expired" }, { status: 410 })
  }
  try {
    const f = await withClient(async (client) => {
      await prepare(client)
      const actor = await actorForUser(client, p.s, p.u)
      return fileForActor(client, actor, p.f)
    })
    return fileResponse(f, true)
  } catch (e) {
    return errorResponse(e)
  }
}
