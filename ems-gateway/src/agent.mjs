// SCADA EMS Gateway: опрос приборов в локальной сети, буферизация, отправка в облако,
// удалённая диагностика по заданиям облака. Все соединения с облаком — исходящие.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { DiskBuffer } from "./buffer.mjs"
import { Cloud, CloudError } from "./cloud.mjs"
import { ModbusTcpClient, readValue } from "./modbus.mjs"

export const AGENT_VERSION = "1.0.0"

export function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch {
    return fallback
  }
}

/** Атомарная запись секрета с правами 0600. */
export function saveCredentials(p, creds) {
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, p)
  fs.chmodSync(p, 0o600)
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })

export class Agent {
  constructor(opts) {
    this.dataDir = opts.dataDir
    this.credPath = path.join(this.dataDir, "credentials.json")
    this.cloud = new Cloud({ baseUrl: opts.cloudUrl, allowInsecureHttp: opts.allowInsecureHttp })
    this.buffer = new DiskBuffer({ dir: path.join(this.dataDir, "buffer"), maxBytes: opts.bufferMaxBytes ?? 200 * 1024 * 1024 })
    this.uploadBatch = opts.uploadBatch ?? 1000
    this.uploadIntervalMs = opts.uploadIntervalMs ?? 10_000
    this.heartbeatMs = opts.heartbeatMs ?? 60_000
    this.configRefreshMs = opts.configRefreshMs ?? 5 * 60_000
    this.rotateDays = opts.secretRotationDays ?? 30
    this.log = opts.logger ?? ((level, msg) => console.log(`${new Date().toISOString()} ${level} ${msg}`))
    this.config = null
    this.clients = new Map()
    this.nextPoll = new Map()
    this.meterState = new Map()
    this.pendingLog = []
    this.lastUploadAt = null
    this.started = Date.now()
    this.backoffMs = 0
    this.abort = new AbortController()
  }

  loadCredentials() {
    const c = loadJson(this.credPath, null)
    if (!c?.gatewayId || !c?.secret) throw new Error("Шлюз не зарегистрирован: выполните ems-gateway enroll <код>")
    this.cloud.setCredentials(c)
    return c
  }

  async enroll(code) {
    const r = await this.cloud.enroll(code, AGENT_VERSION)
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
    saveCredentials(this.credPath, { gatewayId: r.gatewayId, secret: r.secret, issuedAt: new Date().toISOString() })
    return r.gatewayId
  }

  addLog(entry) {
    this.pendingLog.push({ ...entry, at: new Date().toISOString() })
    if (this.pendingLog.length > 500) this.pendingLog.splice(0, this.pendingLog.length - 500)
  }

  async refreshConfig() {
    const cfg = await this.cloud.config()
    if (!this.config || cfg.version !== this.config.version) {
      this.log("info", `конфигурация ${cfg.version}: приборов ${cfg.meters.length}`)
      for (const [id, client] of this.clients) {
        if (!cfg.meters.some((m) => m.meterId === id)) {
          client.close()
          this.clients.delete(id)
        }
      }
      for (const m of cfg.meters) {
        const old = this.config?.meters.find((x) => x.meterId === m.meterId)
        if (old && (old.host !== m.host || old.port !== m.port)) {
          this.clients.get(m.meterId)?.close()
          this.clients.delete(m.meterId)
        }
      }
    }
    this.config = cfg
  }

  clientFor(m) {
    let c = this.clients.get(m.meterId)
    if (!c) {
      c = new ModbusTcpClient({ host: m.host, port: m.port, timeoutMs: m.timeoutMs })
      this.clients.set(m.meterId, c)
    }
    return c
  }

  /** Опрос одного прибора: показания сразу пишутся в буфер на диске. */
  async pollMeter(m) {
    const client = this.clientFor(m)
    const at = new Date().toISOString()
    const readings = []
    const errors = []
    for (const ch of m.channels) {
      try {
        const { value } = await readValue(client, m.unitId, ch.register)
        readings.push({ channelId: ch.channelId, at, raw: value })
      } catch (err) {
        errors.push({ channel: ch.code, code: err.code ?? "error", message: err.message })
      }
    }
    if (readings.length) this.buffer.append(readings)
    const st = this.meterState.get(m.meterId) ?? {}
    if (errors.length) {
      const sig = errors.map((e) => e.code).join(",")
      if (st.lastErrorSig !== sig) {
        for (const e of errors) this.addLog({ meterId: m.meterId, level: "error", code: e.code, message: `${m.name}, ${e.channel}: ${e.message}` })
      }
      st.lastErrorSig = sig
      st.lastError = errors[0].message
      st.lastErrorAt = at
    } else {
      if (st.lastErrorSig) this.addLog({ meterId: m.meterId, level: "info", code: "ok", message: `${m.name}: связь восстановлена` })
      st.lastErrorSig = null
      st.lastOkAt = at
    }
    this.meterState.set(m.meterId, st)
    return { readings: readings.length, errors }
  }

  async pollDue() {
    if (!this.config) return
    const now = Date.now()
    for (const m of this.config.meters) {
      const due = this.nextPoll.get(m.meterId) ?? 0
      if (now < due) continue
      this.nextPoll.set(m.meterId, now + m.pollIntervalSec * 1000)
      await this.pollMeter(m).catch((e) => this.log("error", `опрос ${m.name}: ${e.message}`))
    }
  }

  /** Отправка буфера. Удаление из буфера — только после ответа 200. */
  async uploadOnce() {
    let total = 0
    for (;;) {
      const { items, cursor } = this.buffer.peek(this.uploadBatch)
      if (!items.length) break
      const r = await this.cloud.upload(randomUUID(), items)
      this.buffer.ack(cursor)
      this.lastUploadAt = new Date().toISOString()
      total += items.length
      if (r.rejected?.length) this.addLog({ level: "warning", code: "rejected", message: `облако отклонило ${r.rejected.length} показаний`, details: { sample: r.rejected.slice(0, 5) } })
      if (items.length < this.uploadBatch) break
    }
    if (this.pendingLog.length) {
      const entries = this.pendingLog.splice(0, 200)
      await this.cloud.log(entries).catch((e) => {
        this.pendingLog.unshift(...entries)
        throw e
      })
    }
    return total
  }

  async heartbeat() {
    const meters = (this.config?.meters ?? []).map((m) => ({ meterId: m.meterId, ...(this.meterState.get(m.meterId) ?? {}) }))
    const r = await this.cloud.heartbeat({ agentVersion: AGENT_VERSION, uptimeSec: Math.round((Date.now() - this.started) / 1000), lastUploadAt: this.lastUploadAt, os: `${os.platform()} ${os.release()}`, meters, ...this.buffer.stats() })
    if (this.config && r.configVersion !== this.config.version) await this.refreshConfig()
  }

  async maybeRotate() {
    const creds = loadJson(this.credPath, null)
    const issued = creds?.issuedAt ? Date.parse(creds.issuedAt) : 0
    if (!this.rotateDays || Date.now() - issued < this.rotateDays * 86400_000) return
    const r = await this.cloud.rotate()
    saveCredentials(this.credPath, { gatewayId: r.gatewayId, secret: r.secret, issuedAt: new Date().toISOString() })
    this.cloud.setCredentials({ gatewayId: r.gatewayId, secret: r.secret })
    this.log("info", "секрет шлюза обновлён")
  }

  /** Задание диагностики: чтение регистров по параметрам из мастера подключения. */
  async runJob(job) {
    if (job.kind !== "probe") return { ok: false, error: `неизвестное задание ${job.kind}` }
    const p = job.payload
    const client = new ModbusTcpClient({ host: p.host, port: p.port, timeoutMs: p.timeoutMs })
    const results = []
    try {
      for (const reg of p.registers) {
        const started = Date.now()
        try {
          const { value, hex } = await readValue(client, p.unitId, reg)
          results.push({ key: reg.key, ok: true, value, hex, ms: Date.now() - started })
        } catch (err) {
          results.push({ key: reg.key, ok: false, code: err.code ?? "error", error: err.message, ms: Date.now() - started })
          if (["connection_refused", "host_unreachable", "timeout"].includes(err.code) && results.length === 1) break
        }
      }
    } finally {
      client.close()
    }
    return { ok: results.length > 0 && results.every((r) => r.ok), result: { results, checkedAt: new Date().toISOString() }, error: results.find((r) => !r.ok)?.error ?? null }
  }

  async jobsLoop() {
    while (!this.abort.signal.aborted) {
      try {
        const r = await this.cloud.nextJob(20)
        if (r.job) {
          this.log("info", `задание ${r.job.kind} ${r.job.jobId}`)
          const res = await this.runJob(r.job)
          await this.cloud.finishJob(r.job.jobId, res)
        }
      } catch (err) {
        if (!this.abort.signal.aborted) await sleep(err instanceof CloudError && err.status === 401 ? 60_000 : 5_000, this.abort.signal)
      }
    }
  }

  stop() {
    this.abort.abort()
    for (const c of this.clients.values()) c.close()
  }

  /** Главный цикл. Обрыв связи с облаком не останавливает опрос: данные копятся в буфере. */
  async run() {
    this.loadCredentials()
    const signal = this.abort.signal
    void this.jobsLoop()
    let lastUpload = 0
    let lastBeat = 0
    let lastCfg = 0
    while (!signal.aborted) {
      const now = Date.now()
      try {
        if (!this.config || now - lastCfg > this.configRefreshMs) {
          await this.refreshConfig()
          lastCfg = now
        }
      } catch (err) {
        this.log("warn", `конфигурация недоступна: ${err.message}`)
      }
      await this.pollDue()
      if (now - lastUpload >= Math.max(this.uploadIntervalMs, this.backoffMs)) {
        lastUpload = now
        try {
          const n = await this.uploadOnce()
          if (n) this.log("info", `отправлено ${n} показаний`)
          this.backoffMs = 0
        } catch (err) {
          this.backoffMs = Math.min(Math.max(this.backoffMs * 2, 2_000), 5 * 60_000)
          this.log("warn", `облако недоступно (${err.message}), повтор через ${Math.round(this.backoffMs / 1000)} с; в буфере ${this.buffer.stats().bufferItems}`)
        }
      }
      if (now - lastBeat >= this.heartbeatMs) {
        lastBeat = now
        await this.heartbeat().catch((e) => this.log("warn", `heartbeat: ${e.message}`))
        await this.maybeRotate().catch((e) => this.log("warn", `обновление секрета: ${e.message}`))
      }
      await sleep(1000, signal)
    }
  }
}
