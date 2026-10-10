#!/usr/bin/env node
// ems-gateway enroll <код> | run | probe <host> <port> <unit> <fn> <address> <type> [порядок]
import path from "node:path"
import { Agent, loadJson } from "./agent.mjs"
import { ModbusTcpClient, readValue } from "./modbus.mjs"

const configPath = process.env.EMS_GATEWAY_CONFIG || "/etc/scada-ems-gateway/config.json"
const cfg = loadJson(configPath, {})
const options = {
  cloudUrl: process.env.EMS_CLOUD_URL || cfg.cloudUrl,
  dataDir: process.env.EMS_GATEWAY_DATA || cfg.dataDir || "/var/lib/scada-ems-gateway",
  bufferMaxBytes: Number(process.env.EMS_BUFFER_MAX_MB || cfg.bufferMaxMb || 200) * 1024 * 1024,
  allowInsecureHttp: process.env.EMS_ALLOW_INSECURE_HTTP === "1" || cfg.allowInsecureHttp === true,
  secretRotationDays: cfg.secretRotationDays ?? 30,
}

const [cmd, ...args] = process.argv.slice(2)

async function main() {
  if (cmd === "probe") {
    const [host, port, unit, fn, address, dataType, wordOrder] = args
    const client = new ModbusTcpClient({ host, port: Number(port), timeoutMs: 3000 })
    try {
      const r = await readValue(client, Number(unit), { fn: Number(fn), address: Number(address), dataType, wordOrder: wordOrder || "ABCD" })
      console.log(JSON.stringify(r))
    } finally {
      client.close()
    }
    return
  }
  if (!options.cloudUrl) throw new Error(`Не задан cloudUrl (${configPath} или EMS_CLOUD_URL)`)
  const agent = new Agent(options)
  if (cmd === "enroll") {
    if (!args[0]) throw new Error("Укажите код регистрации: ems-gateway enroll EMS-XXXX-XXXX-XXXX")
    const id = await agent.enroll(args[0])
    console.log(`Шлюз зарегистрирован: ${id}. Учётные данные: ${path.join(options.dataDir, "credentials.json")}`)
    return
  }
  if (cmd === "run") {
    process.on("SIGTERM", () => agent.stop())
    process.on("SIGINT", () => agent.stop())
    await agent.run()
    return
  }
  console.log("Использование: ems-gateway enroll <код> | run | probe <host> <port> <unit> <fn 3|4> <address> <type> [ABCD|CDAB|BADC|DCBA]")
  process.exitCode = 2
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
