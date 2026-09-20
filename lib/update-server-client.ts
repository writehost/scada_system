import https from "node:https"

export type WmsReleaseInfo = {
  version: string
  buildId: string
  builtAt: string
  changelog: string
  packageName?: string | null
  packageUrl?: string | null
  mandatory?: boolean
}

export type WmsUpdateCheckResult = {
  updateAvailable: boolean
  isTest?: boolean
  release?: WmsReleaseInfo
  currentBuildId?: string | null
  installedBuildId?: string | null
  error?: string
}

export type TsdReleaseInfo = {
  versionCode: number
  versionName: string
  buildId: string
  builtAt?: string | null
  changelog?: string | null
  apkName?: string | null
  apkUrl?: string | null
  apkSha256?: string | null
  signingCertSha256?: string | null
  mandatory?: boolean
}

export type TsdUpdateCheckResult = {
  updateAvailable: boolean
  isTest?: boolean
  release?: TsdReleaseInfo | null
  error?: string
}

function updateServerInsecureTls(): boolean {
  return process.env.WMS_UPDATE_SERVER_INSECURE_TLS === "1"
}

export function getUpdateServerBaseUrl(): string | null {
  const url = (
    process.env.WMS_UPDATE_SERVER_URL ||
    process.env.NEXT_PUBLIC_WMS_UPDATE_SERVER_URL ||
    "https://scada25.ru"
  ).trim()
  return url.replace(/\/$/, "")
}

export function isUpdateServerConfigured(): boolean {
  return Boolean(getUpdateServerBaseUrl())
}

function requestAgent() {
  return updateServerInsecureTls() ? new https.Agent({ rejectUnauthorized: false }) : undefined
}

async function updateServerGet(pathAndQuery: string): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const base = getUpdateServerBaseUrl()
  if (!base) return { ok: false, status: 0, json: null, error: "not_configured" }
  const headers: Record<string, string> = { Accept: "application/json" }
  const token = process.env.WMS_UPDATE_SERVER_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  const agent = requestAgent()
  try {
    const res = await fetch(`${base}${pathAndQuery}`, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(15000),
      ...(agent ? { agent } : {}),
    } as RequestInit)
    if (!res.ok) return { ok: false, status: res.status, json: null, error: `http_${res.status}` }
    return { ok: true, status: res.status, json: await res.json() }
  } catch (err) {
    return { ok: false, status: 0, json: null, error: err instanceof Error ? err.message : "fetch_failed" }
  }
}

export async function fetchUpdateCheck(currentBuildId: string): Promise<WmsUpdateCheckResult> {
  const remote = await updateServerGet(`/api/v1/check?currentBuildId=${encodeURIComponent(currentBuildId)}`)
  if (!remote.ok) {
    return { updateAvailable: false, currentBuildId, error: remote.error }
  }
  return remote.json as WmsUpdateCheckResult
}

export async function fetchTsdUpdateCheck(versionCode = 1, versionName = "0"): Promise<TsdUpdateCheckResult> {
  const qp = new URLSearchParams({
    currentVersionCode: String(versionCode),
    currentVersionName: versionName,
  })
  const remote = await updateServerGet(`/api/v1/tsd/check?${qp.toString()}`)
  if (!remote.ok) {
    return { updateAvailable: false, error: remote.error }
  }
  return remote.json as TsdUpdateCheckResult
}
