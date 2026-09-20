"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

/** Capacitor в WebView APK подставляет глобал; в dev-браузере его нет — импорт пакета не нужен. */
function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  try {
    return Boolean(cap?.isNativePlatform?.())
  } catch {
    return false
  }
}

/**
 * В нативном APK UI из `out/`: старт с `/` — редирект на мобильный поток ТСД.
 */
export function TsdCapacitorRedirect() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    try {
      if (!isCapacitorNative()) return
      if (pathname !== "/" && pathname !== "") return
      router.replace("/mobile/")
    } catch {
      /* ignore */
    }
  }, [pathname, router])

  return null
}
