"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BadgeCheck, Bell, CalendarDays, ExternalLink, Factory, FileText, FolderTree, HelpCircle, LayoutGrid, Loader2, MapPin, Monitor, Package, Printer, RefreshCw, ScanBarcode, Search, Smartphone, Tag, User, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { globalWmsSearch, listNotifications, markNotificationRead, parseExpiryNotificationItemCode, parseExpiryNotificationLotCode, syncExpiryStickerAlerts, type WmsGlobalSearchResult, type WmsNotificationRow } from "@/lib/wms-api"
import { ScannerDialog } from "@/components/wms/scanner-dialog"
import { CrptInfoDialog } from "@/components/wms/crpt-info-dialog"
import { SupportHeaderButton } from "@/components/wms/support-presence"
import { authRequestHeaders, clearAccessToken } from "@/lib/auth/client-token"
import { useWmsUpdateContext } from "@/components/wms-update-provider"
import { isWmsAdmin } from "@/lib/wms-admin"

const ENABLE_EXPIRY_ALERT_SYNC =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_WMS_ENABLE_EXPIRY_ALERT_SYNC === "1"

/**
 * Синхронизация сроков — фоновая задача на несколько секунд запросов к базе.
 * Запускаем её не чаще раза в 10 минут на вкладку и не ждём: список
 * уведомлений грузится параллельно.
 */
const EXPIRY_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000
let lastExpirySyncAt = 0

function kickExpiryAlertSync() {
  if (!ENABLE_EXPIRY_ALERT_SYNC) return
  const now = Date.now()
  if (now - lastExpirySyncAt < EXPIRY_SYNC_MIN_INTERVAL_MS) return
  lastExpirySyncAt = now
  void syncExpiryStickerAlerts().catch(() => {
    lastExpirySyncAt = 0
  })
}

interface HeaderProps {
  sidebarCollapsed?: boolean
}

function relativeTime(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return new Date(value).toLocaleDateString("ru-RU")
}

function resultIcon(type: WmsGlobalSearchResult["type"]) {
  if (type === "item") return Package
  if (type === "group") return FolderTree
  if (type === "location") return MapPin
  return FileText
}

function resultGroupLabel(type: WmsGlobalSearchResult["type"]) {
  if (type === "item") return "Номенклатура"
  if (type === "group") return "Группы"
  if (type === "location") return "Ячейки"
  return "Документы и действия"
}

export function Header({ sidebarCollapsed }: HeaderProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [notifications, setNotifications] = useState<WmsNotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [authUser, setAuthUser] = useState<{
    login: string
    fio: string
    position: string
    roleCodes?: string[]
  } | null>(null)
  const {
    isAdmin,
    localBuildId,
    release,
    updateAvailable,
    postponedUpdate,
    applying,
    applyUpdate,
    checkUpdates,
    refreshDismissed,
  } = useWmsUpdateContext()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [crptOpen, setCrptOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState("")
  const [paletteResults, setPaletteResults] = useState<WmsGlobalSearchResult[]>([])
  const [paletteLoading, setPaletteLoading] = useState(false)

  const notificationsInFlight = useRef(false)

  async function loadNotifications() {
    if (notificationsInFlight.current) return
    notificationsInFlight.current = true
    try {
      kickExpiryAlertSync()
      const data = await listNotifications(currentUserId ? { userId: currentUserId } : undefined)
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
      setCurrentUserId(data.currentUserId)
    } catch {
      setNotifications([])
      setUnreadCount(0)
    } finally {
      notificationsInFlight.current = false
    }
  }

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store", headers: authRequestHeaders() })
      .then(async (res) => {
        if (!res.ok) return null
        const data = (await res.json()) as {
          user?: { login: string; fio: string; position: string; roleCodes?: string[] }
        }
        return data.user ?? null
      })
      .then((user) => {
        setAuthUser(user)
      })
      .catch(() => setAuthUser(null))
  }, [])

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined)
    clearAccessToken()
    window.location.assign("/login")
  }

  useEffect(() => {
    loadNotifications()
    const interval = window.setInterval(loadNotifications, 30000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId])

  function submitSearch() {
    const trimmed = (paletteQuery || query).trim()
    if (trimmed) router.push(`/search?query=${encodeURIComponent(trimmed)}`)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (!paletteOpen) return
    const q = paletteQuery.trim()
    const id = window.setTimeout(() => {
      setPaletteLoading(true)
      void globalWmsSearch({ query: q, limit: 40 })
        .then((data) => setPaletteResults(data.results ?? []))
        .catch(() => setPaletteResults([]))
        .finally(() => setPaletteLoading(false))
    }, q.length > 0 && q.length < 2 ? 120 : 220)
    return () => window.clearTimeout(id)
  }, [paletteOpen, paletteQuery])

  const groupedPaletteResults = useMemo(() => {
    const order: WmsGlobalSearchResult["type"][] = ["item", "group", "location", "document"]
    return order
      .map((type) => ({ type, rows: paletteResults.filter((row) => row.type === type) }))
      .filter((group) => group.rows.length > 0)
  }, [paletteResults])

  function openPalette(initialQuery = "") {
    setPaletteQuery(initialQuery)
    setQuery(initialQuery)
    setPaletteOpen(true)
  }

  function selectPaletteResult(row: WmsGlobalSearchResult) {
    setPaletteOpen(false)
    setQuery(row.title)
    router.push(row.href)
  }

  async function openNotification(notification: WmsNotificationRow) {
    if (notification.severity?.startsWith("expiry_")) {
      const itemCode = parseExpiryNotificationItemCode(notification.body)
      const lotCode = parseExpiryNotificationLotCode(notification.body)
      if (itemCode) {
        const qp = new URLSearchParams()
        if (lotCode) qp.set("lotCode", lotCode)
        const suffix = qp.toString() ? `?${qp.toString()}` : ""
        router.push(`/nomenclature/${encodeURIComponent(itemCode)}${suffix}`)
      }
      return
    }
    await markRead(notification)
  }

  async function markRead(notification: WmsNotificationRow) {
    if (!currentUserId || notification.readAt) return
    await markNotificationRead({ notificationId: notification.notificationId, userId: currentUserId }).catch(() => undefined)
    await loadNotifications()
  }

  function notificationPreview(body: string): string {
    return body
      .split("\n")
      .filter((line) => !line.startsWith("itemCode:") && !line.startsWith("lotCode:"))
      .join("\n")
  }

  return (
    <header
      className={`isolate fixed right-0 top-0 z-30 flex h-16 items-center justify-between overflow-hidden border-b border-border/45 px-6 shadow-sm transition-all duration-300 ${
        sidebarCollapsed ? "left-16" : "left-64"
      }`}
    >
      {/* Светлое полупрозрачное «стекло» (как изначально просили): карточный фон + blur, без тёмной плашки */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[color-mix(in_oklch,var(--card)_88%,transparent)] backdrop-blur-xl backdrop-saturate-150 [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.65)] dark:bg-[color-mix(in_oklch,var(--card)_78%,transparent)]"
        aria-hidden
      />
      <div className="relative flex h-full w-full items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => openPalette(e.target.value)}
              onFocus={() => openPalette(query)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submitSearch()
                }
              }}
              placeholder="Поиск / Ctrl+K"
              className="rounded-xl border-0 bg-card pl-10 pr-16 shadow-sm"
              suppressHydrationWarning
            />
            <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground md:inline-flex">
              Ctrl K
            </span>
          </div>
          <Button
            variant="outline"
            className="rounded-xl"
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Открыть сканер"
          >
            <ScanBarcode className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            type="button"
            onClick={() => setCrptOpen(true)}
            aria-label="Проверка кода в Честном знаке"
            title="Проверка кода в ЧЗ"
          >
            <BadgeCheck className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <SupportHeaderButton />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => router.push("/help")}
            aria-label="Открыть справку"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Панели и терминалы"
                title="Панели и терминалы"
              >
                <LayoutGrid className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Операторские панели</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => router.push("/production-calendar")}>
                <CalendarDays className="h-4 w-4" />
                APS · план выпуска
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/marking/label-orders")}>
                <Printer className="h-4 w-4" />
                Заказы кодов
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>POS и терминалы</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => window.open("/pos-terminal", "_blank", "noopener,noreferrer")}>
                <Monitor className="h-4 w-4" />
                POS-терминал
                <ExternalLink className="text-muted-foreground ml-auto h-3.5 w-3.5" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open("/pos-terminal/car", "_blank", "noopener,noreferrer")}>
                <ScanBarcode className="h-4 w-4" />
                POS авто (ЗИП)
                <ExternalLink className="text-muted-foreground ml-auto h-3.5 w-3.5" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open("/mobile/production", "_blank", "noopener,noreferrer")}>
                <Factory className="h-4 w-4" />
                Списание с линии (ТСД)
                <ExternalLink className="text-muted-foreground ml-auto h-3.5 w-3.5" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/terminals")}>
                <Smartphone className="h-4 w-4" />
                Терминалы ТСД
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground ring-2 ring-background">
                    {unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Уведомления</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <DropdownMenuItem className="py-3 text-sm text-muted-foreground">Нет уведомлений</DropdownMenuItem>
            ) : notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.notificationId}
                className="flex flex-col items-start gap-1 py-3"
                onClick={() => void openNotification(notification)}
              >
                <span className="font-medium">{notification.title}</span>
                <span className="whitespace-pre-line text-xs text-muted-foreground">
                  {notificationPreview(notification.body)}
                </span>
                <span className="text-xs text-muted-foreground">{relativeTime(notification.createdAt)}{notification.readAt ? "" : " · новое"}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu
          onOpenChange={(next) => {
            if (next) {
              refreshDismissed()
              void checkUpdates()
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 rounded-xl pl-2 pr-3 hover:bg-secondary">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background">
                <User className="h-4 w-4" />
              </div>
              <div className="hidden text-left md:block">
                <p className="text-sm font-medium">{authUser?.fio || "Оператор"}</p>
                <p className="text-xs text-muted-foreground">{authUser?.position || authUser?.login || "WMS"}</p>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Мой аккаунт</DropdownMenuLabel>
            {(isAdmin || isWmsAdmin(authUser?.roleCodes)) && localBuildId ? (
              <>
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  <div>
                    Версия: <span className="font-mono text-foreground">{localBuildId}</span>
                  </div>
                  {updateAvailable && release ? (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-2 py-2">
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-emerald-800">
                          {postponedUpdate ? "Отложено" : "Доступно"}
                        </div>
                        <div className="truncate font-mono text-xs text-foreground">{release.buildId}</div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 shrink-0 rounded-lg px-2.5"
                        disabled={applying}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          void applyUpdate()
                        }}
                      >
                        {applying ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            Обновить
                          </>
                        )}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onClick={() => router.push("/settings")}>Настройки</DropdownMenuItem>
            {(isAdmin || isWmsAdmin(authUser?.roleCodes)) ? (
              <>
                <DropdownMenuItem onClick={() => router.push("/admin/notifications")}>
                  Уведомления
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/admin/calendar-rules")}>
                  Правила календаря
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()}>Выйти</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <ScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={({ code, mode }) => {
          // В режиме "Инфо" — сразу уводим в поиск по строке.
          if (mode === "info" && code.trim()) {
            router.push(`/search?query=${encodeURIComponent(code.trim())}`)
          }
        }}
      />
      <CrptInfoDialog open={crptOpen} onOpenChange={setCrptOpen} />
      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-3xl" showCloseButton>
          <DialogHeader className="sr-only">
            <DialogTitle>Глобальный поиск WMS</DialogTitle>
            <DialogDescription>
              Поиск по номенклатуре, группам, ячейкам, документам и быстрым действиям.
            </DialogDescription>
          </DialogHeader>
          <Command shouldFilter={false} className="rounded-2xl">
            <CommandInput
              value={paletteQuery}
              onValueChange={(v) => {
                setPaletteQuery(v)
                setQuery(v)
              }}
              placeholder="Номенклатура, группа, ячейка, документ или действие..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && paletteResults.length === 0 && paletteQuery.trim()) {
                  e.preventDefault()
                  setPaletteOpen(false)
                  router.push(`/search?query=${encodeURIComponent(paletteQuery.trim())}`)
                }
              }}
            />
            <CommandList className="max-h-[560px]">
              <CommandEmpty>
                {paletteLoading ? "Ищу..." : paletteQuery.trim() ? "Ничего не найдено" : "Начните вводить запрос"}
              </CommandEmpty>
              {groupedPaletteResults.map((group) => (
                <CommandGroup key={group.type} heading={resultGroupLabel(group.type)}>
                  {group.rows.map((row) => {
                    const Icon = resultIcon(row.type)
                    return (
                      <CommandItem
                        key={row.id}
                        value={`${row.title} ${row.subtitle} ${row.badge ?? ""}`}
                        onSelect={() => selectPaletteResult(row)}
                        className="items-start gap-3"
                      >
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">{row.title}</div>
                          <div className="line-clamp-2 text-xs text-muted-foreground">{row.subtitle}</div>
                        </div>
                        {row.badge ? <CommandShortcut>{row.badge}</CommandShortcut> : null}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
              {paletteQuery.trim() ? (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Расширенный поиск">
                    <CommandItem
                      value={`open full search ${paletteQuery}`}
                      onSelect={() => {
                        setPaletteOpen(false)
                        router.push(`/search?query=${encodeURIComponent(paletteQuery.trim())}`)
                      }}
                    >
                      <Zap className="h-4 w-4" />
                      <span>Открыть полный поиск по «{paletteQuery.trim()}»</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </header>
  )
}
