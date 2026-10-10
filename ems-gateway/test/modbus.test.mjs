import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import net from "node:net"
import { ModbusTcpClient, decode, readValue } from "../src/modbus.mjs"
import { startSimulator } from "./modbus-sim.mjs"

let sim
before(async () => {
  sim = await startSimulator({ unitId: 7, holding: { 10: 0x1234, 11: 0xfff6 } })
  sim.setFloat(4, 0, 12345.5)
  sim.setUint32(3, 100, 4000000000)
})
after(async () => sim.close())

test("decodes all supported types and word orders", () => {
  const f = Buffer.alloc(4)
  f.writeFloatBE(1.5)
  assert.equal(decode(f, "float32", "ABCD"), 1.5)
  const cdab = Buffer.from([f[2], f[3], f[0], f[1]])
  assert.equal(decode(cdab, "float32", "CDAB"), 1.5)
  const badc = Buffer.from([f[1], f[0], f[3], f[2]])
  assert.equal(decode(badc, "float32", "BADC"), 1.5)
  const dcba = Buffer.from([f[3], f[2], f[1], f[0]])
  assert.equal(decode(dcba, "float32", "DCBA"), 1.5)
  assert.equal(decode(Buffer.from([0xff, 0xf6]), "int16"), -10)
  assert.equal(decode(Buffer.from([0, 0, 0, 0, 0, 0, 1, 0]), "uint64"), 256)
})

test("reads input float32 and holding uint32 over TCP", async () => {
  const c = new ModbusTcpClient({ host: "127.0.0.1", port: sim.port, timeoutMs: 1000 })
  try {
    assert.equal((await readValue(c, 7, { fn: 4, address: 0, dataType: "float32", wordOrder: "ABCD" })).value, 12345.5)
    assert.equal((await readValue(c, 7, { fn: 3, address: 100, dataType: "uint32", wordOrder: "ABCD", scale: 0.001 })).value, 4000000)
    assert.equal((await readValue(c, 7, { fn: 3, address: 11, dataType: "int16", wordOrder: "ABCD" })).value, -10)
  } finally {
    c.close()
  }
})

test("illegal register address maps to a clear error", async () => {
  const c = new ModbusTcpClient({ host: "127.0.0.1", port: sim.port, timeoutMs: 1000 })
  try {
    await assert.rejects(readValue(c, 7, { fn: 3, address: 500, dataType: "uint16" }), (e) => e.code === "illegal_address" && /Неправильный адрес регистра/.test(e.message))
  } finally {
    c.close()
  }
})

test("wrong unit id → device does not respond (timeout)", async () => {
  const c = new ModbusTcpClient({ host: "127.0.0.1", port: sim.port, timeoutMs: 300 })
  try {
    await assert.rejects(readValue(c, 99, { fn: 3, address: 10, dataType: "uint16" }), (e) => e.code === "timeout")
  } finally {
    c.close()
  }
})

test("closed port → connection refused", async () => {
  const srv = net.createServer()
  await new Promise((r) => srv.listen(0, "127.0.0.1", r))
  const port = srv.address().port
  await new Promise((r) => srv.close(r))
  const c = new ModbusTcpClient({ host: "127.0.0.1", port, timeoutMs: 1000 })
  await assert.rejects(readValue(c, 1, { fn: 3, address: 0, dataType: "uint16" }), (e) => e.code === "connection_refused")
})

test("NaN from wrong data type is reported, not stored", async () => {
  sim.setUint32(3, 200, 0x7fc00000) // битовый NaN как float32
  const c = new ModbusTcpClient({ host: "127.0.0.1", port: sim.port, timeoutMs: 1000 })
  try {
    await assert.rejects(readValue(c, 7, { fn: 3, address: 200, dataType: "float32" }), (e) => e.code === "bad_data_type")
  } finally {
    c.close()
  }
})

test("client reconnects after the device drops the connection", async () => {
  const c = new ModbusTcpClient({ host: "127.0.0.1", port: sim.port, timeoutMs: 1000 })
  try {
    await readValue(c, 7, { fn: 3, address: 10, dataType: "uint16" })
    c.socket.destroy()
    assert.equal((await readValue(c, 7, { fn: 3, address: 10, dataType: "uint16" })).value, 0x1234)
  } finally {
    c.close()
  }
})
