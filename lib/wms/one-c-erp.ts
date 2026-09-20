import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import tls from "node:tls"
import type { PoolClient } from "pg"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { ensureItemGroup } from "@/lib/wms/item-master-refs"

export const ONE_C_SETTING_KEY = "integration_1c_erp"
const PAGE_SIZE = 100
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"
const FACTORY_SOCKS_HOST = process.env.WMS_FACTORY_SOCKS_HOST || "127.0.0.1"
const FACTORY_SOCKS_PORT = Number(process.env.WMS_FACTORY_SOCKS_PORT || 18081)

export type OneCSettings = {
  enabled: boolean
  baseUrl: string
  login: string
  password: string
  viaFactory: boolean
}

export type OneCNomenclatureRow = {
  refKey: string
  code: string
  description: string
  sku: string
  parentKey: string
  itemType: string
}

export type OneCFolderRow = {
  refKey: string
  code: string
  description: string
  parentKey: string
}

export type OneCSyncResult = {
  ok: true
  totalIn1C: number
  fetched: number
  pages: number
  inserted: number
  updated: number
  skipped: number
  groupsFilled: number
  skuFilled: number
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function getOneCSettings(siteCode: string): Promise<OneCSettings> {
  const empty: OneCSettings = { enabled: false, baseUrl: "", login: "", password: "", viaFactory: true }
  const pool = tryGetPool()
  if (!pool) return empty
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode || "DEFAULT")
    if (siteId == null) return empty
    await client.query(`
      CREATE TABLE IF NOT EXISTS wms_app_settings (
        site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
        setting_key TEXT NOT NULL,
        setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (site_id, setting_key)
      )`)
    const r = await client.query<{ setting_value: unknown }>(
      `SELECT setting_value FROM wms_app_settings WHERE site_id = $1 AND setting_key = $2`,
      [siteId, ONE_C_SETTING_KEY]
    )
    const v = jsonObject(r.rows[0]?.setting_value)
    return {
      enabled: v.enabled === true,
      baseUrl: typeof v.baseUrl === "string" ? v.baseUrl : "",
      login: typeof v.login === "string" ? v.login : "",
      password: typeof v.password === "string" ? v.password : "",
      viaFactory: v.viaFactory !== false,
    }
  } finally {
    client.release()
  }
}

export function normalizeODataRoot(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error("Укажите адрес OData 1С ERP")
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error("Некорректный адрес 1С ERP")
  }
  parsed.search = ""
  parsed.hash = ""
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "").replace(/\/Catalog_[^/]+$/i, "")
  if (!parsed.pathname.startsWith("/")) parsed.pathname = `/${parsed.pathname}`
  return parsed.toString().replace(/\/+$/, "")
}

function catalogPageUrl(root: string, top: number, skip: number): string {
  // Без $filter=IsFolder: на этой 1С фильтр каталога отвечает минутами, а полный
  // листинг страницы из 100 строк приходит за секунды. Папки отделяем в памяти.
  return `${root}/Catalog_Номенклатура?$format=json&$inlinecount=allpages&$top=${top}&$skip=${skip}`
}

/** Node http.request rejects Cyrillic; 1C OData often rejects %24 instead of $. */
export function nodeRequestPath(raw: string): string {
  const parsed = new URL(raw)
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?")).replace(/%24/gi, "$") : ""
  const path = `${parsed.pathname}${query}`
  if (/[^\u0021-\u00ff]/.test(path)) {
    const q = path.indexOf("?")
    const pathname = q >= 0 ? path.slice(0, q) : path
    const search = q >= 0 ? path.slice(q) : ""
    return `${encodeURI(pathname)}${search}`
  }
  return path
}

function splitHttpTarget(raw: string): { parsed: URL; path: string } {
  return { parsed: new URL(raw), path: nodeRequestPath(raw) }
}

export function humanizeOneCError(error: unknown, viaFactory: boolean): string {
  const raw = error instanceof Error ? error.message : String(error || "нет связи с 1С ERP")
  const hostMatch = raw.match(/ENOTFOUND\s+([A-Za-z0-9._-]+)/)
  if (hostMatch || /ENOTFOUND|getaddrinfo/i.test(raw)) {
    const host = hostMatch?.[1] || "хост 1С"
    return viaFactory
      ? `Завод 10.26 не резолвит ${host}`
      : `Сервер WMS не знает имя ${host}. Включите «через завод 10.26» или укажите адрес, доступный с WMS.`
  }
  if (/ECONNREFUSED/.test(raw) && /18081/.test(raw)) {
    return "Туннель на завод 10.26 не поднят (SOCKS 18081)"
  }
  if (/ECONNREFUSED/.test(raw)) return "1С отказала в TCP-соединении"
  if (
    /ENETUNREACH|EHOSTUNREACH|network is unreachable|Host unreachable|proxy closed|ECONNRESET|туннель 10\.26 закрылся/i.test(
      raw
    )
  ) {
    return "С завода 10.26 нет маршрута до 1С. С 10.26 имя резолвится, но TCP до этой машины обрывается. Нужен маршрут 10.26→1С или адрес 1С в сети 10.26."
  }
  if (/ETIMEDOUT|не ответила вовремя/i.test(raw)) {
    return viaFactory
      ? "1С не ответила вовремя. С завода 10.26 маршрут до этой машины иногда пропадает — повторите попытку."
      : "1С не ответила вовремя"
  }
  return raw
}

function readExact(socket: net.Socket, size: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    socket.pause()
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("1С не ответила вовремя"))
    }, timeoutMs)
    const tryRead = () => {
      const buf = socket.read(size)
      if (buf && buf.length === size) {
        cleanup()
        resolve(buf)
        return
      }
      if (buf && buf.length > 0) socket.unshift(buf)
    }
    const onErr = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timer)
      socket.off("readable", tryRead)
      socket.off("error", onErr)
      socket.off("close", onClose)
    }
    const onClose = () => onErr(new Error("туннель 10.26 закрылся"))
    socket.on("readable", tryRead)
    socket.on("error", onErr)
    socket.on("close", onClose)
    tryRead()
  })
}

const SOCKS_REPLY: Record<number, string> = {
  0x01: "SOCKS: общая ошибка туннеля 10.26",
  0x03: "С завода 10.26 сеть до 1С недоступна",
  0x04: "С завода 10.26 хост 1С недоступен",
  0x05: "С завода 10.26 1С отказала в соединении",
  0x06: "С завода 10.26 TTL истек по пути к 1С",
}

function isIPv4(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
}

function socksConnectRequest(destHost: string, destPort: number): Buffer {
  const port = Buffer.from([(destPort >> 8) & 0xff, destPort & 0xff])
  if (isIPv4(destHost)) {
    return Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x01]),
      Buffer.from(destHost.split(".").map((octet) => Number(octet))),
      port,
    ])
  }
  const hostBuf = Buffer.from(destHost, "utf8")
  return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, port])
}

async function socks5Connect(destHost: string, destPort: number, timeoutMs: number): Promise<net.Socket> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const sock = net.connect({ host: FACTORY_SOCKS_HOST, port: FACTORY_SOCKS_PORT })
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`ECONNREFUSED ${FACTORY_SOCKS_HOST}:${FACTORY_SOCKS_PORT}`))
    }, Math.min(8000, timeoutMs))
    sock.once("connect", () => {
      clearTimeout(timer)
      resolve(sock)
    })
    sock.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  socket.write(Buffer.from([0x05, 0x01, 0x00]))
  const greet = await readExact(socket, 2, 8000)
  if (greet[0] !== 0x05 || greet[1] !== 0x00) {
    socket.destroy()
    throw new Error("Туннель 10.26 не принял SOCKS")
  }
  socket.write(socksConnectRequest(destHost, destPort))
  const hdr = await readExact(socket, 4, Math.min(15000, timeoutMs))
  if (hdr[0] !== 0x05 || hdr[1] !== 0x00) {
    socket.destroy()
    throw new Error(SOCKS_REPLY[hdr[1] ?? 1] || `SOCKS 10.26 отказал (код ${hdr[1]})`)
  }
  let rest = 0
  if (hdr[3] === 0x01) rest = 4 + 2
  else if (hdr[3] === 0x04) rest = 16 + 2
  else if (hdr[3] === 0x03) {
    const len = await readExact(socket, 1, 5000)
    rest = len[0] + 2
  } else {
    socket.destroy()
    throw new Error("непонятный ответ SOCKS 10.26")
  }
  await readExact(socket, rest, 5000)
  socket.resume()
  return socket
}

export type OneCHttpOptions = {
  method?: "GET" | "POST"
  body?: unknown
}

function httpOverSocket(
  socket: net.Socket,
  parsed: URL,
  path: string,
  auth: string,
  timeoutMs: number,
  options?: OneCHttpOptions
): Promise<{ status: number; text: string; location: string }> {
  const lib = parsed.protocol === "https:" ? https : http
  const method = options?.method === "POST" ? "POST" : "GET"
  const payload = method === "POST" && options?.body !== undefined ? JSON.stringify(options.body) : ""
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path,
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          Host: parsed.host,
          Connection: "close",
          ...(payload
            ? {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: timeoutMs,
        rejectUnauthorized: false,
        createConnection: () => {
          if (parsed.protocol === "https:") {
            return tls.connect({
              socket,
              servername: parsed.hostname,
              rejectUnauthorized: false,
            }) as unknown as net.Socket
          }
          return socket
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString("utf8"),
            location: String(res.headers.location || ""),
          })
        })
      }
    )
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("1С не ответила вовремя"))
    })
    req.on("error", (error) => reject(error))
    if (payload) req.write(payload)
    req.end()
  })
}

function parseCurlHeaders(raw: string): { status: number; location: string } {
  const blocks = raw.split(/\r?\n\r?\n/).filter((block) => /HTTP\/\d/i.test(block))
  const last = blocks[blocks.length - 1] || raw
  const statusMatch = last.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/i)
  const locMatch = last.match(/^location:\s*(.+)$/im)
  return {
    status: Number(statusMatch?.[1] || 0),
    location: locMatch?.[1]?.trim() || "",
  }
}

/** curl по SOCKS стабильно тянет страницы каталога; свой Node-сокет зависает на ответах ~800 КБ. */
function curlOneC(
  parsed: URL,
  path: string,
  settings: OneCSettings,
  timeoutMs: number,
  viaFactory: boolean,
  options?: OneCHttpOptions
): Promise<{ status: number; text: string; location: string }> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "wms-onec-"))
    const bodyPath = join(dir, "body")
    const hdrPath = join(dir, "hdr")
    const netrcPath = join(dir, "netrc")
    const payloadPath = join(dir, "payload.json")
    writeFileSync(netrcPath, `machine ${parsed.hostname}\nlogin ${settings.login}\npassword ${settings.password}\n`, {
      mode: 0o600,
    })
    const method = options?.method === "POST" ? "POST" : "GET"
    const args = [
      "-sS",
      "--globoff",
      "--max-time",
      String(Math.max(8, Math.ceil(timeoutMs / 1000))),
      "--netrc-file",
      netrcPath,
      "-H",
      "Accept: application/json",
      "-D",
      hdrPath,
      "-o",
      bodyPath,
    ]
    if (method === "POST") {
      writeFileSync(payloadPath, JSON.stringify(options?.body ?? {}), { mode: 0o600 })
      args.push("-X", "POST", "-H", "Content-Type: application/json; charset=utf-8", "--data-binary", `@${payloadPath}`)
    }
    if (viaFactory) args.push("--socks5-hostname", `${FACTORY_SOCKS_HOST}:${FACTORY_SOCKS_PORT}`)
    args.push(`${parsed.protocol}//${parsed.host}${path}`)
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] })
    const errChunks: Buffer[] = []
    child.stderr.on("data", (chunk) => errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("1С не ответила вовремя"))
    }, timeoutMs + 2000)
    child.on("error", (error) => {
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      try {
        const stderr = Buffer.concat(errChunks).toString("utf8").trim()
        if (code !== 0) {
          throw new Error(stderr || `curl 1С завершился с кодом ${code}`)
        }
        const headers = readFileSync(hdrPath, "utf8")
        const text = readFileSync(bodyPath)
        resolve({ ...parseCurlHeaders(headers), text: text.toString("utf8") })
      } catch (error) {
        reject(error)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
}

async function oneCRequestOnce(
  url: string,
  settings: OneCSettings,
  timeoutMs: number,
  redirects: number,
  options?: OneCHttpOptions
): Promise<unknown> {
  const { parsed, path } = splitHttpTarget(url)
  const auth = Buffer.from(`${settings.login}:${settings.password}`, "utf8").toString("base64")
  const destPort = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80))
  const viaFactory = settings.viaFactory !== false

  let status: number
  let text: string
  let location: string
  try {
    ;({ status, text, location } = await curlOneC(parsed, path, settings, timeoutMs, viaFactory, options))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        if (viaFactory) {
          const socket = await socks5Connect(parsed.hostname, destPort, timeoutMs)
          ;({ status, text, location } = await httpOverSocket(socket, parsed, path, auth, timeoutMs, options))
        } else {
          ;({ status, text, location } = await httpOverSocket(
            await new Promise<net.Socket>((resolve, reject) => {
              const sock = net.connect({
                host: parsed.hostname,
                port: destPort,
              })
              sock.once("connect", () => resolve(sock))
              sock.once("error", reject)
            }),
            parsed,
            path,
            auth,
            timeoutMs,
            options
          ))
        }
      } catch (fallbackError) {
        throw new Error(humanizeOneCError(fallbackError, viaFactory))
      }
    } else {
      throw new Error(humanizeOneCError(error, viaFactory))
    }
  }

  if (status >= 300 && status < 400 && location && redirects < 4) {
    const next = new URL(location, parsed)
    return oneCRequestOnce(next.toString(), settings, timeoutMs, redirects + 1, options)
  }
  if (status < 200 || status >= 300) {
    throw new Error(`1С ответила HTTP ${status}: ${text.slice(0, 240) || "без тела"}`)
  }
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("1С вернула не JSON")
  }
}

function shouldRetryOneC(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error || "")
  return /не ответила вовремя|ECONNRESET|туннель 10\.26 закрылся|нет маршрута|Host unreachable|network is unreachable|Can't complete SOCKS|Connection timed out|Failed to connect to .*18081/i.test(
    raw
  )
}

export async function oneCRequest(
  url: string,
  settings: OneCSettings,
  timeoutMs = 45000,
  redirects = 0,
  options?: OneCHttpOptions
): Promise<unknown> {
  let last: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await oneCRequestOnce(url, settings, timeoutMs, redirects, options)
    } catch (error) {
      last = error
      if (attempt === 3 || !shouldRetryOneC(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
    }
  }
  throw last instanceof Error ? last : new Error(String(last || "нет связи с 1С ERP"))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function pickStr(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim()
    if (text && text !== EMPTY_GUID) return text
  }
  return ""
}

function mapNomenclature(raw: Record<string, unknown>): OneCNomenclatureRow | null {
  if (raw.DeletionMark === true || raw.IsFolder === true) return null
  const refKey = pickStr(raw.Ref_Key)
  const code = pickStr(raw.Code)
  const description = pickStr(raw.Description, raw.НаименованиеПолное)
  if (!refKey || !code || !description) return null
  return {
    refKey,
    code,
    description,
    sku: pickStr(raw.Артикул, raw.Article, raw.SKU),
    parentKey: pickStr(raw.Parent_Key),
    itemType: pickStr(raw.ТипНоменклатуры),
  }
}

function mapFolder(raw: Record<string, unknown>): OneCFolderRow | null {
  if (raw.IsFolder !== true || raw.DeletionMark === true) return null
  const refKey = pickStr(raw.Ref_Key)
  const description = pickStr(raw.Description, raw.НаименованиеПолное)
  if (!refKey || !description) return null
  return {
    refKey,
    code: pickStr(raw.Code),
    description,
    parentKey: pickStr(raw.Parent_Key),
  }
}

function inferGroupFromName(name: string): string | null {
  const n = name.toLocaleLowerCase("ru")
  if (n.includes("этикетк")) return "Этикетки"
  if (n.includes("стикер")) return "Стикеры"
  if (n.includes("пленк") || n.includes("плёнк")) return "Плёнка"
  if (n.includes("картон") || n.includes("короб")) return "Картон"
  if (n.includes("преформ")) return "Преформа"
  if (n.includes("колпак") || n.includes("крышк") || n.includes("ручк")) return "Колпачок, ручка"
  if (n.includes("поддон") || n.includes("паллет") || n.includes("палет")) return "Поддоны"
  if (n.includes("эмульс")) return "Эмульсия"
  if (n.includes("мазут") || n.includes("топлив") || n.includes("гсм")) return "Топливо, ГСМ"
  return null
}

export async function fetchAllNomenclature(settings: OneCSettings): Promise<{
  rows: OneCNomenclatureRow[]
  folders: OneCFolderRow[]
  totalIn1C: number
  pages: number
}> {
  const root = normalizeODataRoot(settings.baseUrl)
  const rows: OneCNomenclatureRow[] = []
  const folders: OneCFolderRow[] = []
  let skip = 0
  let pages = 0
  let totalIn1C = Number.POSITIVE_INFINITY

  while (skip < totalIn1C) {
    const payload = asRecord(await oneCRequest(catalogPageUrl(root, PAGE_SIZE, skip), settings))
    if (!payload) throw new Error("1С вернула пустой ответ каталога")
    const count = Number(payload["odata.count"] ?? payload["@odata.count"] ?? NaN)
    if (Number.isFinite(count)) totalIn1C = count
    const batch = Array.isArray(payload.value) ? payload.value : []
    pages += 1
    for (const item of batch) {
      const rec = asRecord(item)
      if (!rec) continue
      const folder = mapFolder(rec)
      if (folder) {
        folders.push(folder)
        continue
      }
      const mapped = mapNomenclature(rec)
      if (mapped) rows.push(mapped)
    }
    if (batch.length === 0) break
    skip += batch.length
    if (!Number.isFinite(count) && batch.length < PAGE_SIZE) break
    if (pages > 500) throw new Error("Слишком много страниц 1С — остановил после 500")
  }

  if (!Number.isFinite(totalIn1C)) totalIn1C = rows.length + folders.length
  return { rows, folders, totalIn1C, pages }
}

type OneCUpsertRow = {
  code: string
  guid: string
  name: string
  sku: string
  group_code: string
  parent_key: string
  item_type: string
}

async function upsertOneCBatch(
  client: PoolClient,
  siteId: number,
  rows: OneCUpsertRow[],
  syncedAt: string
): Promise<{ updated: number; inserted: number }> {
  if (rows.length === 0) return { updated: 0, inserted: 0 }
  const payload = JSON.stringify(rows)
  const updated = await client.query<{ guid: string }>(
    `WITH src AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
         code text, guid text, name text, sku text, group_code text, parent_key text, item_type text
       )
     ),
     attrs AS (
       SELECT
         src.*,
         jsonb_strip_nulls(jsonb_build_object(
           'oneCCode', src.code,
           'oneCGuid', src.guid,
           'erpCode', src.code,
           'source', '1c-erp',
           'lastSyncAt', $3::text,
           'parentKey', NULLIF(src.parent_key, ''),
           'article', NULLIF(src.sku, ''),
           'itemType', NULLIF(src.item_type, '')
         )) AS nomenclature
       FROM src
     )
     UPDATE wms_items i SET
       name = attrs.name,
       is_active = TRUE,
       sku = CASE WHEN attrs.sku <> '' THEN attrs.sku ELSE i.sku END,
       item_group_code = CASE WHEN attrs.group_code <> '' THEN attrs.group_code ELSE i.item_group_code END,
       product_group = CASE WHEN attrs.group_code <> '' THEN attrs.group_code ELSE i.product_group END,
       item_attrs_json = jsonb_set(
         COALESCE(i.item_attrs_json, '{}'::jsonb),
         '{nomenclature}',
         COALESCE(i.item_attrs_json->'nomenclature', '{}'::jsonb) || attrs.nomenclature
       ),
       updated_at = now()
     FROM attrs
     WHERE i.site_id = $1
       AND (
         i.item_code = attrs.code
         OR i.item_attrs_json #>> '{nomenclature,oneCGuid}' = attrs.guid
         OR i.item_attrs_json #>> '{nomenclature,oneCCode}' = attrs.code
       )
     RETURNING attrs.guid`,
    [siteId, payload, syncedAt]
  )
  const matched = new Set(updated.rows.map((row) => row.guid))
  const toInsert = rows.filter((row) => !matched.has(row.guid))
  if (toInsert.length === 0) return { updated: matched.size, inserted: 0 }
  await client.query(
    `INSERT INTO wms_items (
       site_id, item_code, name, sku, item_group_code, product_group,
       item_type_code, uom_code, is_active, item_attrs_json, created_at, updated_at
     )
     SELECT
       $1,
       x.code,
       x.name,
       NULLIF(x.sku, ''),
       NULLIF(x.group_code, ''),
       NULLIF(x.group_code, ''),
       'goods',
       'pcs',
       TRUE,
       jsonb_build_object(
         'nomenclature',
         jsonb_strip_nulls(jsonb_build_object(
           'oneCCode', x.code,
           'oneCGuid', x.guid,
           'erpCode', x.code,
           'source', '1c-erp',
           'lastSyncAt', $3::text,
           'parentKey', NULLIF(x.parent_key, ''),
           'article', NULLIF(x.sku, ''),
           'itemType', NULLIF(x.item_type, '')
         ))
       ),
       now(),
       now()
     FROM jsonb_to_recordset($2::jsonb) AS x(
       code text, guid text, name text, sku text, group_code text, parent_key text, item_type text
     )
     ON CONFLICT (site_id, item_code) DO UPDATE SET
       name = EXCLUDED.name,
       is_active = TRUE,
       sku = COALESCE(NULLIF(EXCLUDED.sku, ''), wms_items.sku),
       item_group_code = COALESCE(NULLIF(EXCLUDED.item_group_code, ''), wms_items.item_group_code),
       product_group = COALESCE(NULLIF(EXCLUDED.product_group, ''), wms_items.product_group),
       item_attrs_json = jsonb_set(
         COALESCE(wms_items.item_attrs_json, '{}'::jsonb),
         '{nomenclature}',
         COALESCE(wms_items.item_attrs_json->'nomenclature', '{}'::jsonb) || EXCLUDED.item_attrs_json->'nomenclature'
       ),
       updated_at = now()`,
    [siteId, JSON.stringify(toInsert), syncedAt]
  )
  return { updated: matched.size, inserted: toInsert.length }
}

export async function syncNomenclatureFromOneC(
  client: PoolClient,
  siteId: number,
  settings: OneCSettings
): Promise<OneCSyncResult> {
  if (!settings.baseUrl.trim()) throw new Error("В настройках не задан адрес 1С ERP")
  if (!settings.login.trim()) throw new Error("В настройках не задан логин 1С ERP")

  const catalog = await fetchAllNomenclature(settings)
  const folderByKey = new Map(catalog.folders.map((f) => [f.refKey, f]))
  const planned = catalog.rows.map((row) => {
    const parent = row.parentKey ? folderByKey.get(row.parentKey) : undefined
    const groupName = parent?.description?.trim() || inferGroupFromName(row.description)
    return { row, groupName }
  })
  const uniqueGroups = [...new Set(planned.map((item) => (item.groupName || "").trim()).filter(Boolean))]
  const upsertRows: OneCUpsertRow[] = planned.map(({ row, groupName }) => ({
    code: row.code,
    guid: row.refKey,
    name: row.description,
    sku: row.sku || "",
    group_code: (groupName || "").trim(),
    parent_key: row.parentKey || "",
    item_type: row.itemType || "",
  }))

  await client.query("BEGIN")
  try {
    for (const group of uniqueGroups) {
      await ensureItemGroup(client, siteId, group, group)
    }
    const result = await upsertOneCBatch(client, siteId, upsertRows, new Date().toISOString())
    await client.query("COMMIT")
    return {
      ok: true,
      totalIn1C: catalog.totalIn1C,
      fetched: catalog.rows.length,
      pages: catalog.pages,
      inserted: result.inserted,
      updated: result.updated,
      skipped: 0,
      groupsFilled: planned.filter((item) => Boolean(item.groupName)).length,
      skuFilled: catalog.rows.filter((row) => Boolean(row.sku)).length,
    }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}
