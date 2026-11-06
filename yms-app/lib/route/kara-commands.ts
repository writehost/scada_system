/**
 * Адаптер к API живых кар на плане ГП (коллекция Postman «Кара ГП»):
 *   GET  {WMS}/api/wms/warehouse/finished-goods/kara-commands?siteCode=…   — каталог karas / tags (rows) / items
 *   POST {WMS}/api/wms/warehouse/finished-goods/kara-commands                — command: goto | pickup | place
 *
 * Аудит (6 ноября 2026): реализации kara-commands нет в репозитории writehost/scada_system ни в одной ветке —
 * эндпоинт есть только на production. Ближайший код в репозитории — флот кар (lib/wms/fg-kara-fleet*), где миссии
 * кар хранятся как JSON-снимок и не меняют складские остатки. Поэтому:
 *   • goto считаем командой виртуальной модели кары на плане — используем только в SIMULATION и только при
 *     ROUTE_KARA_GOTO_IN_SIMULATION=1;
 *   • pickup/place НЕ вызываются: не подтверждено, что они проверяют SSCC/права и не меняют остатки без скана.
 *     Складское перемещение в REAL выполняется только через проверенный путь /api/wms/route/move (после скана
 *     палеты и адреса, идемпотентно по requestId).
 *
 * Токен wmsu_… (Настройки → Профиль → Токены API) хранится только в переменной окружения сервера
 * WMS_KARA_API_TOKEN и в браузер не передаётся.
 */

export type KaraCatalog = {
  karas: { id: string; name: string | null; raw: Record<string, unknown> }[]
  tags: { tagId: number; rows: string[]; raw: Record<string, unknown> }[]
  items: { itemCode: string; raw: Record<string, unknown> }[]
}

export type KaraCallResult<T> = { ok: true; data: T; status: number } | { ok: false; kind: "not_configured" | "unavailable" | "rejected"; status: number | null; message: string }

export type KaraCommandsConfig = { baseUrl: string; token: string; timeoutMs: number; gotoInSimulation: boolean }

export function karaCommandsConfig(env: Record<string, string | undefined> = process.env): KaraCommandsConfig | null {
  const baseUrl = (env.WMS_KARA_API_URL || env.WMS_PUBLIC_URL || "").trim().replace(/\/+$/, "")
  const token = (env.WMS_KARA_API_TOKEN || "").trim()
  if (!baseUrl || !token) return null
  return { baseUrl, token, timeoutMs: Number(env.WMS_KARA_API_TIMEOUT_MS || 6000) || 6000, gotoInSimulation: env.ROUTE_KARA_GOTO_IN_SIMULATION === "1" }
}

const PATH = "/api/wms/warehouse/finished-goods/kara-commands"

type Fetch = typeof fetch

async function call<T>(cfg: KaraCommandsConfig | null, init: { method: "GET" | "POST"; query?: string; body?: unknown }, f: Fetch = fetch): Promise<KaraCallResult<T>> {
  if (!cfg) return { ok: false, kind: "not_configured", status: null, message: "WMS_KARA_API_URL / WMS_KARA_API_TOKEN не заданы на сервере" }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
  try {
    const res = await f(`${cfg.baseUrl}${PATH}${init.query ? `?${init.query}` : ""}`, {
      method: init.method,
      headers: { authorization: `Bearer ${cfg.token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text.slice(0, 300) }
    }
    if (!res.ok) {
      const msg = (data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "") || `HTTP ${res.status}`
      return { ok: false, kind: res.status >= 500 ? "unavailable" : "rejected", status: res.status, message: msg }
    }
    return { ok: true, data: data as T, status: res.status }
  } catch (e) {
    const aborted = (e as { name?: string }).name === "AbortError"
    return { ok: false, kind: "unavailable", status: null, message: aborted ? `WMS не ответила за ${cfg.timeoutMs} мс` : String((e as Error).message || e) }
  } finally {
    clearTimeout(timer)
  }
}

export function parseCatalog(data: unknown): KaraCatalog {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as Record<string, unknown>[]) : [])
  return {
    karas: arr("karas")
      .filter((k) => k && k.id != null)
      .map((k) => ({ id: String(k.id), name: k.name != null ? String(k.name) : null, raw: k })),
    tags: arr("tags")
      .filter((t) => t && Number.isInteger(Number(t.tagId)))
      .map((t) => ({ tagId: Number(t.tagId), rows: Array.isArray(t.rows) ? (t.rows as unknown[]).map(String) : [], raw: t })),
    items: arr("items")
      .filter((i) => i && i.itemCode != null)
      .map((i) => ({ itemCode: String(i.itemCode), raw: i })),
  }
}

export async function fetchKaraCatalog(siteCode: string, cfg = karaCommandsConfig(), f: Fetch = fetch): Promise<KaraCallResult<KaraCatalog>> {
  const r = await call<unknown>(cfg, { method: "GET", query: `siteCode=${encodeURIComponent(siteCode)}` }, f)
  return r.ok ? { ok: true, status: r.status, data: parseCatalog(r.data) } : r
}

/**
 * goto — переместить модель кары на плане к тегу. Только для SIMULATION (проверяет вызывающий код)
 * и только если явно включено ROUTE_KARA_GOTO_IN_SIMULATION=1.
 */
export async function karaGoto(
  siteCode: string,
  karaId: string,
  tagId: number,
  opts: { mode: "REAL" | "SIMULATION" },
  cfg = karaCommandsConfig(),
  f: Fetch = fetch
): Promise<KaraCallResult<unknown>> {
  if (opts.mode !== "SIMULATION") {
    return { ok: false, kind: "rejected", status: null, message: "goto вызывается только в режиме SIMULATION" }
  }
  if (cfg && !cfg.gotoInSimulation) {
    return { ok: false, kind: "not_configured", status: null, message: "ROUTE_KARA_GOTO_IN_SIMULATION не включён" }
  }
  if (!Number.isInteger(tagId) || tagId < 0) return { ok: false, kind: "rejected", status: null, message: "tagId — целое ≥ 0" }
  return call(cfg, { method: "POST", body: { siteCode, command: "goto", karaId, tagId } }, f)
}

/** Сверка каталога кар/тегов WMS с погрузчиками и метками Route (для диагностики администратора). */
export function reconcileCatalog(
  catalog: KaraCatalog,
  routeKaraIds: string[],
  routeTagIds: number[]
): { karasMissingInWms: string[]; karasOnlyInWms: string[]; tagsWithoutRows: number[]; tagsOnlyInWms: number[]; tagsMissingInWms: number[] } {
  const wmsKaras = new Set(catalog.karas.map((k) => k.id))
  const routeKaras = new Set(routeKaraIds)
  const wmsTags = new Set(catalog.tags.map((t) => t.tagId))
  const routeTags = new Set(routeTagIds)
  return {
    karasMissingInWms: routeKaraIds.filter((k) => !wmsKaras.has(k)),
    karasOnlyInWms: [...wmsKaras].filter((k) => !routeKaras.has(k)),
    tagsWithoutRows: catalog.tags.filter((t) => t.rows.length === 0).map((t) => t.tagId),
    tagsOnlyInWms: [...wmsTags].filter((t) => !routeTags.has(t)).sort((a, b) => a - b),
    tagsMissingInWms: [...routeTags].filter((t) => !wmsTags.has(t)).sort((a, b) => a - b),
  }
}
