"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useWmsUpdate } from "@/hooks/use-wms-update"

type WmsUpdateContextValue = ReturnType<typeof useWmsUpdate>

const WmsUpdateContext = createContext<WmsUpdateContextValue | null>(null)

const ENABLE_UPDATE =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_WMS_ENABLE_UPDATE_NOTIFIER === "1"

export function WmsUpdateProvider({ children }: { children: ReactNode }) {
  const value = useWmsUpdate({ enabled: ENABLE_UPDATE, poll: ENABLE_UPDATE })
  return <WmsUpdateContext.Provider value={value}>{children}</WmsUpdateContext.Provider>
}

export function useWmsUpdateContext(): WmsUpdateContextValue {
  const ctx = useContext(WmsUpdateContext)
  if (!ctx) {
    throw new Error("useWmsUpdateContext must be used within WmsUpdateProvider")
  }
  return ctx
}
