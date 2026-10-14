import { createHash, createHmac } from "node:crypto"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * Объектное хранилище файлов. Ключ — SHA-256 содержимого (контроль целостности, дедупликация,
 * оригинал физически не перезаписывается: тот же ключ = те же байты).
 *  - EDI_STORAGE=local (по умолчанию): каталог EDI_STORAGE_DIR;
 *  - EDI_STORAGE=s3: любое S3-совместимое хранилище (MinIO, Yandex Object Storage, VK Cloud…),
 *    подпись AWS Signature V4 без внешних SDK.
 */

export interface StorageDriver {
  name: string
  put(key: string, data: Uint8Array, mime: string): Promise<void>
  get(key: string): Promise<Uint8Array>
  exists(key: string): Promise<boolean>
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex")
}

export function storageKey(siteId: number, sha: string): string {
  return `edi/${siteId}/${sha.slice(0, 2)}/${sha}`
}

class LocalDriver implements StorageDriver {
  name = "local"
  root: string
  constructor(root: string) {
    this.root = path.resolve(root)
  }
  private file(key: string): string {
    const full = path.resolve(this.root, key)
    if (!full.startsWith(this.root + path.sep)) throw new Error("bad storage key")
    return full
  }
  async put(key: string, data: Uint8Array): Promise<void> {
    const target = this.file(key)
    if (await this.exists(key)) return
    await mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, data, { flag: "wx" })
    await rename(tmp, target)
  }
  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.file(key)))
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.file(key))
      return true
    } catch {
      return false
    }
  }
}

export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** path-style (https://host/bucket/key) — нужен MinIO и большинству S3-совместимых. */
  pathStyle: boolean
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest()
}

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/")
}

/** Подпись запроса AWS SigV4 (заголовок Authorization). Вынесено для проверки по эталону AWS. */
export function signV4(input: {
  method: string
  host: string
  canonicalUri: string
  query?: string
  headers: Record<string, string>
  payloadHash: string
  region: string
  service?: string
  accessKeyId: string
  secretAccessKey: string
  amzDate: string
}): string {
  const service = input.service ?? "s3"
  const date = input.amzDate.slice(0, 8)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, " ")
  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("")
  const signedHeaders = names.join(";")
  const canonicalRequest = [input.method, input.canonicalUri, input.query ?? "", canonicalHeaders, signedHeaders, input.payloadHash].join("\n")
  const scope = `${date}/${input.region}/${service}/aws4_request`
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n")
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date)
  const kSigning = hmac(hmac(hmac(kDate, input.region), service), "aws4_request")
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex")
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

class S3Driver implements StorageDriver {
  name = "s3"
  cfg: S3Config
  constructor(cfg: S3Config) {
    this.cfg = cfg
  }
  private target(key: string) {
    const ep = new URL(this.cfg.endpoint)
    const keyPath = encodeKeyPath(key)
    if (this.cfg.pathStyle) {
      return { url: `${ep.origin}/${this.cfg.bucket}/${keyPath}`, host: ep.host, uri: `/${this.cfg.bucket}/${keyPath}` }
    }
    const host = `${this.cfg.bucket}.${ep.host}`
    return { url: `${ep.protocol}//${host}/${keyPath}`, host, uri: `/${keyPath}` }
  }
  private async request(method: string, key: string, body?: Uint8Array, mime?: string) {
    const t = this.target(key)
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "")
    const payloadHash = body ? sha256Hex(body) : sha256Hex("")
    const headers: Record<string, string> = { host: t.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate }
    if (mime) headers["content-type"] = mime
    const authorization = signV4({
      method,
      host: t.host,
      canonicalUri: t.uri,
      headers,
      payloadHash,
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      amzDate,
    })
    const { host: _host, ...sendHeaders } = headers
    return fetch(t.url, {
      method,
      headers: { ...sendHeaders, Authorization: authorization },
      body: body ? Buffer.from(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    })
  }
  async put(key: string, data: Uint8Array, mime: string): Promise<void> {
    if (await this.exists(key)) return
    const res = await this.request("PUT", key, data, mime)
    if (!res.ok) throw new Error(`S3 PUT ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  async get(key: string): Promise<Uint8Array> {
    const res = await this.request("GET", key)
    if (!res.ok) throw new Error(`S3 GET ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  async exists(key: string): Promise<boolean> {
    const res = await this.request("HEAD", key)
    return res.ok
  }
}

let driver: StorageDriver | null = null

export function getStorage(): StorageDriver {
  if (driver) return driver
  if ((process.env.EDI_STORAGE || "local").trim() === "s3") {
    const cfg: S3Config = {
      endpoint: process.env.EDI_S3_ENDPOINT || "",
      region: process.env.EDI_S3_REGION || "ru-central1",
      bucket: process.env.EDI_S3_BUCKET || "",
      accessKeyId: process.env.EDI_S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.EDI_S3_SECRET_ACCESS_KEY || "",
      pathStyle: process.env.EDI_S3_PATH_STYLE !== "false",
    }
    if (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
      throw new Error("EDI_STORAGE=s3 требует EDI_S3_ENDPOINT, EDI_S3_BUCKET, EDI_S3_ACCESS_KEY_ID, EDI_S3_SECRET_ACCESS_KEY")
    }
    driver = new S3Driver(cfg)
  } else {
    driver = new LocalDriver(process.env.EDI_STORAGE_DIR || path.join(process.cwd(), ".edi-storage"))
  }
  return driver
}

export function setStorage(next: StorageDriver | null) {
  driver = next
}

export function maxFileBytes(): number {
  const mb = Number(process.env.EDI_MAX_FILE_MB || 25)
  return (Number.isFinite(mb) && mb > 0 ? mb : 25) * 1024 * 1024
}
