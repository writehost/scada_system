import { NextResponse } from "next/server"
import { readFgKaraFleet, upsertRoute, writeFgKaraFleet } from "@/lib/wms/fg-kara-fleet"
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
    const existing = fleet.routes.find((r) => r.id === params.id)
    if (!existing) return NextResponse.json({ error: "маршрут не найден" }, { status: 404 })
    const { snapshot, route } = upsertRoute(fleet, { ...existing, ...body, id: params.id })
    const saved = await writeFgKaraFleet(siteId, {
      ...snapshot,
      karas: snapshot.karas.map((k) => k),
    })
    return NextResponse.json({ route, fleet: saved })
  })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const params = await Promise.resolve(ctx.params)
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    if (!fleet.routes.some((r) => r.id === params.id)) {
      return NextResponse.json({ error: "маршрут не найден" }, { status: 404 })
    }
    const saved = await writeFgKaraFleet(siteId, {
      ...fleet,
      routes: fleet.routes.filter((r) => r.id !== params.id),
      karas: fleet.karas.map((k) => ({ ...k, routeIds: k.routeIds.filter((id) => id !== params.id) })),
    })
    return NextResponse.json({ ok: true, fleet: saved })
  })
}
