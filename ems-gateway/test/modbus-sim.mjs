// Симулятор устройства Modbus TCP для тестов и отладки мастера подключения.
// Отдаёт holding (03) и input (04) регистры, на неизвестный адрес — исключение 02.
import net from "node:net"
import { fileURLToPath } from "node:url"

export function startSimulator({ port = 0, unitId = 1, holding = {}, input = {}, silent = false } = {}) {
  const banks = { 3: new Map(Object.entries(holding).map(([k, v]) => [Number(k), v])), 4: new Map(Object.entries(input).map(([k, v]) => [Number(k), v])) }
  const state = { requests: 0, mute: false }
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0)
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 12) {
        const len = buf.readUInt16BE(4)
        if (buf.length < 6 + len) return
        const frame = buf.subarray(0, 6 + len)
        buf = buf.subarray(6 + len)
        state.requests += 1
        if (state.mute || silent) continue
        const tid = frame.readUInt16BE(0)
        const unit = frame[6]
        const fn = frame[7]
        const addr = frame.readUInt16BE(8)
        const count = frame.readUInt16BE(10)
        const reply = (pdu) => {
          const h = Buffer.alloc(7)
          h.writeUInt16BE(tid, 0)
          h.writeUInt16BE(0, 2)
          h.writeUInt16BE(pdu.length + 1, 4)
          h[6] = unit
          sock.write(Buffer.concat([h, pdu]))
        }
        if (unit !== unitId) continue // чужой unit — устройство молчит
        if (fn !== 3 && fn !== 4) {
          reply(Buffer.from([fn | 0x80, 1]))
          continue
        }
        const bank = banks[fn]
        const data = Buffer.alloc(count * 2)
        let ok = true
        for (let i = 0; i < count; i += 1) {
          const v = bank.get(addr + i)
          if (v === undefined) {
            ok = false
            break
          }
          data.writeUInt16BE(v & 0xffff, i * 2)
        }
        if (!ok) reply(Buffer.from([fn | 0x80, 2]))
        else reply(Buffer.concat([Buffer.from([fn, data.length]), data]))
      }
    })
    sock.on("error", () => undefined)
  })
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const api = {
        port: server.address().port,
        state,
        /** Записать 32-битное значение (float32/uint32) в два регистра, порядок ABCD. */
        setFloat(fn, address, value) {
          const b = Buffer.alloc(4)
          b.writeFloatBE(value)
          banks[fn].set(address, b.readUInt16BE(0))
          banks[fn].set(address + 1, b.readUInt16BE(2))
        },
        setUint32(fn, address, value) {
          banks[fn].set(address, (value >>> 16) & 0xffff)
          banks[fn].set(address + 1, value & 0xffff)
        },
        close: () => new Promise((r) => server.close(() => r())),
      }
      resolve(api)
    })
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Ручной запуск: электросчётчик (input 0..1 — энергия float32, 2..3 — мощность) и импульсный счётчик (holding 0..1 uint32).
  const sim = await startSimulator({ port: Number(process.env.PORT || 1502) })
  let energy = 12345.6
  let pulses = 10000
  sim.setFloat(4, 0, energy)
  sim.setFloat(4, 2, 1.8)
  sim.setUint32(3, 0, pulses)
  setInterval(() => {
    energy += 0.03
    pulses += 2
    sim.setFloat(4, 0, energy)
    sim.setFloat(4, 2, 1.5 + Math.random())
    sim.setUint32(3, 0, pulses)
  }, 5000)
  console.log(`Modbus TCP simulator on 127.0.0.1:${sim.port}`)
}
