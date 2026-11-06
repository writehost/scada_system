import { readFile } from "node:fs/promises"
import path from "node:path"
import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"

/**
 * Реестр меток AprilTag для позиционирования и версии калибровки камер.
 *
 * Ёмкость семейств (уникальных ID):
 *   tag16h5 — 30 (тестовое, для склада не годится: много ложных срабатываний),
 *   tag25h9 — 35, tag36h10 — 2320, tag36h11 — 587,
 *   tagStandard41h12 — 2115, tagStandard52h13 — 48714.
 * WMS сейчас печатает tag36h11 (≤587 меток на площадку). Для тысяч меток — tagStandard41h12/52h13
 * (поддерживаются детектором pupil-apriltags) или tag36h10 (OpenCV).
 */
export const FAMILY_CAPACITY: Record<string, number> = {
  tag16h5: 30,
  tag25h9: 35,
  tag36h10: 2320,
  tag36h11: 587,
  tagStandard41h12: 2115,
  tagStandard52h13: 48714,
}

export type Marker = {
  family: string
  tagId: number
  zone: string | null
  objectCode: string | null
  x: number
  y: number
  zM: number
  yawDeg: number
  pitchDeg: number
  rollDeg: number
  sizeM: number
  mountHeightM: number | null
  /** ceiling — на потолке лицом вниз (yawDeg — ось +x метки); wall — на стене/стойке (yawDeg — куда смотрит метка) */
  mount: "ceiling" | "wall"
  /** Версия привязки: растёт при каждом изменении координат/ориентации метки */
  bindingVersion: number
  active: boolean
  calibratedAt: string | null
  note: string | null
}

export async function listMarkers(client: PoolClient, siteId: number): Promise<Marker[]> {
  const r = await client.query<Marker>(
    `SELECT family, tag_id AS "tagId", zone, object_code AS "objectCode", x::float AS x, y::float AS y, z_m::float AS "zM",
            yaw_deg::float AS "yawDeg", pitch_deg::float AS "pitchDeg", roll_deg::float AS "rollDeg", size_m::float AS "sizeM",
            mount_height_m::float AS "mountHeightM", mount, binding_version AS "bindingVersion", active,
            calibrated_at::text AS "calibratedAt", note
     FROM route_apriltag_markers WHERE site_id = $1 ORDER BY family, tag_id`,
    [siteId]
  )
  return r.rows
}

function mountOf(v: unknown): "ceiling" | "wall" {
  if (v === undefined || v === null || v === "" || v === "ceiling") return "ceiling"
  if (v === "wall") return "wall"
  throw new WmsHttpError(400, "mount: ceiling или wall", "bad_mount")
}

export function validateMarker(raw: Record<string, unknown>): Marker {
  const family = String(raw.family || "").trim()
  if (!(family in FAMILY_CAPACITY)) throw new WmsHttpError(400, `неизвестное семейство ${family}`, "bad_family")
  const tagId = Number(raw.tagId)
  if (!Number.isInteger(tagId) || tagId < 0 || tagId >= FAMILY_CAPACITY[family]) {
    throw new WmsHttpError(400, `ID ${raw.tagId} вне диапазона семейства ${family} (0..${FAMILY_CAPACITY[family] - 1})`, "bad_tag_id")
  }
  const n = (k: string, def: number | null = null) => {
    const v = raw[k]
    if (v === null || v === undefined || v === "") return def
    const x = Number(v)
    if (!Number.isFinite(x)) throw new WmsHttpError(400, `${k}: число`, "bad_number")
    return x
  }
  const sizeM = n("sizeM")
  if (sizeM == null || sizeM <= 0.01 || sizeM > 2) throw new WmsHttpError(400, `метка ${family}:${tagId}: размер sizeM 0.01–2 м обязателен`, "bad_size")
  return {
    family,
    tagId,
    zone: raw.zone ? String(raw.zone).slice(0, 40) : null,
    objectCode: raw.objectCode ? String(raw.objectCode).slice(0, 80) : null,
    x: n("x") ?? NaN,
    y: n("y") ?? NaN,
    zM: n("zM", 0)!,
    yawDeg: n("yawDeg", 0)!,
    pitchDeg: n("pitchDeg", 0)!,
    rollDeg: n("rollDeg", 0)!,
    sizeM,
    mountHeightM: n("mountHeightM"),
    mount: mountOf(raw.mount),
    bindingVersion: 1,
    active: raw.active !== false,
    calibratedAt: raw.calibratedAt ? String(raw.calibratedAt) : null,
    note: raw.note ? String(raw.note).slice(0, 240) : null,
  }
}

export async function upsertMarkers(client: PoolClient, siteId: number, list: unknown[], actor: string) {
  const warnings: string[] = []
  let saved = 0
  for (const item of list) {
    const m = validateMarker((item ?? {}) as Record<string, unknown>)
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) throw new WmsHttpError(400, `метка ${m.tagId}: нет координат`, "bad_xy")
    if (m.family === "tag16h5") warnings.push(`метка ${m.tagId}: tag16h5 — тестовое семейство, для склада нужен обоснованный выбор`)
    await client.query(
      `INSERT INTO route_apriltag_markers (site_id, family, tag_id, zone, object_code, x, y, z_m, yaw_deg, pitch_deg, roll_deg, size_m,
         mount_height_m, active, calibrated_at, note, updated_by, mount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16,$17,$18)
       ON CONFLICT (site_id, family, tag_id) DO UPDATE SET zone = EXCLUDED.zone, object_code = EXCLUDED.object_code,
         x = EXCLUDED.x, y = EXCLUDED.y, z_m = EXCLUDED.z_m, yaw_deg = EXCLUDED.yaw_deg, pitch_deg = EXCLUDED.pitch_deg,
         roll_deg = EXCLUDED.roll_deg, size_m = EXCLUDED.size_m, mount_height_m = EXCLUDED.mount_height_m,
         active = EXCLUDED.active, calibrated_at = EXCLUDED.calibrated_at, note = EXCLUDED.note, mount = EXCLUDED.mount,
         binding_version = route_apriltag_markers.binding_version
           + CASE WHEN (route_apriltag_markers.x, route_apriltag_markers.y, route_apriltag_markers.z_m, route_apriltag_markers.yaw_deg,
                        route_apriltag_markers.pitch_deg, route_apriltag_markers.roll_deg, route_apriltag_markers.size_m, route_apriltag_markers.mount)
                     IS DISTINCT FROM (EXCLUDED.x, EXCLUDED.y, EXCLUDED.z_m, EXCLUDED.yaw_deg, EXCLUDED.pitch_deg, EXCLUDED.roll_deg,
                        EXCLUDED.size_m, EXCLUDED.mount) THEN 1 ELSE 0 END,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [siteId, m.family, m.tagId, m.zone, m.objectCode, m.x, m.y, m.zM, m.yawDeg, m.pitchDeg, m.rollDeg, m.sizeM, m.mountHeightM, m.active, m.calibratedAt, m.note, actor, m.mount]
    )
    saved += 1
  }
  return { saved, warnings }
}

function wmsTagFiles(siteId: number): string[] {
  const out: string[] = []
  const shared = (process.env.WMS_SHARED_DIR || "").trim()
  if (shared) out.push(path.join(shared, "uploads", "fg-plan-apriltags", `site-${siteId}.json`))
  out.push(`/opt/scadatable-wms/shared/uploads/fg-plan-apriltags/site-${siteId}.json`)
  return out
}

/**
 * Импорт с плана WMS: координаты и ID. Размер в плане WMS не хранится — ставим 0,2 м
 * (как в toPhoneAprilTagMap WMS) и помечаем «проверить», высоту оставляем пустой.
 */
export async function importWmsPlanTags(client: PoolClient, siteId: number, actor: string) {
  for (const f of wmsTagFiles(siteId)) {
    let parsed: { family?: string; tags?: Array<{ tagId: number; x: number; y: number; label?: string; coverage?: { rows?: string[] } }> }
    try {
      parsed = JSON.parse(await readFile(f, "utf8"))
    } catch {
      continue
    }
    const family = parsed.family || "tag36h11"
    const tags = Array.isArray(parsed.tags) ? parsed.tags : []
    const list = tags.map((t) => ({
      family,
      tagId: t.tagId,
      x: t.x,
      y: t.y,
      sizeM: 0.2,
      zone: t.coverage?.rows?.[0]?.split("-")[0] ?? null,
      objectCode: t.label ?? null,
      note: "импорт с плана WMS: проверить размер, высоту и ориентацию",
    }))
    const res = await upsertMarkers(client, siteId, list, actor)
    return { imported: res.saved, source: f, warnings: res.warnings }
  }
  return { imported: 0, source: null, warnings: ["файл меток плана WMS не найден"] }
}

export type Calibration = {
  calibrationId: string
  karaId: string | null
  cameraSerial: string
  lens: string
  width: number
  height: number
  version: number
  cameraMatrix: number[][]
  distCoeffs: number[]
  rmsPx: number | null
  cameraToForklift: Record<string, unknown>
  active: boolean
  createdBy: string | null
  createdAt: string
}

const CAL_COLS = `calibration_id::text AS "calibrationId", kara_id AS "karaId", camera_serial AS "cameraSerial", lens, width, height,
  version, camera_matrix AS "cameraMatrix", dist_coeffs AS "distCoeffs", rms_px::float AS "rmsPx",
  camera_to_forklift AS "cameraToForklift", active, created_by AS "createdBy", created_at::text AS "createdAt"`

export async function listCalibrations(client: PoolClient, siteId: number): Promise<Calibration[]> {
  const r = await client.query<Calibration>(`SELECT ${CAL_COLS} FROM route_camera_calibrations WHERE site_id = $1 ORDER BY camera_serial, version DESC`, [siteId])
  return r.rows
}

export async function activeCalibrationFor(client: PoolClient, siteId: number, cameraSerial: string): Promise<Calibration | null> {
  const r = await client.query<Calibration>(
    `SELECT ${CAL_COLS} FROM route_camera_calibrations WHERE site_id = $1 AND camera_serial = $2 AND active ORDER BY version DESC LIMIT 1`,
    [siteId, cameraSerial]
  )
  return r.rows[0] ?? null
}

export async function saveCalibration(client: PoolClient, siteId: number, body: Record<string, unknown>, actor: string): Promise<Calibration> {
  const serial = String(body.cameraSerial || "").trim()
  const lens = String(body.lens || "").trim()
  const width = Number(body.width)
  const height = Number(body.height)
  const K = body.cameraMatrix as number[][]
  const D = body.distCoeffs as number[]
  const ext = body.cameraToForklift as Record<string, unknown>
  if (!serial || !lens) throw new WmsHttpError(400, "cameraSerial и lens обязательны", "fields_required")
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64) throw new WmsHttpError(400, "width/height", "bad_resolution")
  if (!Array.isArray(K) || K.length !== 3 || K.some((row) => !Array.isArray(row) || row.length !== 3 || row.some((v) => !Number.isFinite(Number(v))))) {
    throw new WmsHttpError(400, "cameraMatrix 3×3", "bad_matrix")
  }
  if (!Array.isArray(D) || D.length < 4 || D.some((v) => !Number.isFinite(Number(v)))) throw new WmsHttpError(400, "distCoeffs ≥ 4 чисел", "bad_dist")
  if (!ext || typeof ext !== "object") throw new WmsHttpError(400, "cameraToForklift: положение камеры относительно корпуса", "bad_extrinsics")
  const v = await client.query<{ v: number }>(
    `SELECT COALESCE(max(version), 0) + 1 AS v FROM route_camera_calibrations WHERE site_id = $1 AND camera_serial = $2 AND lens = $3 AND width = $4 AND height = $5`,
    [siteId, serial, lens, width, height]
  )
  await client.query(
    `UPDATE route_camera_calibrations SET active = FALSE WHERE site_id = $1 AND camera_serial = $2 AND lens = $3 AND width = $4 AND height = $5`,
    [siteId, serial, lens, width, height]
  )
  const r = await client.query<{ id: string }>(
    `INSERT INTO route_camera_calibrations (site_id, kara_id, camera_serial, lens, width, height, version, camera_matrix, dist_coeffs, rms_px, camera_to_forklift, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12) RETURNING calibration_id::text AS id`,
    [siteId, body.karaId ? String(body.karaId) : null, serial, lens, width, height, v.rows[0].v, JSON.stringify(K), JSON.stringify(D), body.rmsPx ?? null, JSON.stringify(ext), actor]
  )
  const out = await client.query<Calibration>(`SELECT ${CAL_COLS} FROM route_camera_calibrations WHERE calibration_id = $1::bigint`, [r.rows[0].id])
  return out.rows[0]
}
