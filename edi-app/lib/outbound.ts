import { HttpError } from "./db.ts"

/** Only deployment-approved hosts may receive server requests and service credentials. */
export function assertOutboundUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new HttpError(400, "Некорректный адрес интеграции", "bad_url") }
  if (url.username || url.password || url.hash || !["https:", "http:"].includes(url.protocol)) {
    throw new HttpError(400, "Адрес интеграции должен быть HTTP(S), без пароля и фрагмента", "bad_url")
  }
  if (process.env.NODE_ENV === "production") {
    const allowed = (process.env.EDI_OUTBOUND_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)
    if (url.protocol !== "https:" || !allowed.includes(url.origin)) {
      throw new HttpError(400, "Адрес не разрешён администратором сервера (EDI_OUTBOUND_ORIGINS)", "outbound_forbidden")
    }
  }
  return url
}

export function integrationFetch(value: string, init?: RequestInit): Promise<Response> {
  return fetch(assertOutboundUrl(value), { ...init, redirect: "error" })
}
