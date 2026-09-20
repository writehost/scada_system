"use client"

import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"
import { 
  Search,
  Wifi,
  WifiOff,
  User,
  Clock,
  Settings,
  RefreshCw,
  LocateFixed,
  Smartphone,
  Printer,
  ClipboardCopy,
  ListChecks,
  Trash2,
  BellRing,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  assignDeviceUser,
  deleteWmsDevice,
  listDeviceTasks,
  listDevices,
  listUsers,
  loadDeviceEnrollState,
  registerWmsDevice,
  revokeDeviceToken,
  sendDeviceTestPush,
  type DeviceAuthMode,
  type DeviceTokenInfo,
  type WmsDeviceRow,
  type WmsTaskRow,
  type WmsUserRow,
} from "@/lib/wms-api"
import { resolveTerminalHeroVisual } from "@/lib/wms-terminal-visual"
import {
  isPrintTerminal,
  printTerminalDisplayName,
  printTerminalUid,
} from "@/lib/wms/device-kind"
import { DeviceSupportPanel } from "@/components/wms/device-support-panel"
import { DeviceEnrollDialog } from "@/components/wms/device-enroll-dialog"

const statusConfig = {
  online: { label: "Онлайн", color: "bg-success/10 text-success" },
  offline: { label: "Офлайн", color: "bg-destructive/10 text-destructive" },
  blocked: { label: "Заблокирован", color: "bg-secondary text-muted-foreground" },
}

/** Терминал считается онлайн, если присылал heartbeat в последние пять минут. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000

function deviceOnlineState(row: WmsDeviceRow): "online" | "offline" | "blocked" {
  const status = (row.deviceStatus || "").toLowerCase()
  if (status === "blocked" || status === "retired") return "blocked"
  const seen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0
  if (!seen || Number.isNaN(seen)) return "offline"
  return Date.now() - seen <= ONLINE_WINDOW_MS ? "online" : "offline"
}

function formatSeenShort(iso: string | null | undefined): string {
  if (!iso) return "нет связи"
  try {
    const at = new Date(iso).getTime()
    if (!Number.isFinite(at)) return "—"
    const delta = Date.now() - at
    if (delta < 60_000) return "только что"
    if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)} мин назад`
    if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))} ч назад`
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return "—"
  }
}

function taskPreviewLabel(t: WmsTaskRow): string {
  const name = (t.itemName || "").trim()
  const type = (t.taskType || "").trim()
  if (name && name.length <= 42) return name
  if (name) return `${name.slice(0, 40)}…`
  return type || "—"
}

export default function TerminalsPage() {
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [presenceFilter, setPresenceFilter] = useState<
    "all" | "online" | "offline" | "tasks" | "tsd" | "print"
  >("all")
  const [rows, setRows] = useState<WmsDeviceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({
    kind: "tsd" as "tsd" | "print",
    deviceUid: "",
    deviceName: "",
    platform: "android",
    appVersion: "",
    modelPreset: "",
    manufacturer: "",
    model: "",
    androidVersion: "",
    serialNumber: "",
  })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selected, setSelected] = useState<WmsDeviceRow | null>(null)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<WmsTaskRow[]>([])
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [users, setUsers] = useState<WmsUserRow[]>([])
  const [assignUserId, setAssignUserId] = useState("")
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [pushTestLoading, setPushTestLoading] = useState(false)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [deviceTokens, setDeviceTokens] = useState<Record<string, DeviceTokenInfo>>({})
  const [authMode, setAuthMode] = useState<DeviceAuthMode>("soft")
  const [tokenBusy, setTokenBusy] = useState(false)

  const loadEnrollState = useCallback(async () => {
    try {
      const data = await loadDeviceEnrollState()
      setDeviceTokens(data.devicesWithToken ?? {})
      setAuthMode(data.settings?.mode ?? "soft")
    } catch {
      setDeviceTokens({})
    }
  }, [])

  const load = useCallback(async (q?: string, silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await listDevices({ query: q?.trim() || "" })
      setRows(data.devices ?? [])
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : "Ошибка загрузки")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      void load(searchQuery)
    }, 120)
    return () => clearTimeout(t)
  }, [load, searchQuery])

  useEffect(() => {
    const tick = window.setInterval(() => {
      void load(searchQuery, true)
    }, 20_000)
    return () => window.clearInterval(tick)
  }, [load, searchQuery])

  const tsdRows = rows.filter((t) => !isPrintTerminal(t))
  const printRows = rows.filter((t) => isPrintTerminal(t))
  const onlineCount = rows.filter((t) => deviceOnlineState(t) === "online").length
  const offlineCount = rows.filter((t) => deviceOnlineState(t) !== "online").length
  const withTokenCount = tsdRows.filter((t) => Boolean(deviceTokens[t.deviceUid])).length
  const withoutTokenCount = tsdRows.length - withTokenCount
  const withTasksCount = tsdRows.filter((t) => (t.liveTaskCount ?? t.previewTasks?.length ?? 0) > 0).length
  const visibleRows = rows.filter((t) => {
    const state = deviceOnlineState(t)
    if (presenceFilter === "online") return state === "online"
    if (presenceFilter === "offline") return state !== "online"
    if (presenceFilter === "tasks") {
      return !isPrintTerminal(t) && (t.liveTaskCount ?? t.previewTasks?.length ?? 0) > 0
    }
    if (presenceFilter === "tsd") return !isPrintTerminal(t)
    if (presenceFilter === "print") return isPrintTerminal(t)
    return true
  })

  async function loadSelectedTasks(deviceUid: string) {
    setTasksLoading(true)
    setTasksError(null)
    try {
      const data = await listDeviceTasks({ deviceUid, limit: 50, admin: true })
      setTasks(data.tasks || [])
    } catch (e) {
      setTasks([])
      setTasksError(e instanceof Error ? e.message : "Не удалось загрузить задания терминала")
    } finally {
      setTasksLoading(false)
    }
  }

  function openDetails(row: WmsDeviceRow) {
    setSelected(row)
    setTasks([])
    setTasksError(null)
    setAssignError(null)
    setAssignUserId("")
    setDetailsOpen(true)
    if (!isPrintTerminal(row)) {
      void loadSelectedTasks(row.deviceUid)
    }
  }

  async function submitDeleteDevice() {
    if (!selected) return
    if (
      !confirm(
        `Удалить терминал «${selected.deviceName}» (${selected.deviceUid})? Назначения заданий на устройство будут сняты; записи в журнале сохранятся.`
      )
    ) {
      return
    }
    setDeleteLoading(true)
    try {
      await deleteWmsDevice({ deviceId: selected.deviceId })
      setDetailsOpen(false)
      setSelected(null)
      await load(searchQuery)
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось удалить терминал")
    } finally {
      setDeleteLoading(false)
    }
  }

  async function loadUsers() {
    try {
      const data = await listUsers()
      setUsers(data.users || [])
    } catch {
      setUsers([])
    }
  }

  useEffect(() => {
    void loadUsers()
    void loadEnrollState()
  }, [loadEnrollState])

  useEffect(() => {
    if (!selected) {
      setAssignUserId("")
      return
    }
    const found =
      users.find((u) => u.userId === selected.assignedUserId) ??
      users.find((u) => u.displayName === selected.assignedUser)
    setAssignUserId(found?.userId || "")
  }, [selected, users])

  async function submitAssignUser() {
    if (!selected) return
    setAssignLoading(true)
    setAssignError(null)
    try {
      await assignDeviceUser({
        deviceId: selected.deviceId,
        assignedUserId: assignUserId || null,
      })
      const data = await listDevices({ query: searchQuery?.trim() || "" })
      const updatedRows = data.devices ?? []
      setRows(updatedRows)
      const refreshed = updatedRows.find((r) => r.deviceId === selected.deviceId)
      if (refreshed) {
        setSelected(refreshed)
      }
      toast({
        title: "Оператор привязан",
        description: assignUserId
          ? "Устройство теперь возвращает этого оператора в /mobile/profile."
          : "Привязка оператора снята.",
      })
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : "Не удалось сохранить привязку пользователя")
    } finally {
      setAssignLoading(false)
    }
  }

  async function submitCreate() {
    if (!createForm.deviceUid.trim()) {
      setCreateError(createForm.kind === "print" ? "Укажите ID планшета" : "Укажите deviceUid")
      return
    }
    if (createForm.kind !== "print" && !createForm.deviceName.trim()) {
      setCreateError("Укажите deviceName")
      return
    }

    setCreateLoading(true)
    setCreateError(null)
    try {
      const rawUid = createForm.deviceUid.trim()
      const isPrint = createForm.kind === "print"
      await registerWmsDevice({
        deviceUid: isPrint ? printTerminalUid(rawUid) : rawUid,
        deviceName:
          createForm.deviceName.trim() ||
          (isPrint ? printTerminalDisplayName(rawUid) : rawUid),
        platform: isPrint ? "print-terminal" : createForm.platform.trim() || undefined,
        appVersion: createForm.appVersion.trim() || undefined,
        deviceInfo: isPrint
          ? { kind: "print-terminal", rawDeviceId: rawUid }
          : {
              manufacturer: createForm.manufacturer.trim() || undefined,
              model: createForm.model.trim() || undefined,
              androidVersion: createForm.androidVersion.trim() || undefined,
              serialNumber: createForm.serialNumber.trim() || undefined,
              preset: createForm.modelPreset.trim() || undefined,
            },
      })
      setCreateOpen(false)
      setCreateForm({
        kind: "tsd",
        deviceUid: "",
        deviceName: "",
        platform: "android",
        appVersion: "",
        modelPreset: "",
        manufacturer: "",
        model: "",
        androidVersion: "",
        serialNumber: "",
      })
      await load(searchQuery)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Не удалось зарегистрировать терминал")
    } finally {
      setCreateLoading(false)
    }
  }

  const selectedHero = selected ? resolveTerminalHeroVisual(selected) : null
  const selectedIsPrint = selected ? isPrintTerminal(selected) : false

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Терминалы</h1>
          <p className="text-sm text-muted-foreground">ТСД и печатные терминалы на площадке</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 rounded-lg py-1 text-[11px]",
              authMode === "strict"
                ? "border-success/40 text-success"
                : authMode === "soft"
                  ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                  : "border-destructive/40 text-destructive"
            )}
          >
            {authMode === "strict" ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            {authMode === "strict"
              ? "ТСД: только по токену"
              : authMode === "soft"
                ? "ТСД: мягкая проверка"
                : "ТСД: проверка выключена"}
          </Badge>
          <Button
            className="rounded-xl bg-primary text-primary-foreground"
            onClick={() => setEnrollOpen(true)}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Подключить терминал
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">Всего</div>
          <div className="text-2xl font-bold text-foreground">{rows.length}</div>
        </div>
        <button
          type="button"
          onClick={() => setPresenceFilter((v) => (v === "online" ? "all" : "online"))}
          className={cn(
            "rounded-2xl bg-card p-4 text-left shadow-sm",
            presenceFilter === "online" && "ring-1 ring-success/40"
          )}
        >
          <div className="text-sm text-muted-foreground">Онлайн</div>
          <div className="text-2xl font-bold text-success">{onlineCount}</div>
          <div className="text-[11px] text-muted-foreground">heartbeat за 5 минут</div>
        </button>
        <button
          type="button"
          onClick={() => setPresenceFilter((v) => (v === "offline" ? "all" : "offline"))}
          className={cn(
            "rounded-2xl bg-card p-4 text-left shadow-sm",
            presenceFilter === "offline" && "ring-1 ring-border"
          )}
        >
          <div className="text-sm text-muted-foreground">Офлайн</div>
          <div className="text-2xl font-bold text-muted-foreground">{offlineCount}</div>
        </button>
        <button
          type="button"
          onClick={() => setEnrollOpen(true)}
          className={cn(
            "rounded-2xl bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md",
            withoutTokenCount > 0 && "ring-1 ring-amber-500/40"
          )}
        >
          <div className="text-sm text-muted-foreground">Без токена</div>
          <div
            className={cn(
              "text-2xl font-bold",
              withoutTokenCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-success"
            )}
          >
            {withoutTokenCount}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {withoutTokenCount > 0 ? "только ТСД, без печатных" : "все ТСД по токену"}
          </div>
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или ID..."
            value={searchQuery}
            onChange={(e) => {
              const v = e.target.value
              setSearchQuery(v)
            }}
            className="rounded-xl bg-card pl-10 shadow-sm"
          />
        </div>
        <Button variant="outline" className="rounded-xl" onClick={() => void load(searchQuery)}>
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Обновить
        </Button>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `Все ${rows.length}`],
              ["tsd", `ТСД ${tsdRows.length}`],
              ["print", `Печать ${printRows.length}`],
              ["online", `Онлайн ${onlineCount}`],
              ["offline", `Офлайн ${offlineCount}`],
              ["tasks", `С заданиями ${withTasksCount}`],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={presenceFilter === key ? "default" : "outline"}
              className="h-8 rounded-lg"
              onClick={() => setPresenceFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Terminals Grid */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {error && (
          <div className="col-span-full rounded-xl bg-card p-4 shadow-sm text-destructive text-sm">
            {error}
          </div>
        )}
        {loading && rows.length === 0 && (
          <div className="col-span-full rounded-xl bg-card p-4 shadow-sm text-muted-foreground text-sm">
            Загрузка...
          </div>
        )}
        {!loading && visibleRows.length === 0 && !error && (
          <div className="col-span-full rounded-xl bg-card p-4 text-sm text-muted-foreground shadow-sm">
            {rows.length === 0
              ? "Терминалы ещё не регистрировались. Печатный терминал появится сам, когда планшет опросит очередь печати."
              : "Нет терминалов в этом фильтре."}
          </div>
        )}
        {visibleRows.map((terminal) => {
          const onlineState = deviceOnlineState(terminal)
          const online = onlineState === "online"
          const status = statusConfig[onlineState]
          const printTerminal = isPrintTerminal(terminal)
          const tokenInfo = printTerminal ? undefined : deviceTokens[terminal.deviceUid]
          const hero = resolveTerminalHeroVisual(terminal)
          const previewTasks = printTerminal ? [] : (terminal.previewTasks ?? [])
          const liveCount = printTerminal ? 0 : (terminal.liveTaskCount ?? previewTasks.length)
          const FallbackIcon = printTerminal ? Printer : Smartphone

          return (
            <div
              key={terminal.deviceId}
              className={cn(
                "rounded-xl border border-border/80 bg-card p-3 shadow-sm transition-all hover:shadow-md cursor-pointer",
                !online && "opacity-80"
              )}
              onClick={() => openDetails(terminal)}
            >
              <div className="flex gap-3">
                <div
                  className={cn(
                    "relative h-[7.25rem] w-[8.5rem] shrink-0 overflow-hidden rounded-xl bg-muted/50",
                    online ? "ring-1 ring-success/30" : "ring-1 ring-border"
                  )}
                >
                  {hero ? (
                    <Image
                      src={hero.src}
                      alt={hero.alt}
                      fill
                      className="object-contain p-1"
                      sizes="136px"
                    />
                  ) : (
                    <div
                      className={cn(
                        "flex h-full w-full items-center justify-center",
                        online ? "bg-success/10" : "bg-secondary"
                      )}
                    >
                      <FallbackIcon
                        className={cn("h-12 w-12", online ? "text-success" : "text-muted-foreground")}
                      />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold leading-tight text-foreground">
                        {terminal.deviceName}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "rounded-md px-1.5 py-0 text-[10px]",
                            printTerminal
                              ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
                              : "bg-secondary text-muted-foreground"
                          )}
                        >
                          {printTerminal ? "Печатный терминал" : "ТСД"}
                        </Badge>
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {terminal.deviceUid} · {printTerminal ? "очередь GSMT" : terminal.platform || "—"}
                      </div>
                      {terminal.assignedUser ? (
                        <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                          <User className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="truncate">{terminal.assignedUser}</span>
                          {(terminal.openTaskCount ?? 0) > 0 ? (
                            <span className="ml-1 shrink-0 rounded bg-secondary px-1 py-px text-[9px]">
                              {terminal.openTaskCount} откр.
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge variant="secondary" className={cn("rounded-md px-2 py-0 text-[10px]", status.color)}>
                        {online ? <Wifi className="mr-0.5 h-3 w-3" /> : <WifiOff className="mr-0.5 h-3 w-3" />}
                        {status.label}
                      </Badge>
                      {printTerminal ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 rounded-lg px-2 text-[11px]"
                          asChild
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link href="/marking/label-orders">
                            <Printer className="h-3.5 w-3.5" />
                            Заказы кодов
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 rounded-lg px-2 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation()
                            toast({
                              title: "Найти ТСД",
                              description:
                                "Команда на устройство появится после подключения серверного опроса или push. Пока используйте карточку и статус заданий.",
                            })
                          }}
                        >
                          <LocateFixed className="h-3.5 w-3.5" />
                          Найти ТСД
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {printTerminal ? (
                      <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/10 px-1 py-px text-sky-700 dark:text-sky-300">
                        <Printer className="h-3 w-3" />
                        без токена ТСД
                      </span>
                    ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded px-1 py-px",
                        tokenInfo
                          ? "bg-success/10 text-success"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      )}
                      title={
                        tokenInfo
                          ? `Токен ${tokenInfo.tokenHint}, выдал ${tokenInfo.issuedBy}`
                          : "Терминал работает без токена — подключите его по коду"
                      }
                    >
                      {tokenInfo ? (
                        <ShieldCheck className="h-3 w-3" />
                      ) : (
                        <ShieldAlert className="h-3 w-3" />
                      )}
                      {tokenInfo ? "токен" : "без токена"}
                    </span>
                    )}
                    <span className="inline-flex items-center gap-0.5">
                      <Clock className="h-3 w-3 opacity-70" />
                      {formatSeenShort(terminal.lastSeenAt)}
                    </span>
                    <span className="font-mono text-[10px] opacity-80">v{terminal.appVersion?.trim() || "—"}</span>
                  </div>
                </div>
              </div>

              <div className="mt-2 border-t border-border/70 pt-2">
                {printTerminal ? (
                  <>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Печать
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Планшет забирает задания из очереди GSMT. Это не ТСД — задания склада сюда не
                      назначаются.
                    </p>
                  </>
                ) : (
                  <>
                <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Задания</span>
                  {liveCount > 0 ? <span className="normal-case">{liveCount} открыто</span> : null}
                </div>
                {previewTasks.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Нет назначенных заданий</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead>
                        <tr className="border-b border-border/60 text-[10px] text-muted-foreground">
                          <th className="pb-1 pr-2 font-medium">Код</th>
                          <th className="pb-1 pr-2 font-medium">Название / тип</th>
                          <th className="pb-1 pr-2 font-medium">Статус</th>
                          <th className="pb-1 text-right font-medium"> </th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewTasks.map((t) => (
                          <tr key={t.taskId} className="border-b border-border/40 last:border-0">
                            <td className="py-1 pr-2 align-middle font-mono text-[10px]">{t.taskCode || `#${t.taskId}`}</td>
                            <td className="max-w-[9rem] py-1 pr-2 align-middle">
                              <span className="line-clamp-2 break-words">{taskPreviewLabel(t)}</span>
                            </td>
                            <td className="py-1 pr-2 align-middle text-[10px] text-muted-foreground">{t.taskStatus}</td>
                            <td className="py-1 align-middle text-right">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-6 rounded-md px-2 text-[10px]"
                                asChild
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Link href={`/tasks/${encodeURIComponent(t.taskId)}`}>Статус</Link>
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                  </>
                )}
              </div>

              <div className="mt-2 flex items-center justify-end border-t border-border/60 pt-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    openDetails(terminal)
                  }}
                  aria-label="Открыть детали терминала"
                >
                  <Settings className="mr-1 h-3.5 w-3.5" />
                  Карточка
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <Dialog open={detailsOpen} onOpenChange={(next) => !tasksLoading && !deleteLoading && setDetailsOpen(next)}>
        <DialogContent className="flex max-h-[min(92vh,920px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
            <DialogTitle>{selectedIsPrint ? "Печатный терминал" : "Терминал"}</DialogTitle>
            <DialogDescription>
              {selectedIsPrint
                ? "Планшет печати из очереди GSMT. Это не ТСД и токен склада ему не нужен."
                : "Детали устройства и очередь назначенных заданий."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          {!selected ? (
            <div className="text-sm text-muted-foreground">Терминал не выбран</div>
          ) : (
            <div className="grid gap-4">
              {selectedHero ? (
                <div className="flex justify-center">
                  <div className="relative h-40 w-full max-w-sm overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-border">
                    <Image
                      src={selectedHero.src}
                      alt={selectedHero.alt}
                      fill
                      className="object-contain p-3"
                      sizes="(max-width: 640px) 100vw, 24rem"
                      priority
                    />
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl bg-secondary/40 p-4">
                  <div className="text-xs text-muted-foreground">Имя</div>
                  <div className="font-medium text-foreground">{selected.deviceName}</div>
                </div>
                <div className="rounded-xl bg-secondary/40 p-4">
                  <div className="text-xs text-muted-foreground">UID</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-sm text-foreground">{selected.deviceUid}</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-lg"
                      onClick={() => void navigator.clipboard?.writeText(selected.deviceUid)}
                    >
                      <ClipboardCopy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-xl bg-secondary/40 p-4">
                  <div className="text-xs text-muted-foreground">Статус</div>
                  <div className="font-medium text-foreground">
                    {statusConfig[deviceOnlineState(selected)].label}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{selected.deviceStatus}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Последняя связь: {formatSeenShort(selected.lastSeenAt)}
                    {selected.lastSeenAt
                      ? ` · ${new Date(selected.lastSeenAt).toLocaleString("ru-RU")}`
                      : ""}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4">
                {selectedIsPrint ? (
                  <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                      <Printer className="h-4 w-4 text-sky-600" />
                      Очередь печати
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Терминал сам забирает задания с{" "}
                      <span className="font-mono">/gsmt/api/print-jobs/claim</span> раз в 20–25 секунд.
                      Заказы кодов смотрите в разделе «Заказы кодов», а не в заданиях ТСД.
                    </p>
                    <div className="mt-3">
                      <Button type="button" variant="outline" size="sm" className="rounded-xl" asChild>
                        <Link href="/marking/label-orders">Открыть заказы кодов</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                <div className="mb-4 rounded-xl border border-border/80 p-3">
                  <div className="mb-2 text-sm font-medium text-foreground">Оператор ТСД</div>
                  <div className="text-xs text-muted-foreground">
                    Этот пользователь будет автоматически возвращаться на ТСД через профиль устройства.
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={assignUserId}
                      onChange={(e) => setAssignUserId(e.target.value)}
                      disabled={assignLoading}
                    >
                      <option value="">Не назначен</option>
                      {users.map((u) => (
                        <option key={u.userId} value={u.userId}>
                          {u.displayName} ({u.login})
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      disabled={assignLoading}
                      onClick={() => void submitAssignUser()}
                    >
                      {assignLoading ? "Сохраняю..." : "Сохранить"}
                    </Button>
                  </div>
                  {assignError ? <div className="mt-2 text-xs text-destructive">{assignError}</div> : null}
                </div>
                )}

                {!selectedIsPrint ? (
                <>
                <div className="mb-4 rounded-xl border border-border/80 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    {deviceTokens[selected.deviceUid] ? (
                      <ShieldCheck className="h-4 w-4 text-success" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-amber-500" />
                    )}
                    Подключение по токену
                  </div>
                  {deviceTokens[selected.deviceUid] ? (
                    <>
                      <div className="text-xs text-muted-foreground">
                        Токен {deviceTokens[selected.deviceUid]!.tokenHint} выдан{" "}
                        {formatSeenShort(deviceTokens[selected.deviceUid]!.issuedAt)}
                        {deviceTokens[selected.deviceUid]!.issuedBy !== "—"
                          ? ` · ${deviceTokens[selected.deviceUid]!.issuedBy}`
                          : ""}
                        . Последнее обращение:{" "}
                        {formatSeenShort(deviceTokens[selected.deviceUid]!.lastUsedAt)}.
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-xl border-destructive text-destructive hover:bg-destructive/10"
                          disabled={tokenBusy}
                          onClick={() => {
                            if (!selected) return
                            if (
                              !confirm(
                                `Отозвать токен терминала «${selected.deviceName}»? Устройство перестанет работать до повторного подключения по коду.`
                              )
                            ) {
                              return
                            }
                            void (async () => {
                              setTokenBusy(true)
                              try {
                                await revokeDeviceToken(selected.deviceUid)
                                await loadEnrollState()
                                toast({
                                  title: "Токен отозван",
                                  description: "Выпустите новый код подключения и введите его на терминале.",
                                })
                              } catch (e) {
                                toast({
                                  title: "Не удалось отозвать токен",
                                  description: e instanceof Error ? e.message : "Ошибка сервера",
                                  variant: "destructive",
                                })
                              } finally {
                                setTokenBusy(false)
                              }
                            })()
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Отозвать токен
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Терминал работает по одному ID устройства, без секрета. Выпустите код подключения и
                        введите его на ТСД — устройство получит собственный токен.
                      </p>
                      <div className="mt-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-xl"
                          onClick={() => {
                            setDetailsOpen(false)
                            setEnrollOpen(true)
                          }}
                        >
                          <KeyRound className="mr-2 h-4 w-4" />
                          Выпустить код подключения
                        </Button>
                      </div>
                    </>
                  )}
                </div>

                <div className="mb-4 rounded-xl border border-border/80 bg-secondary/20 p-3">
                  <div className="mb-2 text-sm font-medium text-foreground">Проверка связи с ТСД</div>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Отправляет тестовое уведомление на терминал (приложение должно быть открыто или в фоне с включённым push).
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    disabled={pushTestLoading}
                    onClick={() => {
                      if (!selected) return
                      void (async () => {
                        setPushTestLoading(true)
                        try {
                          await sendDeviceTestPush({ deviceUid: selected.deviceUid })
                          toast({
                            title: "Тестовый push отправлен",
                            description: "На ТСД должно прийти уведомление в течение ~30 секунд.",
                          })
                        } catch (e) {
                          toast({
                            title: "Не удалось отправить push",
                            description: e instanceof Error ? e.message : "Ошибка сервера",
                            variant: "destructive",
                          })
                        } finally {
                          setPushTestLoading(false)
                        }
                      })()
                    }}
                  >
                    <BellRing className={cn("mr-2 h-4 w-4", pushTestLoading && "animate-pulse")} />
                    {pushTestLoading ? "Отправка…" : "Тестовый push на ТСД"}
                  </Button>
                </div>

                <DeviceSupportPanel deviceUid={selected.deviceUid} />

                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <ListChecks className="h-4 w-4" />
                    Задания терминала
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      asChild
                    >
                      <Link href={`/tasks?query=${encodeURIComponent(selected.deviceUid)}`}>Открыть задания</Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => void loadSelectedTasks(selected.deviceUid)}
                      disabled={tasksLoading}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Обновить
                    </Button>
                  </div>
                </div>

                {tasksError && (
                  <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                    {tasksError.toLowerCase().includes("internal error")
                      ? "Не удалось загрузить задания терминала (ошибка сервера). Обновите и проверьте backend-логи."
                      : tasksError}
                  </div>
                )}

                {tasksLoading ? (
                  <div className="text-sm text-muted-foreground">Загрузка заданий...</div>
                ) : tasks.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Назначенных заданий нет</div>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {tasks.map((t) => (
                      <div key={t.taskId} className="grid grid-cols-12 gap-3 p-3 text-sm">
                        <div className="col-span-3 font-mono text-foreground">{t.taskCode || `#${t.taskId}`}</div>
                        <div className="col-span-3 text-muted-foreground">{t.taskType}</div>
                        <div className="col-span-2 text-muted-foreground">{t.taskStatus}</div>
                        <div className="col-span-4 text-muted-foreground">
                          {(t.sourceLocationCode || "—")} → {(t.targetLocationCode || "—")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                </>
                ) : null}
              </div>
            </div>
          )}
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive/10"
              disabled={tasksLoading || deleteLoading || !selected}
              onClick={() => void submitDeleteDevice()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleteLoading ? "Удаление…" : "Удалить терминал"}
            </Button>
            <Button variant="outline" onClick={() => setDetailsOpen(false)} disabled={tasksLoading || deleteLoading}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeviceEnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        devicesTotal={tsdRows.length}
        devicesWithTokenCount={withTokenCount}
        onEnrolled={() => {
          void loadEnrollState()
          void load(searchQuery)
        }}
        onManualRegister={() => setCreateOpen(true)}
      />

      <Dialog open={createOpen} onOpenChange={(next) => !createLoading && setCreateOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить терминал</DialogTitle>
            <DialogDescription>
              ТСД подключается по коду в диалоге «Подключить терминал». Печатный терминал обычно появляется сам
              после опроса очереди печати — вручную заводите его только если планшет ещё молчит.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={createForm.kind === "tsd" ? "default" : "outline"}
                className="rounded-xl"
                disabled={createLoading}
                onClick={() =>
                  setCreateForm((prev) => ({ ...prev, kind: "tsd", platform: prev.platform || "android" }))
                }
              >
                <Smartphone className="mr-2 h-4 w-4" />
                ТСД
              </Button>
              <Button
                type="button"
                variant={createForm.kind === "print" ? "default" : "outline"}
                className="rounded-xl"
                disabled={createLoading}
                onClick={() =>
                  setCreateForm((prev) => ({
                    ...prev,
                    kind: "print",
                    platform: "print-terminal",
                    deviceName: prev.deviceName || "",
                  }))
                }
              >
                <Printer className="mr-2 h-4 w-4" />
                Печатный терминал
              </Button>
            </div>
            <label className="text-sm font-medium text-foreground">
              {createForm.kind === "print" ? "ID планшета" : "deviceUid"}
              <Input
                value={createForm.deviceUid}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, deviceUid: e.target.value }))}
                placeholder={createForm.kind === "print" ? "tablet-a404d857" : "scada-mobile-01"}
                disabled={createLoading}
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              {createForm.kind === "print" ? "имя" : "deviceName"}
              <Input
                value={createForm.deviceName}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, deviceName: e.target.value }))}
                placeholder={
                  createForm.kind === "print" ? "Печатный терминал · цех" : "ТСД отгрузки 01"
                }
                disabled={createLoading}
              />
            </label>
            {createForm.kind === "tsd" ? (
            <>
            <label className="text-sm font-medium text-foreground">
              platform (опционально)
              <Input
                value={createForm.platform}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, platform: e.target.value }))}
                placeholder="android"
                disabled={createLoading}
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              appVersion (опционально)
              <Input
                value={createForm.appVersion}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, appVersion: e.target.value }))}
                placeholder="0.1.0"
                disabled={createLoading}
              />
            </label>

            <div className="grid gap-3 rounded-xl border border-border p-3">
              <div className="text-xs font-medium text-muted-foreground">Информация о ТСД (опционально)</div>
              <label className="text-sm font-medium text-foreground">
                популярная модель (пресет)
                <Input
                  value={createForm.modelPreset}
                  onChange={(e) => {
                    const v = e.target.value
                    setCreateForm((prev) => {
                      // простые пресеты для быстрого старта
                      const preset = v.trim().toLowerCase()
                      const map: Record<string, { manufacturer: string; model: string; platform?: string }> = {
                        "zebra tc26": { manufacturer: "Zebra", model: "TC26" },
                        "zebra tc21": { manufacturer: "Zebra", model: "TC21" },
                        "zebra tc52": { manufacturer: "Zebra", model: "TC52" },
                        "zebra tc57": { manufacturer: "Zebra", model: "TC57" },
                        "zebra mc33": { manufacturer: "Zebra", model: "MC33" },
                        "zebra mc93": { manufacturer: "Zebra", model: "MC93" },
                        "honeywell ck65": { manufacturer: "Honeywell", model: "CK65" },
                        "honeywell ct60": { manufacturer: "Honeywell", model: "CT60" },
                        "datalogic memor 10": { manufacturer: "Datalogic", model: "Memor 10" },
                        "datalogic memor 11": { manufacturer: "Datalogic", model: "Memor 11" },
                        "sunmi l2k": { manufacturer: "SUNMI", model: "L2K" },
                        "newland n7": { manufacturer: "Newland", model: "N7" },
                      }
                      const hit = map[preset]
                      if (!hit) return { ...prev, modelPreset: v }
                      return {
                        ...prev,
                        modelPreset: v,
                        manufacturer: prev.manufacturer || hit.manufacturer,
                        model: prev.model || hit.model,
                      }
                    })
                  }}
                  placeholder="Zebra TC26 / Honeywell CT60 / Datalogic Memor 11..."
                  disabled={createLoading}
                  list="tsd-model-presets"
                />
                <datalist id="tsd-model-presets">
                  <option value="Zebra TC26" />
                  <option value="Zebra TC21" />
                  <option value="Zebra TC52" />
                  <option value="Zebra TC57" />
                  <option value="Zebra MC33" />
                  <option value="Zebra MC93" />
                  <option value="Honeywell CK65" />
                  <option value="Honeywell CT60" />
                  <option value="Datalogic Memor 10" />
                  <option value="Datalogic Memor 11" />
                  <option value="SUNMI L2K" />
                  <option value="Newland N7" />
                </datalist>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-foreground">
                  производитель
                  <Input
                    value={createForm.manufacturer}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, manufacturer: e.target.value }))}
                    placeholder="Zebra"
                    disabled={createLoading}
                  />
                </label>
                <label className="text-sm font-medium text-foreground">
                  модель
                  <Input
                    value={createForm.model}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, model: e.target.value }))}
                    placeholder="TC26"
                    disabled={createLoading}
                  />
                </label>
                <label className="text-sm font-medium text-foreground">
                  Android
                  <Input
                    value={createForm.androidVersion}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, androidVersion: e.target.value }))}
                    placeholder="12"
                    disabled={createLoading}
                  />
                </label>
                <label className="text-sm font-medium text-foreground">
                  серийный номер
                  <Input
                    value={createForm.serialNumber}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, serialNumber: e.target.value }))}
                    placeholder="S/N"
                    disabled={createLoading}
                  />
                </label>
              </div>
            </div>
            </>
            ) : (
              <p className="text-xs text-muted-foreground">
                UID сохранится как <span className="font-mono">print:{createForm.deviceUid.trim() || "…"}</span>
                . Планшет не требует кода ТСД.
              </p>
            )}

            {createError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {createError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
              Отмена
            </Button>
            <Button onClick={() => void submitCreate()} disabled={createLoading}>
              {createLoading ? "Сохранение..." : "Зарегистрировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
