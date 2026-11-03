import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"

/**
 * Позиция погрузчика. Источник истины — сервис позиционирования (AprilTag) или явно ручная позиция.
 * Состояния для экрана:
 *   ok        — свежее достоверное измерение;
 *   degraded  — метка потеряна недавно или идёт прогноз по одометрии: показываем последнюю
 *               достоверную точку со сниженной уверенностью;
 *   lost      — «Позиция не определена»;
 *   manual    — задана оператором вручную (этап 2 ТЗ), обозначается явно.
 */

export type PositionState = "ok" | "degraded" | "lost" | "manual" | "none"

export type ForkliftPosition = {
  karaId: string
  x: number
  y: number
  z: number | null
  headingDeg: number | null
  quality: number
  source: string
  tagIds: number[]
  reprojErrorPx: number | null
  measuredAt: string
  receivedAt: string
  setBy: string | null
  state: PositionState
  ageS: number
  label: string
}

export const POSITION_LIMITS = {
  okMaxAgeS: Number(process.env.ROUTE_POS_OK_AGE_S || 2),
  degradedMaxAgeS: Number(process.env.ROUTE_POS_DEGRADED_AGE_S || 10),
  minQualityOk: 0.5,
  maxSpeedMs: 4.5, // ~16 км/ч, выше — скачок
}

export function positionState(
  p: { source: string; quality: number; measuredAt: string; stateHint?: string | null },
  now = Date.now()
): { state: PositionState; ageS: number } {
  const ageS = Math.max(0, (now - Date.parse(p.measuredAt)) / 1000)
  if (p.source === "manual") return { state: "manual", ageS }
  if (p.stateHint === "lost") return { state: "lost", ageS }
  if (ageS > POSITION_LIMITS.degradedMaxAgeS) return { state: "lost", ageS }
  if (p.stateHint === "predicted" || p.source === "odometry") return { state: "degraded", ageS }
  if (ageS <= POSITION_LIMITS.okMaxAgeS && p.quality >= POSITION_LIMITS.minQualityOk) return { state: "ok", ageS }
  return { state: "degraded", ageS }
}

export const STATE_LABEL: Record<PositionState, string> = {
  ok: "Позиция по меткам",
  degraded: "Позиция неточная",
  lost: "Позиция не определена",
  manual: "Ручная позиция",
  none: "Позиция не определена",
}

type Row = {
  kara_id: string
  x: string
  y: string
  z: string | null
  heading_deg: string | null
  quality: string
  source: string
  tag_ids: number[]
  reproj_error_px: string | null
  measured_at: string
  received_at: string
  set_by: string | null
}

function mapRow(r: Row, now = Date.now()): ForkliftPosition {
  const hint = r.source === "apriltag" && Number(r.quality) === 0 ? "lost" : null
  const st = positionState({ source: r.source, quality: Number(r.quality), measuredAt: r.measured_at, stateHint: hint }, now)
  return {
    karaId: r.kara_id,
    x: Number(r.x),
    y: Number(r.y),
    z: r.z != null ? Number(r.z) : null,
    headingDeg: r.heading_deg != null ? Number(r.heading_deg) : null,
    quality: Number(r.quality),
    source: r.source,
    tagIds: r.tag_ids ?? [],
    reprojErrorPx: r.reproj_error_px != null ? Number(r.reproj_error_px) : null,
    measuredAt: r.measured_at,
    receivedAt: r.received_at,
    setBy: r.set_by,
    state: st.state,
    ageS: Math.round(st.ageS * 10) / 10,
    label: STATE_LABEL[st.state],
  }
}

const SELECT = `SELECT kara_id, x::text, y::text, z::text, heading_deg::text, quality::text, source, tag_ids,
  reproj_error_px::text, to_char(measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS measured_at,
  received_at::text, set_by FROM route_positions`

export async function getPosition(client: PoolClient, siteId: number, karaId: string): Promise<ForkliftPosition | null> {
  const r = await client.query<Row>(`${SELECT} WHERE site_id = $1 AND kara_id = $2`, [siteId, karaId])
  return r.rows[0] ? mapRow(r.rows[0]) : null
}

export async function listPositions(client: PoolClient, siteId: number): Promise<ForkliftPosition[]> {
  const r = await client.query<Row>(`${SELECT} WHERE site_id = $1`, [siteId])
  return r.rows.map((row) => mapRow(row))
}

export type PositionInput = {
  karaId: string
  x: number
  y: number
  z?: number | null
  headingDeg?: number | null
  quality: number
  tagIds?: number[]
  reprojErrorPx?: number | null
  measuredAt: string
  source: "apriltag" | "odometry" | "manual"
  state?: "ok" | "predicted" | "lost"
  setBy?: string | null
}

export type IngestResult =
  | { accepted: true; position: ForkliftPosition; lostEvent: boolean }
  | { accepted: false; reason: string; code: string }

/**
 * Приём измерения. Отбрасываем: старые (не по порядку), из будущего, физически невозможные скачки.
 * Сообщение state=lost не двигает точку — меняется только достоверность.
 */
export async function ingestPosition(
  client: PoolClient,
  siteId: number,
  input: PositionInput,
  metersPerUnit: number,
  now = Date.now()
): Promise<IngestResult> {
  const t = Date.parse(input.measuredAt)
  if (!Number.isFinite(t)) throw new WmsHttpError(400, "measuredAt обязателен (ISO)", "bad_measured_at")
  if (t - now > 5000) return { accepted: false, code: "future", reason: "время измерения в будущем — проверьте часы устройства" }
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new WmsHttpError(400, "x, y обязательны", "bad_xy")
  const quality = Math.max(0, Math.min(1, Number(input.quality) || 0))

  const prevR = await client.query<Row>(`${SELECT} WHERE site_id = $1 AND kara_id = $2 FOR UPDATE`, [siteId, input.karaId])
  const prev = prevR.rows[0] ? mapRow(prevR.rows[0], now) : null
  if (prev && Date.parse(prev.measuredAt) >= t && input.source !== "manual") {
    return { accepted: false, code: "stale", reason: "измерение старше уже принятого" }
  }

  let x = input.x
  let y = input.y
  let q = quality
  let lostEvent = false
  if (input.state === "lost") {
    if (prev) {
      x = prev.x
      y = prev.y
    }
    q = 0
    lostEvent = !prev || prev.state !== "lost"
  } else if (prev && input.source !== "manual" && (prev.state === "ok" || prev.state === "degraded")) {
    const dt = Math.max(0.05, (t - Date.parse(prev.measuredAt)) / 1000)
    const distM = Math.hypot(x - prev.x, y - prev.y) * metersPerUnit
    if (distM > POSITION_LIMITS.maxSpeedMs * dt * 1.5 + 1.0) {
      await client.query(
        `INSERT INTO route_position_log (site_id, kara_id, x, y, heading_deg, quality, source, state, measured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'rejected_jump',$8)`,
        [siteId, input.karaId, x, y, input.headingDeg ?? null, quality, input.source, input.measuredAt]
      )
      return { accepted: false, code: "jump", reason: `скачок ${distM.toFixed(1)} м за ${dt.toFixed(2)} с отброшен` }
    }
  }

  await client.query(
    `INSERT INTO route_positions (site_id, kara_id, x, y, z, heading_deg, quality, source, tag_ids, reproj_error_px, measured_at, received_at, set_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::int[],$10,$11, now(), $12)
     ON CONFLICT (site_id, kara_id) DO UPDATE SET
       x = EXCLUDED.x, y = EXCLUDED.y, z = EXCLUDED.z,
       heading_deg = COALESCE(EXCLUDED.heading_deg, route_positions.heading_deg),
       quality = EXCLUDED.quality, source = EXCLUDED.source, tag_ids = EXCLUDED.tag_ids,
       reproj_error_px = EXCLUDED.reproj_error_px, measured_at = EXCLUDED.measured_at,
       received_at = now(), set_by = EXCLUDED.set_by`,
    [
      siteId,
      input.karaId,
      x,
      y,
      input.z ?? null,
      input.headingDeg ?? null,
      q,
      input.source,
      (input.tagIds ?? []).filter((n) => Number.isInteger(n)),
      input.reprojErrorPx ?? null,
      input.measuredAt,
      input.setBy ?? null,
    ]
  )
  // журнал не чаще раза в секунду на погрузчик
  await client.query(
    `INSERT INTO route_position_log (site_id, kara_id, x, y, heading_deg, quality, source, state, measured_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
     WHERE NOT EXISTS (
       SELECT 1 FROM route_position_log
       WHERE site_id = $1 AND kara_id = $2 AND created_at > now() - interval '1 second' AND state = $8
     )`,
    [siteId, input.karaId, x, y, input.headingDeg ?? null, q, input.source, input.state ?? "ok", input.measuredAt]
  )
  const cur = await getPosition(client, siteId, input.karaId)
  return { accepted: true, position: cur!, lostEvent }
}
