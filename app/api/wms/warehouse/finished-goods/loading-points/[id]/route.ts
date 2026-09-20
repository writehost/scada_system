import { NextResponse } from "next/server"
import { readFgKaraFleet, upsertLoadingPoint, writeFgKaraFleet } from "@/lib/wms/fg-kara-fleet"
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
    const existing = fleet.loadingPoints.find((p) => p.id === params.id)
    if (!existing) return NextResponse.json({ error: "точка погрузки не найдена" }, { status: 404 })
    const { snapshot, point } = upsertLoadingPoint(fleet, { ...existing, ...body, id: params.id })
    const saved = await writeFgKaraFleet(siteId, snapshot)
    return NextResponse.json({ point, fleet: saved })
  })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const params = await Promise.resolve(ctx.params)
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    if (!fleet.loadingPoints.some((p) => p.id === params.id)) {
      return NextResponse.json({ error: "точка погрузки не найдена" }, { status: 404 })
    }
    const saved = await writeFgKaraFleet(siteId, {
      ...fleet,
      loadingPoints: fleet.loadingPoints.filter((p) => p.id !== params.id),
    })
    return NextResponse.json({ ok: true, fleet: saved })
  })
}
