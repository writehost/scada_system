"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Headphones, LogOut, Radio, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { authRequestHeaders } from "@/lib/auth/client-token"
import type { SupportOnlineUser, SupportPeer } from "@/lib/wms/support-presence"

const CLIENT_KEY = "wms_support_client_id"
const FOLLOW_KEY = "wms_support_follow_client_id"

/**
 * Пульс при разделённом сеансе (ведут курсор) и в обычной работе. Обычный
 * интервал ещё и решает, как быстро хост узнает, что к нему подключились.
 */
const SHARED_BEAT_MS = 250
const IDLE_BEAT_MS = 3000

type SupportCtx = {
  openPanel: () => void
  onlineCount: number
  following: boolean
}

const SupportContext = createContext<SupportCtx>({
  openPanel: () => undefined,
  onlineCount: 0,
  following: false,
})

export function useSupportPresence() {
  return useContext(SupportContext)
}

function getClientId(): string {
  try {
    const existing = sessionStorage.getItem(CLIENT_KEY)
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing
    const id = `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`
    sessionStorage.setItem(CLIENT_KEY, id)
    return id
  } catch {
    return `c_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`
  }
}

function pageLabel(path: string): string {
  if (!path || path === "/") return "Главная"
  const clean = path.split("?")[0] || path
  const map: Record<string, string> = {
    "/documents": "Документы",
    "/warehouse/finished-goods": "Склад ГП",
    "/warehouse-stock/finished-goods": "Склад ГП",
    "/warehouse-stock/materials": "Склад материалов",
    "/warehouse-stock/ops": "Методы склада",
    "/virtual-warehouse/fg": "План ГП",
    "/virtual-warehouse": "Виртуальный склад",
    "/settings": "Настройки",
    "/cells": "Ячейки",
    "/nomenclature": "Номенклатура",
    "/attention": "Внимание",
    "/production-calendar": "APS",
  }
  if (map[clean]) return map[clean]
  const hit = Object.entries(map).find(([prefix]) => clean.startsWith(`${prefix}/`))
  if (hit) return hit[1]
  return clean
}

export function SupportPresenceRoot({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [online, setOnline] = useState<SupportOnlineUser[]>([])
  const [peers, setPeers] = useState<SupportPeer[]>([])
  const [selfId, setSelfId] = useState<string | null>(null)
  const [selfUserId, setSelfUserId] = useState<string | null>(null)
  const [followClientId, setFollowClientId] = useState<string | null>(null)
  const [hostName, setHostName] = useState<string | null>(null)
  const xyRef = useRef({ x: 0.5, y: 0.5 })
  const followRef = useRef<string | null>(null)
  const lastNavRef = useRef<string>("")
  const beatInFlight = useRef(false)
  const sharedRef = useRef(false)
  const panelOpenRef = useRef(false)

  const path = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(FOLLOW_KEY)
      if (saved) {
        followRef.current = saved
        setFollowClientId(saved)
      }
    } catch {
      /* ignore */
    }
    setSelfId(getClientId())
  }, [])

  const beat = useCallback(async () => {
    if (beatInFlight.current) return
    beatInFlight.current = true
    const clientId = getClientId()
    let res: Response
    try {
      res = await fetch("/api/wms/support/presence", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          ...authRequestHeaders({ "Content-Type": "application/json" }),
        },
        body: JSON.stringify({
          clientId,
          path,
          x: xyRef.current.x,
          y: xyRef.current.y,
          followClientId: followRef.current,
        }),
      })
    } finally {
      beatInFlight.current = false
    }
    if (!res.ok) return
    const data = (await res.json()) as {
      self: SupportPeer
      online: SupportOnlineUser[]
      peers: SupportPeer[]
      hostPath: string | null
    }
    setSelfUserId(data.self.userId)
    setOnline(data.online || [])
    setPeers(data.peers || [])
    sharedRef.current =
      followRef.current != null ||
      panelOpenRef.current ||
      (data.peers || []).some((peer) => peer.followClientId === clientId)
    if (followRef.current) {
      const host = data.peers.find((p) => p.clientId === followRef.current)
      setHostName(host?.displayName ?? null)
      const nextPath = data.hostPath
      if (nextPath && nextPath !== path && nextPath !== lastNavRef.current) {
        lastNavRef.current = nextPath
        router.push(nextPath)
      }
    } else {
      setHostName(null)
    }
  }, [path, router])

  useEffect(() => {
    let moving = false
    function onMove(e: MouseEvent) {
      const w = window.innerWidth || 1
      const h = window.innerHeight || 1
      xyRef.current = { x: e.clientX / w, y: e.clientY / h }
      moving = true
    }
    window.addEventListener("mousemove", onMove, { passive: true })
    /**
     * Частый пульс нужен только когда сеанс действительно разделён: курсор
     * ведут за кем-то или за нами. В обычной работе достаточно отметки
     * «на связи», иначе каждая вкладка шлёт по семь запросов в секунду.
     */
    const fast = window.setInterval(() => {
      if (document.hidden) return
      if (!sharedRef.current) return
      if (!moving && !followRef.current) return
      moving = false
      void beat()
    }, SHARED_BEAT_MS)
    const slow = window.setInterval(() => {
      if (document.hidden) return
      void beat()
    }, IDLE_BEAT_MS)
    void beat()
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.clearInterval(fast)
      window.clearInterval(slow)
    }
  }, [beat])

  useEffect(() => {
    panelOpenRef.current = open
    if (open) {
      sharedRef.current = true
      void beat()
    }
  }, [open, beat])

  function follow(clientId: string, displayName: string, nextPath: string) {
    followRef.current = clientId
    sharedRef.current = true
    setFollowClientId(clientId)
    setHostName(displayName)
    try {
      sessionStorage.setItem(FOLLOW_KEY, clientId)
    } catch {
      /* ignore */
    }
    setOpen(false)
    if (nextPath && nextPath !== path) router.push(nextPath)
    void beat()
  }

  function unfollow() {
    followRef.current = null
    setFollowClientId(null)
    setHostName(null)
    try {
      sessionStorage.removeItem(FOLLOW_KEY)
    } catch {
      /* ignore */
    }
    void beat()
  }

  const others = peers.filter((p) => p.clientId !== selfId)
  const othersHere = others.filter((p) => p.path.split("?")[0] === pathname)
  const onlineOthers = online.filter((u) => u.userId !== selfUserId)
  const ctx = useMemo<SupportCtx>(
    () => ({
      openPanel: () => setOpen(true),
      onlineCount: online.length,
      following: Boolean(followClientId),
    }),
    [online.length, followClientId]
  )

  return (
    <SupportContext.Provider value={ctx}>
      {children}

      {followClientId ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg">
          <Radio className="h-4 w-4 text-primary" />
          <span>
            Сессия с <span className="font-semibold">{hostName || "пользователем"}</span>
          </span>
          <Button type="button" size="sm" variant="outline" className="h-7 rounded-full" onClick={unfollow}>
            <LogOut className="mr-1 h-3.5 w-3.5" />
            Отключиться
          </Button>
        </div>
      ) : null}

      <div className="pointer-events-none fixed inset-0 z-[60]">
        {othersHere.map((peer) => (
          <div
            key={peer.clientId}
            className="absolute transition-[left,top] duration-75 ease-linear"
            style={{
              left: `${peer.x * 100}%`,
              top: `${peer.y * 100}%`,
            }}
          >
            <CursorMark name={peer.displayName} color={peer.color} />
          </div>
        ))}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[380px] sm:max-w-[380px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Онлайн в WMS
            </SheetTitle>
            <SheetDescription>
              Подключитесь к пользователю — откроется его страница, курсоры будут с именами. Оба можете нажимать кнопки.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2 px-4">
            {onlineOthers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Сейчас никого больше нет. Откройте WMS вторым пользователем в другом браузере.
              </p>
            ) : (
              onlineOthers.map((user) => (
                <div key={user.userId} className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: user.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{user.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {user.login} · {pageLabel(user.path)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0 rounded-lg"
                    onClick={() => follow(user.clientId, user.displayName, user.path)}
                  >
                    Войти
                  </Button>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </SupportContext.Provider>
  )
}

export function SupportHeaderButton() {
  const { openPanel, onlineCount, following } = useSupportPresence()
  return (
    <Button
      variant="ghost"
      className="relative gap-2 rounded-xl px-2 text-muted-foreground hover:text-foreground md:px-3"
      onClick={openPanel}
      aria-label="Поддержка: кто онлайн"
      title="Поддержка: кто онлайн"
    >
      <Headphones className="h-5 w-5" />
      <span className="hidden lg:inline">Поддержка</span>
      {onlineCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground ring-2 ring-background">
          {onlineCount}
        </span>
      ) : null}
      {following ? <span className="hidden h-1.5 w-1.5 rounded-full bg-emerald-500 md:inline" /> : null}
    </Button>
  )
}

function CursorMark({ name, color }: { name: string; color: string }) {
  return (
    <div className="flex items-start">
      <svg width="18" height="22" viewBox="0 0 18 22" fill="none" aria-hidden>
        <path d="M1.2 1.1 16.4 10.2 9.3 11.6 7.2 20.4 1.2 1.1Z" fill={color} stroke="#111" strokeWidth="1.1" />
      </svg>
      <span
        className="-ml-0.5 mt-3 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow"
        style={{ background: color }}
      >
        {name}
      </span>
    </div>
  )
}
