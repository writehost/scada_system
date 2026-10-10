// Реестр способов подключения. «supported» ставится только адаптерам,
// которые реализованы и покрыты тестами в этом репозитории.

export type ConnectionKind = "manual" | "modbus_tcp" | "http_push"

export type ProtocolInfo = {
  code: string
  name: string
  status: "supported" | "planned"
  via: string
  note: string
}

export const PROTOCOLS: ProtocolInfo[] = [
  { code: "manual", name: "Ручной ввод", status: "supported", via: "Веб и мобильное приложение", note: "Для любых приборов без интерфейса." },
  { code: "modbus_tcp", name: "Modbus TCP", status: "supported", via: "SCADA EMS Gateway в локальной сети", note: "Функции 03/04, типы uint16/int16/uint32/int32/float32/uint64, порядок слов ABCD/CDAB/BADC/DCBA. Проверено на симуляторе протокола." },
  { code: "modbus_rtu", name: "Modbus RTU", status: "supported", via: "Преобразователь RS-485 ↔ Modbus TCP + Gateway", note: "Шлюз работает с преобразователем по Modbus TCP. Прямой опрос RS-485 агентом не реализован." },
  { code: "pulse", name: "Импульсный выход", status: "supported", via: "Импульсный модуль с Modbus TCP + Gateway", note: "Накопленное число импульсов × вес импульса, переполнение регистра учитывается." },
  { code: "http_push", name: "HTTP REST (push)", status: "supported", via: "Устройство отправляет показания само", note: "POST /api/ingest/v1/readings с токеном прибора, повторная доставка безопасна." },
  { code: "mqtt", name: "MQTT", status: "planned", via: "Брокер с TLS и ACL", note: "Спроектирован (топики, ACL, QoS 1, повторная доставка). Адаптер не реализован." },
  { code: "opc_ua", name: "OPC UA", status: "planned", via: "Gateway", note: "Не реализован." },
  { code: "mbus", name: "M-Bus", status: "planned", via: "Шлюз M-Bus", note: "Не реализован." },
]

export const CONNECTION_LABELS: Record<ConnectionKind, string> = {
  manual: "Ручной ввод",
  modbus_tcp: "Modbus TCP через шлюз",
  http_push: "HTTP push",
}

export type RegisterDataType = "uint16" | "int16" | "uint32" | "int32" | "float32" | "uint64"
export type WordOrder = "ABCD" | "CDAB" | "BADC" | "DCBA"

export type RegisterSpec = { fn: 3 | 4; address: number; dataType: RegisterDataType; wordOrder: WordOrder; scale?: number }

export const DATA_TYPE_WORDS: Record<RegisterDataType, number> = { uint16: 1, int16: 1, uint32: 2, int32: 2, float32: 2, uint64: 4 }

export function parseRegisterSpec(raw: unknown): RegisterSpec {
  const o = (raw ?? {}) as Record<string, unknown>
  const fn = Number(o.fn ?? 3)
  if (fn !== 3 && fn !== 4) throw new Error("Функция Modbus: 03 (holding) или 04 (input)")
  const address = Number(o.address)
  if (!Number.isInteger(address) || address < 0 || address > 65535) throw new Error("Адрес регистра: целое 0–65535")
  const dataType = String(o.dataType ?? "uint16") as RegisterDataType
  if (!(dataType in DATA_TYPE_WORDS)) throw new Error("Тип данных регистра не поддерживается")
  if (address + DATA_TYPE_WORDS[dataType] - 1 > 65535) throw new Error("Регистр выходит за адресное пространство")
  const wordOrder = String(o.wordOrder ?? "ABCD") as WordOrder
  if (!["ABCD", "CDAB", "BADC", "DCBA"].includes(wordOrder)) throw new Error("Порядок байт: ABCD, CDAB, BADC или DCBA")
  const scale = o.scale == null || o.scale === "" ? undefined : Number(o.scale)
  if (scale != null && (!Number.isFinite(scale) || scale === 0)) throw new Error("Масштаб регистра: ненулевое число")
  return { fn: fn as 3 | 4, address, dataType, wordOrder, ...(scale != null ? { scale } : {}) }
}
