import type { Body } from "./validate.ts"
import { dateKey, num, oneOf, reqStr, str, timestamp, uuid } from "./validate.ts"
import { RESOURCES, validateChannels, type MeterInput } from "../services/assets.ts"
import { badRequest } from "./errors.ts"

export function meterInputFromBody(body: Body): MeterInput {
  const connection = oneOf(body, "connection", "Способ подключения", ["manual", "modbus_tcp", "http_push"] as const)
  const initial = body.initialReadings
  if (initial != null && (typeof initial !== "object" || Array.isArray(initial))) throw badRequest("Начальные показания: объект код→значение")
  const initialReadings: Record<string, number> = {}
  for (const [k, v] of Object.entries((initial ?? {}) as Record<string, unknown>)) {
    if (v === "" || v == null) continue
    const n = Number(String(v).replace(",", "."))
    if (!Number.isFinite(n) || n < 0) throw badRequest(`Начальное показание ${k}: неотрицательное число`)
    initialReadings[k] = n
  }
  return {
    siteId: uuid(body, "siteId", "Объект", true)!,
    nodeId: uuid(body, "nodeId", "Узел"),
    resource: oneOf(body, "resource", "Ресурс", RESOURCES),
    name: reqStr(body, "name", "Название прибора", 120),
    serialNumber: str(body, "serialNumber", "Заводской номер", { max: 60 }),
    manufacturer: str(body, "manufacturer", "Производитель", { max: 80 }),
    model: str(body, "model", "Модель", { max: 80 }),
    catalogModelId: str(body, "catalogModelId", "Модель каталога", { max: 80 }),
    connection,
    gatewayId: uuid(body, "gatewayId", "Шлюз"),
    connectionParams: (body.connectionParams ?? {}) as Record<string, unknown>,
    pollIntervalSec: num(body, "pollIntervalSec", "Интервал опроса, с", { min: 5, max: 86400, integer: true }),
    telemetryTimeoutMin: num(body, "telemetryTimeoutMin", "Нет данных дольше, мин", { min: 15, max: 100000, integer: true }),
    installedAt: timestamp(body, "installedAt", "Дата установки"),
    verificationDue: dateKey(body, "verificationDue", "Дата поверки"),
    channels: validateChannels(body.channels, connection),
    initialReadings,
    status: body.status === "draft" ? "draft" : "active",
  }
}
