export const QPASS_DEFAULT_ORIGIN = "https://qpass.scada25.ru"

export type QpassLink = {
  publicId: string
  url: string
  title: string | null
  inventoryCode: string | null
  serial: string | null
  orgName: string | null
  qrImageUrl?: string | null
}

export function qpassOrigin(): string {
  const raw = (process.env.QPASS_ORIGIN || process.env.NEXT_PUBLIC_QPASS_ORIGIN || "").trim()
  if (!raw) return QPASS_DEFAULT_ORIGIN
  return raw.replace(/\/+$/, "")
}

export function parseQpassPublicId(raw: string): string | null {
  const text = (raw || "").trim()
  if (!text) return null
  const fromUrl = text.match(/\/e\/([A-Za-z0-9_-]{4,80})(?:[/?#]|$)/i)
  if (fromUrl?.[1]) return fromUrl[1]
  const bare = text.match(/^(q_[A-Za-z0-9_-]{4,80})$/i)
  if (bare?.[1]) return bare[1]
  if (/^[A-Za-z0-9_-]{6,80}$/.test(text) && !text.includes(" ")) return text
  return null
}

export function qpassPublicUrl(publicId: string, origin = qpassOrigin()): string {
  return `${origin.replace(/\/+$/, "")}/e/${encodeURIComponent(publicId)}`
}

export function qpassQrImageUrl(publicId: string, origin = qpassOrigin(), size = 512): string {
  const id = encodeURIComponent(publicId)
  return `${origin.replace(/\/+$/, "")}/api/qr/${id}?format=png&size=${size}`
}

export function exactQpassText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function readQpassLinkFromAttrs(attrs: unknown): QpassLink | null {
  if (!attrs || typeof attrs !== "object") return null
  const raw = (attrs as Record<string, unknown>).qpass
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const publicId = typeof o.publicId === "string" ? o.publicId.trim() : ""
  if (!publicId) return null
  return {
    publicId,
    url: typeof o.url === "string" && o.url.trim() ? o.url.trim() : qpassPublicUrl(publicId),
    title: typeof o.title === "string" && o.title.trim() ? o.title.trim() : null,
    inventoryCode:
      typeof o.inventoryCode === "string" && o.inventoryCode.trim() ? o.inventoryCode.trim() : null,
    serial: typeof o.serial === "string" && o.serial.trim() ? o.serial.trim() : null,
    orgName: typeof o.orgName === "string" && o.orgName.trim() ? o.orgName.trim() : null,
    qrImageUrl:
      typeof o.qrImageUrl === "string" && o.qrImageUrl.trim()
        ? o.qrImageUrl.trim()
        : qpassQrImageUrl(publicId),
  }
}

export function readEquipmentSerialFromAttrs(attrs: unknown): string {
  if (!attrs || typeof attrs !== "object") return ""
  const root = attrs as Record<string, unknown>
  const top = exactQpassText(root.equipmentSerial)
  if (top) return top
  const nom = root.nomenclature
  if (nom && typeof nom === "object") {
    const fromNom = exactQpassText((nom as Record<string, unknown>).equipmentSerial)
    if (fromNom) return fromNom
  }
  const linked = readQpassLinkFromAttrs(attrs)
  return exactQpassText(linked?.serial)
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

/**
 * Паспорт живёт во внешней системе: страница карточки не должна ждать её
 * дольше нескольких секунд, а данные меняются редко — держим короткий кэш и
 * склеиваем одновременные запросы.
 */
const QPASS_TTL_MS = 5 * 60 * 1000
const QPASS_TIMEOUT_MS = 5000
const qpassCache = new Map<string, { at: number; value: QpassLink | null }>()
const qpassInFlight = new Map<string, Promise<QpassLink | null>>()

export async function fetchQpassPublic(
  publicId: string,
  origin = qpassOrigin(),
  options?: { fresh?: boolean }
): Promise<QpassLink | null> {
  const parsed = parseQpassPublicId(publicId)
  if (!parsed) return null
  const cacheKey = `${origin}::${parsed}`

  if (options?.fresh) qpassCache.delete(cacheKey)
  const cached = qpassCache.get(cacheKey)
  if (cached && Date.now() - cached.at < QPASS_TTL_MS) return cached.value

  const running = qpassInFlight.get(cacheKey)
  if (running) return running

  const task = loadQpassPublic(parsed, origin)
    .then((value) => {
      qpassCache.set(cacheKey, { at: Date.now(), value })
      return value
    })
    .finally(() => {
      qpassInFlight.delete(cacheKey)
    })
  qpassInFlight.set(cacheKey, task)
  return task
}

async function loadQpassPublic(id: string, origin: string): Promise<QpassLink | null> {
  const url = qpassPublicUrl(id, origin)
  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/html" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(QPASS_TIMEOUT_MS),
  }).catch(() => null)
  if (!resp || !resp.ok) return null
  const html = await resp.text()
  if (/This page could not be found/i.test(html) && !html.includes(`>${id}<`) && !html.includes(id)) {
    return null
  }
  const title =
    decodeHtml((html.match(/<h1[^>]*>([^<]{2,160})<\/h1>/i)?.[1] || "").trim()) || null
  const inventoryCode = html.match(/\bEQ-\d{3,}\b/)?.[0] ?? null
  const serial =
    decodeHtml(
      (html.match(/Серийный<\/dt>\s*<dd[^>]*>([^<]{2,80})<\/dd>/i)?.[1] || "").trim()
    ) || null
  const orgName =
    decodeHtml(
      (html.match(/<p class="mt-3 text-sm text-primary-foreground\/80">([^<]{2,160})<\/p>/)?.[1] ||
        "").trim()
    ) || null
  if (!title && !html.includes(id)) return null
  return {
    publicId: id,
    url,
    title,
    inventoryCode,
    serial,
    orgName,
    qrImageUrl: qpassQrImageUrl(id, origin),
  }
}

export function qpassToAttrsValue(link: QpassLink): Record<string, unknown> {
  return {
    publicId: link.publicId,
    url: link.url,
    title: link.title,
    inventoryCode: link.inventoryCode,
    serial: link.serial,
    orgName: link.orgName,
    qrImageUrl: link.qrImageUrl || qpassQrImageUrl(link.publicId),
    linkedAt: new Date().toISOString(),
  }
}
