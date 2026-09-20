import { NextResponse } from "next/server"
import {
  readFgKaraFleet,
  removeDriver,
  upsertDriver,
  writeFgKaraFleet,
} from "@/lib/wms/fg-kara-fleet-storage"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return actorGate.error

  const params = await Promise.resolve(ctx.params)
  return withFleetSite(req, async (_client, siteId, body) => {
    try {
      const fleet = await readFgKaraFleet(siteId)
      const existing = fleet.drivers.find((d) => d.id === params.id)
      if (!existing) return NextResponse.json({ error: "карщик не найден" }, { status: 404 })
      const { snapshot, driver } = upsertDriver(fleet, { ...existing, ...body, id: params.id })
      const saved = await writeFgKaraFleet(siteId, snapshot)
      return NextResponse.json({ driver, fleet: saved })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "не удалось обновить карщика" },
        { status: 400 }
      )
    }
  })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return actorGate.error

  const params = await Promise.resolve(ctx.params)
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    if (!fleet.drivers.some((d) => d.id === params.id)) {
      return NextResponse.json({ error: "карщик не найден" }, { status: 404 })
    }
    const saved = await writeFgKaraFleet(siteId, removeDriver(fleet, params.id))
    return NextResponse.json({ ok: true, fleet: saved })
  })
}
