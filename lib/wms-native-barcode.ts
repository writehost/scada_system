import { Capacitor, registerPlugin } from "@capacitor/core"
import type { PluginListenerHandle } from "@capacitor/core"

/** Совпадает с `BuildConfig.APPLICATION_ID + ".BARCODE"` в Android (см. capacitor `appId`). */
export const WMS_ANDROID_BARCODE_BROADCAST_ACTION = "com.scadatable.wms.BARCODE"

interface WmsBarcodeScannerPlugin {
  addListener(
    eventName: "barcodeScan",
    listener: (event: { code: string }) => void,
  ): Promise<PluginListenerHandle>
}

/** Только Android APK (Capacitor); в браузере — false. */
export function isAndroidNativeBarcodeAvailable(): boolean {
  return Capacitor.getPlatform() === "android"
}

/**
 * Слушатель штрихкода из нативного слоя (DataWedge / broadcast).
 * Action intent: `<applicationId>.BARCODE`, extra: `com.symbol.datawedge.data_string`.
 */
export async function addNativeBarcodeListener(
  onCode: (code: string) => void,
): Promise<{ remove: () => Promise<void> } | null> {
  if (!isAndroidNativeBarcodeAvailable()) return null
  const Plugin = registerPlugin<WmsBarcodeScannerPlugin>("WmsBarcodeScanner")
  const handle = await Plugin.addListener("barcodeScan", (e) => {
    const code = typeof e?.code === "string" ? e.code : ""
    if (code) onCode(code)
  })
  return { remove: () => handle.remove() }
}
