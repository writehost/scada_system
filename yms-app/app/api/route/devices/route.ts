import { randomBytes } from "node:crypto"
import { actorLabel, hashDeviceToken, ROUTE_DEVICE_TOKEN_PREFIX } from "@/lib/route/auth"
import { getForklift } from "@/lib/route/fleet"
import { fail, str, withRoute, withRouteTx } from "@/lib/route/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRoute(req, "route.map.write", async (ctx) => {
    const r = await ctx.client.query(
      `SELECT device_id AS "deviceId", kara_id AS "karaId", kind, label, created_by AS "createdBy",
              created_at::text AS "createdAt", last_seen_at::text AS "lastSeenAt", revoked_at::text AS "revokedAt"
       FROM route_devices WHERE site_id = $1 ORDER BY created_at DESC`,
      [ctx.siteId]
    )
    return { devices: r.rows }
  })
}

/** Выпуск токена устройства (сервис позиционирования погрузчика). Токен показывается один раз. */
export async function POST(req: Request) {
  return withRouteTx(req, "route.map.write", async (ctx) => {
    const karaId = str(ctx.body, "karaId", 64)
    const kind = str(ctx.body, "kind", 20) || "localizer"
    if (kind !== "localizer") fail(400, "kind: localizer", "bad_kind")
    if (!karaId || !(await getForklift(ctx.client, ctx.siteId, karaId))) fail(404, "погрузчик не найден во флоте WMS", "kara_not_found")
    const deviceId = str(ctx.body, "deviceId", 64) || `loc-${karaId}-${randomBytes(3).toString("hex")}`
    const token = `${ROUTE_DEVICE_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`
    await ctx.client.query(
      `INSERT INTO route_devices (device_id, site_id, kara_id, kind, token_hash, label, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (site_id, device_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, kara_id = EXCLUDED.kara_id,
         revoked_at = NULL, created_by = EXCLUDED.created_by, created_at = now()`,
      [deviceId, ctx.siteId, karaId, kind, hashDeviceToken(token), str(ctx.body, "label", 120) || null, actorLabel(ctx.actor)]
    )
    return { deviceId, karaId, token }
  })
}

export async function DELETE(req: Request) {
  return withRouteTx(req, "route.map.write", async (ctx) => {
    const deviceId = ctx.url.searchParams.get("deviceId") || ""
    const r = await ctx.client.query(`UPDATE route_devices SET revoked_at = now() WHERE site_id = $1 AND device_id = $2 AND revoked_at IS NULL`, [
      ctx.siteId,
      deviceId,
    ])
    if (!r.rowCount) fail(404, "устройство не найдено", "device_not_found")
    return { ok: true }
  })
}
