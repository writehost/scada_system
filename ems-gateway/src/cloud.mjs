// Исходящая связь с облаком SCADA EMS (только HTTPS-запросы от шлюза).

export class CloudError extends Error {
  constructor(status, message, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

export class Cloud {
  constructor({ baseUrl, allowInsecureHttp = false, timeoutMs = 30_000 }) {
    const u = new URL(baseUrl)
    if (u.protocol !== "https:" && !allowInsecureHttp) throw new Error("cloudUrl должен быть https:// (allowInsecureHttp — только для локальной отладки)")
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.timeoutMs = timeoutMs
    this.creds = null
  }

  setCredentials(creds) {
    this.creds = creds
  }

  async request(method, path, body, { timeoutMs } = {}) {
    const headers = { "Content-Type": "application/json", "User-Agent": "scada-ems-gateway/1.0" }
    if (this.creds) headers.Authorization = `Gateway ${this.creds.gatewayId}:${this.creds.secret}`
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text.slice(0, 200) }
    }
    if (!res.ok) throw new CloudError(res.status, data?.error || `HTTP ${res.status}`, data)
    return data
  }

  enroll(code, agentVersion) {
    return this.request("POST", "/api/gateway/v1/enroll", { code, agentVersion })
  }
  config() {
    return this.request("GET", "/api/gateway/v1/config")
  }
  upload(batchId, readings) {
    return this.request("POST", "/api/gateway/v1/readings", { batchId, readings })
  }
  heartbeat(body) {
    return this.request("POST", "/api/gateway/v1/heartbeat", body)
  }
  nextJob(waitSec) {
    return this.request("GET", `/api/gateway/v1/jobs?wait=${waitSec}`, null, { timeoutMs: (waitSec + 15) * 1000 })
  }
  finishJob(id, body) {
    return this.request("POST", `/api/gateway/v1/jobs/${id}`, body)
  }
  log(entries) {
    return this.request("POST", "/api/gateway/v1/log", { entries })
  }
  rotate() {
    return this.request("POST", "/api/gateway/v1/rotate", {})
  }
}
