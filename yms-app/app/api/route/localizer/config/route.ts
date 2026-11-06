import { fail, withRoute } from "@/lib/route/http"
import { activeCalibrationFor, listMarkers } from "@/lib/route/apriltags"
import { getPublishedMap } from "@/lib/route/maps"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Конфигурация для сервиса позиционирования: активные метки, калибровка камеры, система координат. */
export async function GET(req: Request) {
  return withRoute(req, null, async (ctx) => {
    if (ctx.actor.kind !== "device" || ctx.actor.deviceKind !== "localizer") fail(403, "только для сервиса позиционирования", "device_required")
    const map = await getPublishedMap(ctx.client, ctx.siteId)
    const markers = (await listMarkers(ctx.client, ctx.siteId)).filter((m) => m.active)
    const serial = ctx.url.searchParams.get("cameraSerial") || ""
    return {
      karaId: ctx.actor.karaId,
      coord: map?.geometry.coord ?? null,
      markers,
      calibration: serial ? await activeCalibrationFor(ctx.client, ctx.siteId, serial) : null,
      limits: { maxReprojErrorPx: 2.0, lostAfterS: 10 },
    }
  })
}
