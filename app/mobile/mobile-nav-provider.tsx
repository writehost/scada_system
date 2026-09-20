"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { getWmsClientErrorMeta, getWmsMobileProfile } from "@/lib/wms-api"
import {
  getMobileNavVisibility,
  type MobileNavVisibility,
} from "@/lib/mobile-permissions"
import { clearDeviceToken } from "@/lib/wms/device-token-client"

type MobileNavContextValue = {
  visibility: MobileNavVisibility
  loading: boolean
  roleCodes: string[]
  /** Сервер недоступен (сеть / DNS / 5xx), но не «устройство не найдено» */
  serverUnreachable: boolean
  refresh: () => void
}

const defaultVisibility = getMobileNavVisibility([])

const MobileNavContext = createContext<MobileNavContextValue>({
  visibility: defaultVisibility,
  loading: true,
  roleCodes: [],
  serverUnreachable: false,
  refresh: () => {},
})

export function useMobileNav(): MobileNavContextValue {
  return useContext(MobileNavContext)
}

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [visibility, setVisibility] = useState<MobileNavVisibility>(defaultVisibility)
  const [loading, setLoading] = useState(true)
  const [roleCodes, setRoleCodes] = useState<string[]>([])
  const [serverUnreachable, setServerUnreachable] = useState(false)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (pathname === "/mobile/sync") {
      setLoading(false)
      setVisibility(defaultVisibility)
      setRoleCodes([])
      setServerUnreachable(false)
      return
    }

    const synced = typeof window !== "undefined" && localStorage.getItem("tsd_synced") === "true"
    if (!synced) {
      setLoading(false)
      setVisibility(defaultVisibility)
      setRoleCodes([])
      setServerUnreachable(false)
      return
    }

    const deviceUid = typeof window !== "undefined" ? localStorage.getItem("tsd_device_id") : null
    if (!deviceUid?.trim()) {
      setLoading(false)
      setVisibility(defaultVisibility)
      setRoleCodes([])
      setServerUnreachable(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setServerUnreachable(false)

    const operatorUserId = localStorage.getItem("tsd_operator_user_id") || undefined

    void getWmsMobileProfile({
      deviceUid,
      operatorUserId: operatorUserId?.trim() ? operatorUserId : null,
    })
      .then((p) => {
        if (cancelled) return
        setServerUnreachable(false)
        const codes = p.operator?.roles?.map((r) => r.code) ?? []
        setRoleCodes(codes)
        setVisibility(getMobileNavVisibility(codes))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const { code } = getWmsClientErrorMeta(e)
        if (code === "device_not_found" && pathname !== "/mobile/sync") {
          try {
            localStorage.removeItem("tsd_synced")
          } catch {
            /* ignore */
          }
          router.replace("/mobile/sync?reason=reregister")
          return
        }
        // Токен отозвали или включили строгий режим — терминал подключают заново по коду.
        if (
          (code === "device_token_invalid" || code === "device_token_required") &&
          pathname !== "/mobile/sync"
        ) {
          try {
            localStorage.removeItem("tsd_synced")
            clearDeviceToken()
          } catch {
            /* ignore */
          }
          router.replace("/mobile/sync?reason=token")
          return
        }
        setServerUnreachable(true)
        setRoleCodes([])
        setVisibility(getMobileNavVisibility([]))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [pathname, router, tick])

  const value = useMemo(
    () => ({ visibility, loading, roleCodes, serverUnreachable, refresh }),
    [visibility, loading, roleCodes, serverUnreachable, refresh]
  )

  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>
}
