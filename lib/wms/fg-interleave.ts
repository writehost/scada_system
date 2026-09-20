import { planRowDistanceKey } from "@/lib/wms/fsn"
import type { FleetSnapshot, KaraRoute, KaraStop, KaraUnit } from "@/lib/wms/fg-kara-fleet-storage"

export type InterleaveOffer = {
  karaId: string
  karaName: string
  fromTagId: number | null
  fromRowId: string | null
  fromLabel: string
  routeId: string
  routeName: string
  pickupTagId: number | null
  pickupRowId: string | null
  pickupLabel: string
  distance: number
  savedEmptyRun: boolean
  reason: string
}

const NEAR_TAG = 4

export function stopDistance(a: KaraStop, b: KaraStop): number {
  if (a.tagId && b.tagId) return Math.abs(a.tagId - b.tagId)
  if (a.rowId && b.rowId) {
    return Math.abs(planRowDistanceKey(a.rowId) - planRowDistanceKey(b.rowId)) / 200
  }
  return 99
}

export function firstPickup(route: KaraRoute): KaraStop | null {
  return route.stops.find((s) => s.kind === "pickup") ?? route.stops[0] ?? null
}

export function suggestInterleave(
  fleet: FleetSnapshot,
  kara: KaraUnit | null,
  at: KaraStop | null
): InterleaveOffer | null {
  if (!kara || !at) return null
  const allowed = new Set(kara.routeIds)
  const pool = fleet.routes.filter(
    (route) => route.enabled && (allowed.size === 0 || allowed.has(route.id))
  )
  const scored: InterleaveOffer[] = []
  for (const route of pool) {
    const pickup = firstPickup(route)
    if (!pickup) continue
    if (at.tagId && pickup.tagId && at.tagId === pickup.tagId && at.kind === "pickup") continue
    const distance = stopDistance(at, pickup)
    if (distance > NEAR_TAG) continue
    const fromLabel = at.label || (at.rowId ? at.rowId : `тег ${at.tagId}`)
    const pickupLabel = pickup.label || pickup.rowId || `тег ${pickup.tagId}`
    scored.push({
      karaId: kara.id,
      karaName: kara.name,
      fromTagId: at.tagId ?? null,
      fromRowId: at.rowId ?? null,
      fromLabel,
      routeId: route.id,
      routeName: route.name,
      pickupTagId: pickup.tagId ?? null,
      pickupRowId: pickup.rowId ?? null,
      pickupLabel,
      distance,
      savedEmptyRun: true,
      reason: `${kara.name} у ${fromLabel} — рядом забрать ${pickupLabel} (${route.name}). Пустой пробег не нужен.`,
    })
  }
  scored.sort((a, b) => a.distance - b.distance || a.routeName.localeCompare(b.routeName, "ru"))
  return scored[0] ?? null
}
