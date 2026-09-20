import { NextResponse } from "next/server"
import { readFgKaraFleet, upsertKara, writeFgKaraFleet } from "@/lib/wms/fg-kara-fleet"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const params = await Promise.resolve(ctx.params)
  return withFleetSite(req, async (_client, siteId, body) => {
    const fleet = await readFgKaraFleet(siteId)
    const existing = fleet.karas.find((k) => k.id === params.id)
    if (!existing) return NextResponse.json({ error: "кара не найдена" }, { status: 404 })
    const { snapshot, kara } = upsertKara(fleet, { ...existing, ...body, id: params.id })
    const saved = await writeFgKaraFleet(siteId, snapshot)
    return NextResponse.json({ kara, fleet: saved })
  })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const params = await Promise.resolve(ctx.params)
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    if (!fleet.karas.some((k) => k.id === params.id)) {
      return NextResponse.json({ error: "кара не найдена" }, { status: 404 })
    }
    const saved = await writeFgKaraFleet(siteId, {
      ...fleet,
      karas: fleet.karas.filter((k) => k.id !== params.id),
      missions: fleet.missions.filter((m) => m.karaId !== params.id),
      drivers: fleet.drivers.map((d) =>
        d.karaId === params.id ? { ...d, karaId: null } : d
      ),
    })
    return NextResponse.json({ ok: true, fleet: saved })
  })
}
