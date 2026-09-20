"use client"

import { useState, useEffect, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  ClipboardList,
  ClipboardCheck,
  User,
  Wifi,
  WifiOff,
  Battery,
  Signal,
} from "lucide-react"
import { MobileNavProvider, useMobileNav } from "./mobile-nav-provider"
import { MobileScanDatamatrixIcon } from "./mobile-scan-datamatrix-icon"

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileNavProvider>
      <MobileLayoutInner>{children}</MobileLayoutInner>
    </MobileNavProvider>
  )
}

function MobileLayoutInner({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { visibility } = useMobileNav()
  const isMobileHome = pathname === "/mobile"
  const [isOnline, setIsOnline] = useState(true)
  const [isSynced, setIsSynced] = useState(false)
  const [currentTime, setCurrentTime] = useState("")

  const navItemsLeft = [
    { href: "/mobile", icon: LayoutDashboard, label: "Главная" },
    ...(visibility.tasks
      ? [{ href: "/mobile/tasks" as const, icon: ClipboardList, label: "Задачи" }]
      : []),
  ]

  const navItemsRight = [
    ...(visibility.revision
      ? [{ href: "/mobile/revision" as const, icon: ClipboardCheck, label: "Ревизия" }]
      : []),
    { href: "/mobile/profile", icon: User, label: "Профиль" },
  ]

  useEffect(() => {
    const synced = localStorage.getItem("tsd_synced") === "true"
    setIsSynced(synced)

    const updateTime = () => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }))
    }
    updateTime()
    const interval = setInterval(updateTime, 1000)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      clearInterval(interval)
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [pathname])

  if (pathname === "/mobile/sync" || pathname === "/mobile/scan") {
    return <>{children}</>
  }

  return (
    <div className="tsd-light-root flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-50 flex h-8 shrink-0 items-center justify-between bg-foreground px-4 text-background">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span>{currentTime}</span>
        </div>
        <div className="flex items-center gap-2">
          {isOnline ? (
            <Wifi className="h-3.5 w-3.5" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-destructive" />
          )}
          <Signal className="h-3.5 w-3.5" />
          <Battery className="h-4 w-4" />
        </div>
      </div>

      {!isSynced && (
        <div className="shrink-0 border-b border-amber-500/35 bg-amber-500/10 px-3 py-2 text-center">
          <Link href="/mobile/sync" className="text-xs font-medium text-foreground underline-offset-2 hover:underline">
            Подключить к серверу WMS (необязательно)
          </Link>
        </div>
      )}

      <main
        className={cn(
          "min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]",
          isMobileHome
            ? "pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]"
            : "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
        )}
      >
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 overflow-visible bg-card shadow-lg">
        {isMobileHome ? (
          <div className="grid grid-cols-3 items-center gap-2 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
            <span className="min-w-0" aria-hidden />
            <div className="flex justify-center">
              {visibility.scan ? (
                <Link
                  href="/mobile/scan"
                  className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/30 transition active:scale-95"
                  aria-label="Сканировать"
                >
                  <MobileScanDatamatrixIcon className="h-7 w-7" />
                </Link>
              ) : (
                <span
                  className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
                  aria-hidden
                >
                  <MobileScanDatamatrixIcon className="h-7 w-7 opacity-40" />
                </span>
              )}
            </div>
            <div className="flex justify-end">
              <Link
                href="/mobile/profile"
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-xl transition-colors active:scale-95",
                  pathname.startsWith("/mobile/profile")
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                aria-label="Профиль"
              >
                <User className="h-6 w-6" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-11 items-end justify-around px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1">
            {navItemsLeft.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl px-3 py-1 transition-all",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                      isActive && "bg-primary"
                    )}
                  >
                    <item.icon
                      className={cn("h-[18px] w-[18px]", isActive && "text-primary-foreground")}
                    />
                  </div>
                  <span className="text-[10px] font-medium leading-tight">{item.label}</span>
                </Link>
              )
            })}

            {visibility.scan ? (
              <Link
                href="/mobile/scan"
                className="relative -top-[30px] flex flex-col items-center gap-0.5"
              >
                <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/35">
                  <MobileScanDatamatrixIcon className="h-[26px] w-[26px] text-primary-foreground" />
                </div>
                <span className="text-[10px] font-medium leading-none text-foreground">Скан</span>
              </Link>
            ) : (
              <div className="relative -top-[30px] w-[52px] shrink-0" aria-hidden />
            )}

            {navItemsRight.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl px-3 py-1 transition-all",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                      isActive && "bg-primary"
                    )}
                  >
                    <item.icon
                      className={cn("h-[18px] w-[18px]", isActive && "text-primary-foreground")}
                    />
                  </div>
                  <span className="text-[10px] font-medium leading-tight">{item.label}</span>
                </Link>
              )
            })}
          </div>
        )}
      </nav>
    </div>
  )
}
