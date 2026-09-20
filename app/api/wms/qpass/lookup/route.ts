import { NextResponse } from "next/server"
import { findQpassPassport } from "@/lib/wms/qpass-api"
import { exactQpassText, fetchQpassPublic, parseQpassPublicId } from "@/lib/wms/qpass"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  const url = new URL(req.url)
  const name = exactQpassText(url.searchParams.get("name"))
  const serial = exactQpassText(url.searchParams.get("serial") || url.searchParams.get("serialNumber"))
  if (name && serial) {
    try {
      const pass = await findQpassPassport(name, serial)
      if (!pass) return NextResponse.json({ found: false }, { status: 404 })
      return NextResponse.json({ found: true, pass })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "qpass unavailable" },
        { status: 502 }
      )
    }
  }
  const q = (url.searchParams.get("q") || "").trim()
  const publicId = parseQpassPublicId(q)
  if (!publicId) {
    return NextResponse.json({ error: "укажите ссылку или код паспорта QPass" }, { status: 400 })
  }
  try {
    const pass = await fetchQpassPublic(publicId)
    if (!pass) {
      return NextResponse.json({ found: false, publicId }, { status: 404 })
    }
    return NextResponse.json({ found: true, pass })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "qpass unavailable" },
      { status: 502 }
    )
  }
}
