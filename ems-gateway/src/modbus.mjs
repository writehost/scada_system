// Клиент Modbus TCP. Реализованы только функции чтения 03 (holding) и 04 (input).
// Функций записи (05, 06, 15, 16) нет намеренно: агент не управляет исполнительными
// механизмами — для этого нужен отдельный проект безопасности.

import net from "node:net"

export class ModbusError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = "ModbusError"
    this.code = code
    this.details = details
  }
}

const EXCEPTIONS = {
  1: ["illegal_function", "Функция не поддерживается устройством"],
  2: ["illegal_address", "Неправильный адрес регистра"],
  3: ["illegal_value", "Неверное значение запроса (количество регистров)"],
  4: ["device_failure", "Ошибка устройства"],
  6: ["device_busy", "Устройство занято"],
  10: ["gateway_path", "Шлюз Modbus: нет маршрута до устройства"],
  11: ["gateway_target", "Шлюз Modbus: устройство за шлюзом не ответило"],
}

export class ModbusTcpClient {
  constructor({ host, port = 502, timeoutMs = 2000 }) {
    this.host = host
    this.port = port
    this.timeoutMs = timeoutMs
    this.socket = null
    this.tid = Math.floor(Math.random() * 0xffff)
    this.pending = new Map()
    this.buffer = Buffer.alloc(0)
    this.connecting = null
  }

  connect() {
    if (this.socket && !this.socket.destroyed) return Promise.resolve()
    if (this.connecting) return this.connecting
    this.connecting = new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port })
      const timer = setTimeout(() => {
        s.destroy()
        reject(new ModbusError("timeout", `Нет ответа от ${this.host}:${this.port} за ${this.timeoutMs} мс`))
      }, this.timeoutMs)
      s.once("connect", () => {
        clearTimeout(timer)
        s.setNoDelay(true)
        this.socket = s
        resolve()
      })
      s.on("data", (chunk) => this.onData(chunk))
      s.on("error", (err) => {
        clearTimeout(timer)
        const mapped = mapSocketError(err, this.host, this.port)
        this.failAll(mapped)
        reject(mapped)
      })
      s.on("close", () => {
        this.socket = null
        this.failAll(new ModbusError("connection_closed", "Соединение закрыто устройством"))
      })
    }).finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 7) {
      const len = this.buffer.readUInt16BE(4)
      if (this.buffer.length < 6 + len) return
      const frame = this.buffer.subarray(0, 6 + len)
      this.buffer = this.buffer.subarray(6 + len)
      const tid = frame.readUInt16BE(0)
      const p = this.pending.get(tid)
      if (!p) continue
      this.pending.delete(tid)
      clearTimeout(p.timer)
      const fn = frame[7]
      if (fn & 0x80) {
        const code = frame[8]
        const [c, m] = EXCEPTIONS[code] ?? ["exception", `Исключение Modbus ${code}`]
        p.reject(new ModbusError(c, m, { exception: code }))
      } else if (fn !== p.fn) {
        p.reject(new ModbusError("bad_response", "Ответ на другую функцию"))
      } else {
        const byteCount = frame[8]
        p.resolve(frame.subarray(9, 9 + byteCount))
      }
    }
  }

  async readRegisters(unitId, fn, address, count) {
    if (fn !== 3 && fn !== 4) throw new ModbusError("illegal_function", "Агент читает только функции 03 и 04")
    if (!(count >= 1 && count <= 125)) throw new ModbusError("illegal_value", "За один запрос — от 1 до 125 регистров")
    await this.connect()
    this.tid = (this.tid + 1) & 0xffff
    const tid = this.tid
    const req = Buffer.alloc(12)
    req.writeUInt16BE(tid, 0)
    req.writeUInt16BE(0, 2)
    req.writeUInt16BE(6, 4)
    req.writeUInt8(unitId & 0xff, 6)
    req.writeUInt8(fn, 7)
    req.writeUInt16BE(address, 8)
    req.writeUInt16BE(count, 10)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tid)
        // После таймаута ответ может прийти позже и перепутаться — переподключаемся.
        this.close()
        reject(new ModbusError("timeout", `Устройство не отвечает (unit ${unitId}, регистр ${address})`))
      }, this.timeoutMs)
      this.pending.set(tid, { resolve, reject, timer, fn })
      this.socket.write(req)
    }).then((data) => {
      if (data.length !== count * 2) throw new ModbusError("bad_response", `Ожидалось ${count * 2} байт, получено ${data.length}`)
      return data
    })
  }

  close() {
    if (this.socket) this.socket.destroy()
    this.socket = null
  }
}

function mapSocketError(err, host, port) {
  if (err.code === "ECONNREFUSED") return new ModbusError("connection_refused", `Нет соединения: ${host}:${port} отклонил подключение`)
  if (err.code === "EHOSTUNREACH" || err.code === "ENETUNREACH" || err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") return new ModbusError("host_unreachable", `Адрес ${host} недоступен из сети шлюза`)
  if (err.code === "ETIMEDOUT") return new ModbusError("timeout", `Нет ответа от ${host}:${port}`)
  if (err.code === "ECONNRESET" || err.code === "EPIPE") return new ModbusError("connection_closed", "Устройство разорвало соединение")
  return new ModbusError("connection_error", err.message)
}

export const WORDS = { uint16: 1, int16: 1, uint32: 2, int32: 2, float32: 2, uint64: 4 }

/** Перестановка байт по порядку ABCD/CDAB/BADC/DCBA (A — старший байт первого регистра). */
export function reorder(bytes, wordOrder) {
  const out = Buffer.from(bytes)
  const words = bytes.length / 2
  if (wordOrder === "CDAB" || wordOrder === "DCBA") {
    for (let i = 0; i < words; i += 1) bytes.copy(out, (words - 1 - i) * 2, i * 2, i * 2 + 2)
  }
  if (wordOrder === "BADC" || wordOrder === "DCBA") {
    for (let i = 0; i < out.length; i += 2) {
      const t = out[i]
      out[i] = out[i + 1]
      out[i + 1] = t
    }
  }
  return out
}

export function decode(bytes, dataType, wordOrder = "ABCD") {
  const b = reorder(bytes, wordOrder)
  switch (dataType) {
    case "uint16": return b.readUInt16BE(0)
    case "int16": return b.readInt16BE(0)
    case "uint32": return b.readUInt32BE(0)
    case "int32": return b.readInt32BE(0)
    case "float32": return b.readFloatBE(0)
    case "uint64": {
      const v = b.readBigUInt64BE(0)
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ModbusError("bad_data_type", "Значение uint64 больше 2^53")
      return Number(v)
    }
    default: throw new ModbusError("bad_data_type", `Тип ${dataType} не поддерживается`)
  }
}

/** Чтение и декодирование одного регистра (или группы) с проверкой результата. */
export async function readValue(client, unitId, spec) {
  const words = WORDS[spec.dataType]
  if (!words) throw new ModbusError("bad_data_type", `Тип ${spec.dataType} не поддерживается`)
  const raw = await client.readRegisters(unitId, spec.fn, spec.address, words)
  let value = decode(raw, spec.dataType, spec.wordOrder)
  if (!Number.isFinite(value)) throw new ModbusError("bad_data_type", "Неверный тип данных: значение не число (проверьте тип и порядок байт)", { hex: raw.toString("hex") })
  if (spec.scale != null) value *= spec.scale
  return { value, hex: raw.toString("hex") }
}
