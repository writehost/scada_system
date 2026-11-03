/*
 * Минимальный клиент PostgreSQL (протокол v3) с интерфейсом, совместимым с пакетом `pg`
 * в объёме, который использует Route: Pool/PoolClient/Client, query(text, params), LISTEN/NOTIFY.
 *
 * ТОЛЬКО ДЛЯ ТЕСТОВ в песочнице без доступа к npm. В приложении используется настоящий `pg`.
 * Аутентификация: trust (локальный тестовый кластер).
 */
"use strict"
const net = require("node:net")
const { EventEmitter } = require("node:events")

function parseUrl(cfg) {
  if (typeof cfg === "string") cfg = { connectionString: cfg }
  if (cfg && cfg.connectionString) {
    const u = new URL(cfg.connectionString)
    return {
      host: u.hostname || "127.0.0.1",
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username || "postgres"),
      database: decodeURIComponent(u.pathname.replace(/^\//, "") || "postgres"),
    }
  }
  return { host: cfg.host || "127.0.0.1", port: Number(cfg.port || 5432), user: cfg.user || "postgres", database: cfg.database || "postgres" }
}

function arrLiteral(arr) {
  return (
    "{" +
    arr
      .map((v) => {
        if (v === null || v === undefined) return "NULL"
        if (Array.isArray(v)) return arrLiteral(v)
        const s = typeof v === "object" ? JSON.stringify(v) : String(v)
        return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
      })
      .join(",") +
    "}"
  )
}

function serialize(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (Buffer.isBuffer(v)) return "\\x" + v.toString("hex")
  if (Array.isArray(v)) return arrLiteral(v)
  if (typeof v === "object") return JSON.stringify(v)
  if (typeof v === "boolean") return v ? "true" : "false"
  return String(v)
}

function parseArray(text, conv) {
  // простой разбор одномерного массива в текстовом формате
  if (text === "{}") return []
  const out = []
  let i = 1
  while (i < text.length - 1) {
    let val
    if (text[i] === '"') {
      i += 1
      let s = ""
      while (text[i] !== '"') {
        if (text[i] === "\\") i += 1
        s += text[i]
        i += 1
      }
      i += 1
      val = s
    } else {
      let j = i
      while (j < text.length - 1 && text[j] !== ",") j += 1
      const raw = text.slice(i, j)
      val = raw === "NULL" ? null : raw
      i = j
    }
    out.push(val === null ? null : conv(val))
    if (text[i] === ",") i += 1
  }
  return out
}

const PARSERS = {
  16: (s) => s === "t",
  20: (s) => s,
  21: Number,
  23: Number,
  26: Number,
  700: Number,
  701: Number,
  1700: (s) => s,
  114: JSON.parse,
  3802: JSON.parse,
  1114: (s) => new Date(s.replace(" ", "T") + "Z"),
  1184: (s) => new Date(s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")),
  1007: (s) => parseArray(s, Number),
  1005: (s) => parseArray(s, Number),
  1016: (s) => parseArray(s, String),
  1009: (s) => parseArray(s, String),
  1015: (s) => parseArray(s, String),
  1000: (s) => parseArray(s, (x) => x === "t"),
}

class Connection extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = parseUrl(cfg)
    this.buf = Buffer.alloc(0)
    this.queue = Promise.resolve()
    this.pending = null
    this.ended = false
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.cfg.host, port: this.cfg.port })
      this.sock = sock
      let started = false
      this.pending = {
        onReady: () => {
          started = true
          resolve()
        },
        onError: (e) => reject(e),
      }
      sock.on("connect", () => {
        const params = Buffer.from(`user\0${this.cfg.user}\0database\0${this.cfg.database}\0client_encoding\0UTF8\0\0`)
        const head = Buffer.alloc(8)
        head.writeInt32BE(8 + params.length, 0)
        head.writeInt32BE(196608, 4)
        sock.write(Buffer.concat([head, params]))
      })
      sock.on("data", (d) => this.onData(d))
      sock.on("error", (e) => {
        if (!started) reject(e)
        this.emit("error", e)
      })
      sock.on("close", () => {
        this.ended = true
        this.emit("end")
      })
    })
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0])
      const len = this.buf.readInt32BE(1)
      if (this.buf.length < 1 + len) return
      const body = this.buf.subarray(5, 1 + len)
      this.buf = this.buf.subarray(1 + len)
      this.onMessage(type, body)
    }
  }

  onMessage(type, body) {
    const p = this.pending
    switch (type) {
      case "R": {
        const code = body.readInt32BE(0)
        if (code !== 0 && p) p.onError(new Error(`auth method ${code} not supported by test shim (use trust)`))
        break
      }
      case "Z":
        if (p && p.onReady) {
          const f = p.onReady
          this.pending = null
          f()
        }
        break
      case "T": {
        const n = body.readInt16BE(0)
        let off = 2
        const fields = []
        for (let i = 0; i < n; i += 1) {
          const end = body.indexOf(0, off)
          const name = body.toString("utf8", off, end)
          off = end + 1
          const typeOid = body.readInt32BE(off + 6)
          off += 18
          fields.push({ name, typeOid })
        }
        if (p) {
          p.fields = fields
          p.rows = p.rows || []
        }
        break
      }
      case "D": {
        const n = body.readInt16BE(0)
        let off = 2
        const row = {}
        for (let i = 0; i < n; i += 1) {
          const len = body.readInt32BE(off)
          off += 4
          const f = p.fields[i]
          if (len === -1) row[f.name] = null
          else {
            const s = body.toString("utf8", off, off + len)
            off += len
            const conv = PARSERS[f.typeOid]
            row[f.name] = conv ? conv(s) : s
          }
        }
        p.rows.push(row)
        break
      }
      case "C": {
        const tag = body.toString("utf8", 0, body.length - 1)
        const m = tag.match(/(\d+)$/)
        if (p) {
          p.rowCount = m ? Number(m[1]) : null
          p.command = tag.split(" ")[0]
        }
        break
      }
      case "E": {
        const fields = {}
        let off = 0
        while (off < body.length && body[off] !== 0) {
          const code = String.fromCharCode(body[off])
          const end = body.indexOf(0, off + 1)
          fields[code] = body.toString("utf8", off + 1, end)
          off = end + 1
        }
        const err = new Error(fields.M || "postgres error")
        err.code = fields.C
        err.detail = fields.D
        err.severity = fields.S
        err.constraint = fields.n
        if (p) p.error = err
        break
      }
      case "A": {
        let off = 4
        const end1 = body.indexOf(0, off)
        const channel = body.toString("utf8", off, end1)
        const end2 = body.indexOf(0, end1 + 1)
        const payload = body.toString("utf8", end1 + 1, end2)
        this.emit("notification", { channel, payload })
        break
      }
      default:
        break
    }
  }

  msg(type, payload) {
    const head = Buffer.alloc(5)
    head.write(type, 0)
    head.writeInt32BE(payload.length + 4, 1)
    return Buffer.concat([head, payload])
  }

  cstr(s) {
    return Buffer.from(s + "\0", "utf8")
  }

  query(text, params) {
    if (typeof text === "object" && text !== null) {
      params = text.values
      text = text.text
    }
    const run = () =>
      new Promise((resolve, reject) => {
        if (this.ended) return reject(new Error("connection closed"))
        const state = { rows: [], fields: [], rowCount: null }
        state.onReady = () => {
          if (state.error) reject(state.error)
          else resolve({ rows: state.rows, rowCount: state.rowCount, command: state.command, fields: state.fields })
        }
        this.pending = state
        if (!params || params.length === 0) {
          this.sock.write(this.msg("Q", this.cstr(text)))
          return
        }
        const vals = params.map(serialize)
        const parse = Buffer.concat([this.cstr(""), this.cstr(text), Buffer.from([0, 0])])
        const parts = [this.cstr(""), this.cstr(""), Buffer.from([0, 0])]
        const cnt = Buffer.alloc(2)
        cnt.writeInt16BE(vals.length, 0)
        parts.push(cnt)
        for (const v of vals) {
          const l = Buffer.alloc(4)
          if (v === null) {
            l.writeInt32BE(-1, 0)
            parts.push(l)
          } else {
            const b = Buffer.from(v, "utf8")
            l.writeInt32BE(b.length, 0)
            parts.push(l, b)
          }
        }
        parts.push(Buffer.from([0, 0]))
        const bind = Buffer.concat(parts)
        const describe = Buffer.concat([Buffer.from("P"), this.cstr("")])
        const exec = Buffer.concat([this.cstr(""), Buffer.from([0, 0, 0, 0])])
        this.sock.write(
          Buffer.concat([
            this.msg("P", parse),
            this.msg("B", bind),
            this.msg("D", describe),
            this.msg("E", exec),
            this.msg("S", Buffer.alloc(0)),
          ])
        )
      })
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  end() {
    this.ended = true
    try {
      this.sock.write(this.msg("X", Buffer.alloc(0)))
    } catch {}
    this.sock.end()
    return Promise.resolve()
  }
}

class Client extends Connection {}

class Pool extends EventEmitter {
  constructor(cfg = {}) {
    super()
    this.cfg = cfg.host || cfg.connectionString ? cfg : { ...cfg, connectionString: process.env.DATABASE_URL }
    this.max = cfg.max || 10
    this.idle = []
    this.count = 0
    this.waiters = []
  }
  async connect() {
    if (this.idle.length) return this.idle.pop()
    if (this.count >= this.max) return new Promise((res) => this.waiters.push(res))
    this.count += 1
    const c = new Connection(this.cfg)
    await c.connect()
    c.release = (destroy) => {
      if (destroy || c.ended) {
        this.count -= 1
        c.end()
        return
      }
      const w = this.waiters.shift()
      if (w) w(c)
      else this.idle.push(c)
    }
    return c
  }
  async query(text, params) {
    const c = await this.connect()
    try {
      return await c.query(text, params)
    } finally {
      c.release()
    }
  }
  async end() {
    for (const c of this.idle) await c.end()
    this.idle = []
  }
}

module.exports = { Pool, Client, default: { Pool, Client } }
