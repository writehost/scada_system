import { publish } from "@/lib/route/events"
import { fail, withRouteTx } from "@/lib/route/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Состояние сервиса позиционирования: камера, видимые метки, версия калибровки, проверена ли точность. */
export async function POST(req: Request) {
  return withRouteTx(req, null, async (ctx) => {
    const a = ctx.actor
    if (a.kind !== "device" || a.deviceKind !== "localizer") fail(403, "только для сервиса позиционирования", "device_required")
    const b = ctx.body
    const status = {
      source: String(b.source ?? "").slice(0, 40),
      camera: String(b.camera ?? "unknown").slice(0, 20),
      cameraError: b.cameraError ? String(b.cameraError).slice(0, 300) : null,
      frames: Number(b.frames) || 0,
      framesMissing: Number(b.framesMissing) || 0,
      captureFps: Number.isFinite(Number(b.captureFps)) ? Number(b.captureFps) : null,
      lastFrameAt: Number.isFinite(Number(b.lastFrameAt)) ? Number(b.lastFrameAt) : null,
      lastFixAt: Number.isFinite(Number(b.lastFixAt)) ? Number(b.lastFixAt) : null,
      visibleTags: Array.isArray(b.visibleTags) ? (b.visibleTags as unknown[]).slice(0, 50).map((x) => String(x).slice(0, 30)) : [],
      usedTags: Array.isArray(b.usedTags) ? (b.usedTags as unknown[]).slice(0, 50).map(Number).filter(Number.isInteger) : [],
      positionState: String(b.positionState ?? "").slice(0, 20),
      calibration:
        b.calibration && typeof b.calibration === "object"
          ? {
              version: String((b.calibration as Record<string, unknown>).version ?? "").slice(0, 40) || null,
              rmsPx: Number((b.calibration as Record<string, unknown>).rmsPx) || null,
              accuracyChecked: (b.calibration as Record<string, unknown>).accuracyChecked === true,
              note: String((b.calibration as Record<string, unknown>).note ?? "").slice(0, 200) || null,
            }
          : null,
    }
    const prev = await ctx.client.query<{ camera: string | null }>(
      `SELECT status->>'camera' AS camera FROM route_devices WHERE site_id = $1 AND device_id = $2`,
      [ctx.siteId, a.deviceId]
    )
    await ctx.client.query(`UPDATE route_devices SET status = $3::jsonb, status_at = now(), last_seen_at = now() WHERE site_id = $1 AND device_id = $2`, [
      ctx.siteId,
      a.deviceId,
      JSON.stringify(status),
    ])
    if (prev.rows[0]?.camera !== status.camera) {
      await publish(ctx.client, ctx.siteId, "localizer.status", { karaId: a.karaId, payload: { camera: status.camera, error: status.cameraError } })
    }
    return { ok: true }
  })
}
