/** Тип устройства на странице «Терминалы». Без импорта `pg` — можно звать из UI. */

export const PRINT_TERMINAL_PLATFORM = "print-terminal"
export const PRINT_TERMINAL_UID_PREFIX = "print:"

export type DeviceKindHint = {
  deviceUid?: string | null
  platform?: string | null
  deviceInfo?: unknown
  deviceName?: string | null
}

function textFromInfo(info: unknown, key: string): string {
  if (!info || typeof info !== "object") return ""
  const value = (info as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

export function rawPrintTerminalId(deviceUid: string): string {
  const uid = deviceUid.trim()
  if (uid.toLowerCase().startsWith(PRINT_TERMINAL_UID_PREFIX)) {
    return uid.slice(PRINT_TERMINAL_UID_PREFIX.length)
  }
  return uid
}

export function printTerminalUid(rawDeviceId: string): string {
  const raw = rawDeviceId.trim()
  if (!raw) return ""
  if (raw.toLowerCase().startsWith(PRINT_TERMINAL_UID_PREFIX)) return raw
  return `${PRINT_TERMINAL_UID_PREFIX}${raw}`
}

export function printTerminalDisplayName(rawDeviceId: string): string {
  const raw = rawPrintTerminalId(rawDeviceId) || rawDeviceId.trim()
  return raw ? `Печатный терминал · ${raw}` : "Печатный терминал"
}

/** Достаёт id планшета из origin_detail заказа кодов или из uid. */
export function parsePrintTerminalRawId(text: string): string {
  const value = String(text || "").trim()
  if (!value) return ""
  if (value.toLowerCase().startsWith(PRINT_TERMINAL_UID_PREFIX)) {
    return rawPrintTerminalId(value)
  }
  const tablet = value.match(/tablet-[\da-f]+/i)
  if (tablet) return tablet[0]
  const prefixed = value.match(
    /^(?:тсд|печатный терминал|терминал печати)\s*[·:\-—–]?\s*(.+)$/i
  )
  if (prefixed) {
    const rest = prefixed[1].trim()
    if (rest && rest.length <= 80 && !/^тсд$/i.test(rest)) return rest
  }
  return ""
}

export function isPrintTerminal(row: DeviceKindHint): boolean {
  const uid = (row.deviceUid || "").trim()
  const platform = (row.platform || "").trim().toLowerCase()
  if (uid.toLowerCase().startsWith(PRINT_TERMINAL_UID_PREFIX)) return true
  if (
    platform === PRINT_TERMINAL_PLATFORM ||
    platform === "printer" ||
    platform === "print" ||
    platform === "printer-terminal"
  ) {
    return true
  }
  const kind = textFromInfo(row.deviceInfo, "kind").toLowerCase()
  if (kind === "print-terminal" || kind === "printer" || kind === "printer-terminal") {
    return true
  }
  const name = (row.deviceName || "").toLowerCase()
  if (name.includes("печатный терминал") || name.includes("терминал печати")) return true
  return false
}
