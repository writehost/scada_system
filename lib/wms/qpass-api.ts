import { tryGetPool } from "@/lib/wms/pool"
import {
  exactQpassText,
  qpassOrigin,
  qpassPublicUrl,
  qpassQrImageUrl,
  type QpassLink,
} from "@/lib/wms/qpass"

export type QpassEnsureResult = {
  created: boolean
  pass: QpassLink
}

type QpassRuntime = { origin: string; token: string; ensureUrl: string }

async function qpassRuntime(): Promise<QpassRuntime> {
  const fallback: QpassRuntime = {
    origin: qpassOrigin(),
    token: (process.env.QPASS_API_TOKEN || "").trim(),
    ensureUrl: (process.env.QPASS_ENSURE_URL || "").trim(),
  }
  const pool = tryGetPool()
  if (!pool) return fallback
  try {
    const client = await pool.connect()
    try {
      const r = await client.query<{ setting_value: unknown }>(
        `SELECT setting_value FROM wms_app_settings WHERE setting_key = $1 LIMIT 1`,
        ["integration_qpass"]
      )
      const v = (r.rows[0]?.setting_value || {}) as Record<string, unknown>
      const origin =
        typeof v.origin === "string" && v.origin.trim() ? v.origin.trim() : fallback.origin
      const token = typeof v.token === "string" && v.token.trim() ? v.token.trim() : fallback.token
      const ensureUrl =
        typeof v.ensureUrl === "string" && v.ensureUrl.trim() ? v.ensureUrl.trim() : fallback.ensureUrl
      return { origin, token, ensureUrl }
    } finally {
      client.release()
    }
  } catch {
    return fallback
  }
}

function ensureUrlFrom(cfg: QpassRuntime): string {
  if (cfg.ensureUrl) return cfg.ensureUrl.replace(/\/+$/, "")
  return `${cfg.origin.replace(/\/+$/, "")}/api/v1/equipment/ensure`
}

function asPass(data: Record<string, unknown>): QpassLink | null {
  const publicId = exactQpassText(data.qrId ?? data.publicId)
  if (!publicId) return null
  const serial = exactQpassText(data.serialNumber ?? data.serial)
  return {
    publicId,
    url: exactQpassText(data.url) || qpassPublicUrl(publicId),
    title: exactQpassText(data.name ?? data.title) || null,
    inventoryCode: exactQpassText(data.internalId ?? data.inventoryCode) || null,
    serial: serial || null,
    orgName: exactQpassText(data.orgName) || null,
    qrImageUrl: exactQpassText(data.qrImageUrl) || qpassQrImageUrl(publicId),
  }
}

async function qpassEnsureRequest(
  method: "GET" | "POST",
  name: string,
  serial: string
): Promise<QpassEnsureResult> {
  const exactName = exactQpassText(name)
  const exactSerial = exactQpassText(serial)
  if (!exactName || !exactSerial) {
    throw new Error("нужны точное название и серийный номер")
  }
  const cfg = await qpassRuntime()
  const token = cfg.token
  if (!token) {
    throw new Error("QPass API token не задан — Настройки → Интеграции → QPass")
  }
  const url = new URL(ensureUrlFrom(cfg))
  if (method === "GET") {
    url.searchParams.set("name", exactName)
    url.searchParams.set("serialNumber", exactSerial)
  }
  const resp = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify({ name: exactName, serialNumber: exactSerial }) : undefined,
    cache: "no-store",
  })
  const raw = (await resp.json().catch(() => null)) as Record<string, unknown> | null
  if (!resp.ok) {
    const message = exactQpassText(raw?.error) || `QPass ${resp.status}`
    throw new Error(message)
  }
  const data = (raw?.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown> | null
  const pass = data ? asPass(data) : null
  if (!pass) {
    throw new Error("QPass не вернул паспорт")
  }
  return { created: raw?.created === true, pass }
}

export async function findQpassPassport(name: string, serial: string): Promise<QpassLink | null> {
  try {
    const row = await qpassEnsureRequest("GET", name, serial)
    return row.pass
  } catch {
    return null
  }
}

export async function ensureQpassPassport(name: string, serial: string): Promise<QpassEnsureResult> {
  return qpassEnsureRequest("POST", name, serial)
}
