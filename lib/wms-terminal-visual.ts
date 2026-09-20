import { isPrintTerminal } from "@/lib/wms/device-kind"
import type { WmsDeviceRow } from "@/lib/wms-api"

/** Иллюстрация ТСД Zebra (страница «Терминалы»). */
export const WMS_ZEBRA_TERMINAL_IMAGE = "/wms/terminals/zebra-tsd.png" as const

function textFromInfo(info: unknown, key: string): string {
  if (!info || typeof info !== "object") return ""
  const v = (info as Record<string, unknown>)[key]
  return typeof v === "string" ? v : ""
}

/** Показываем брендовую картинку, если в карточке явно Zebra (deviceInfo или имя). */
export function resolveTerminalHeroVisual(row: WmsDeviceRow): {
  src: string
  alt: string
  label: string
} | null {
  if (isPrintTerminal(row)) return null

  const manufacturer = textFromInfo(row.deviceInfo, "manufacturer").toLowerCase()
  const model = textFromInfo(row.deviceInfo, "model").toLowerCase()
  const preset = textFromInfo(row.deviceInfo, "preset").toLowerCase()
  const uid = (row.deviceUid ?? "").toLowerCase()
  const blob =
    `${manufacturer} ${model} ${preset} ${row.deviceName ?? ""} ${uid}`.toLowerCase()

  if (
    manufacturer.includes("zebra") ||
    preset.includes("zebra") ||
    uid.includes("zebra") ||
    /\bzebra\b/i.test(row.deviceName ?? "") ||
    /\btc2[16]\b/i.test(blob) ||
    /\btc5[0-9]\b/i.test(blob)
  ) {
    return {
      src: WMS_ZEBRA_TERMINAL_IMAGE,
      alt: "ТСД Zebra",
      label: "Zebra",
    }
  }

  return null
}
