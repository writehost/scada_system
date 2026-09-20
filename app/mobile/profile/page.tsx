"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  User,
  Smartphone,
  Wifi,
  WifiOff,
  HardDrive,
  Calendar,
  CheckCircle2,
  XCircle,
  RefreshCw,
  LogOut,
  ChevronRight,
  Server,
  ScanBarcode,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  getSiteCode,
  getWmsApiOrigin,
  getWmsMobileProfile,
  listDeviceTasks,
  logoutWmsUser,
  type WmsMobileProfileResponse,
  type WmsTaskRow,
} from "@/lib/wms-api"

interface DeviceInfo {
  terminalId: string
  terminalName: string
  model: string
  os: string
  appVersion: string
  lastSync: string
  serverUrl: string
  isOnline: boolean
}

function relativeTime(value?: string | null) {
  if (!value) return "—"
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return new Date(value).toLocaleDateString("ru-RU")
}

export default function MobileProfilePage() {
  const router = useRouter()
  const [isSyncing, setIsSyncing] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [vibrationEnabled, setVibrationEnabled] = useState(true)

  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [mobileProfile, setMobileProfile] = useState<WmsMobileProfileResponse | null>(null)
  const [deviceTasks, setDeviceTasks] = useState<WmsTaskRow[]>([])

  const [terminalId, setTerminalId] = useState("—")
  const [terminalName, setTerminalName] = useState("—")
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [serverUrl, setServerUrl] = useState("—")
  const [isOnline, setIsOnline] = useState(true)

  const todayStats = useMemo(() => {
    const total = deviceTasks.length
    const completed = deviceTasks.filter((t) => t.completedAt || (t.taskStatus || "").toLowerCase().includes("complete")).length
    return {
      tasksCompleted: completed,
      tasksTotal: total,
      scansCount: 0,
      errorsCount: 0,
    }
  }, [deviceTasks])

  const deviceInfo: DeviceInfo = useMemo(() => {
    const d = mobileProfile?.device
    return {
      terminalId,
      terminalName,
      model: d?.platform || "—",
      os: "web",
      appVersion: d?.appVersion || "interface",
      lastSync: relativeTime(lastSyncAt),
      serverUrl,
      isOnline,
    }
  }, [isOnline, lastSyncAt, mobileProfile?.device, serverUrl, terminalId, terminalName])

  async function load() {
    setProfileLoading(true)
    setProfileError(null)
    try {
      const uid =
        terminalId && terminalId !== "—" ? terminalId : localStorage.getItem("tsd_device_id") || ""
      const operatorOverride = localStorage.getItem("tsd_operator_user_id") || ""

      if (!uid || uid === "—") {
        setMobileProfile(null)
        setDeviceTasks([])
        setProfileError("Терминал не настроен. Пройдите /mobile/sync.")
        return
      }

      const [prof, tasks] = await Promise.all([
        getWmsMobileProfile({ deviceUid: uid, operatorUserId: operatorOverride || null }),
        listDeviceTasks({ deviceUid: uid, limit: 50 }),
      ])
      setMobileProfile(prof)
      setDeviceTasks(tasks.tasks || [])
    } catch (e) {
      setMobileProfile(null)
      setDeviceTasks([])
      setProfileError(e instanceof Error ? e.message : "Не удалось загрузить профиль")
    } finally {
      setProfileLoading(false)
    }
  }

  useEffect(() => {
    setTerminalId(localStorage.getItem("tsd_device_id") || "—")
    setTerminalName(localStorage.getItem("tsd_terminal_name") || "—")
    setLastSyncAt(localStorage.getItem("tsd_last_sync_at") || null)
    setServerUrl(getWmsApiOrigin() || window.location.origin || "—")
    setIsOnline(navigator.onLine)
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    void load()
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSync = async () => {
    setIsSyncing(true)
    await load()
    setIsSyncing(false)
  }

  const handleLogout = () => {
    logoutWmsUser()
    localStorage.removeItem("tsd_synced")
    localStorage.removeItem("tsd_operator_user_id")
    localStorage.removeItem("tsd_operator_login")
    router.push("/mobile/sync")
  }

  return (
    <div className="p-4">
      {/* Header */}
      <h1 className="mb-4 text-xl font-bold text-foreground">Профиль ТСД</h1>

      {profileError && (
        <div className="mb-4 rounded-2xl bg-card p-4 text-sm text-destructive shadow-sm">
          {profileError}
        </div>
      )}

      {/* Operator Card */}
      <div className="mb-4 rounded-2xl bg-primary p-4 text-primary-foreground">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-foreground/20">
            <User className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">
              {mobileProfile?.operator?.displayName || "Оператор не назначен"}
            </div>
            <div className="text-sm opacity-80 truncate">
              {mobileProfile?.operator?.login
                ? `@${mobileProfile.operator.login}`
                : mobileProfile?.hint
                  ? "Настройте закрепление в веб или выберите себя в синхронизации"
                  : "—"}
            </div>
          </div>
        </div>
        {mobileProfile?.operator?.roles?.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {mobileProfile.operator.roles.map((r) => (
              <span
                key={r.code}
                className="rounded-lg bg-primary-foreground/15 px-2 py-0.5 text-xs font-medium"
                title={r.name}
              >
                {r.name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2 opacity-90">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="truncate">Склад: {getSiteCode()}</span>
          </div>
          {mobileProfile?.operator?.phone ? (
            <div className="flex items-center gap-2 opacity-90">
              <span className="truncate">Тел: {mobileProfile.operator.phone}</span>
            </div>
          ) : null}
        </div>
        {mobileProfile?.hint ? (
          <p className="mt-3 rounded-lg bg-primary-foreground/10 p-2 text-xs opacity-95">{mobileProfile.hint}</p>
        ) : null}
      </div>

      {/* Today Stats */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="mb-1 text-xs text-muted-foreground">Выполнено задач</div>
          <div className="text-2xl font-bold text-foreground">
            {profileLoading ? "—" : todayStats.tasksCompleted}
            <span className="text-sm font-normal text-muted-foreground">/{todayStats.tasksTotal}</span>
          </div>
        </div>
        <div className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="mb-1 text-xs text-muted-foreground">Сканирований</div>
          <div className="text-2xl font-bold text-foreground">—</div>
        </div>
      </div>

      {/* Device Info */}
      <div className="mb-4 rounded-2xl bg-card shadow-sm">
        <div className="border-b border-border p-4">
          <h3 className="font-semibold text-foreground">Устройство</h3>
        </div>
        <div className="p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {mobileProfile?.device?.deviceName || deviceInfo.terminalName}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {mobileProfile?.device?.deviceUid || deviceInfo.terminalId}
                  </div>
                  {mobileProfile?.device?.deviceStatus ? (
                    <div className="mt-1 text-xs text-muted-foreground">статус: {mobileProfile.device.deviceStatus}</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Модель</span>
              </div>
              <span className="text-sm font-medium text-foreground">{deviceInfo.model}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ScanBarcode className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Версия</span>
              </div>
              <span className="text-sm font-medium text-foreground">v{deviceInfo.appVersion}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {deviceInfo.isOnline ? (
                  <Wifi className="h-5 w-5 text-success" />
                ) : (
                  <WifiOff className="h-5 w-5 text-destructive" />
                )}
                <span className="text-sm text-muted-foreground">Статус</span>
              </div>
              <div className="flex items-center gap-1.5">
                {deviceInfo.isOnline ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className={cn(
                  "text-sm font-medium",
                  deviceInfo.isOnline ? "text-success" : "text-destructive"
                )}>
                  {deviceInfo.isOnline ? "Онлайн" : "Офлайн"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Server className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Сервер</span>
              </div>
              <span className="text-sm font-medium text-foreground">{deviceInfo.serverUrl}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Последняя синхронизация</span>
              </div>
              <span className="text-sm font-medium text-foreground">{deviceInfo.lastSync}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="mb-4 rounded-2xl bg-card shadow-sm">
        <div className="border-b border-border p-4">
          <h3 className="font-semibold text-foreground">Настройки</h3>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">Звуковые сигналы</span>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">Вибрация</span>
            <Switch checked={vibrationEnabled} onCheckedChange={setVibrationEnabled} />
          </div>
          <button className="flex w-full items-center justify-between py-2">
            <span className="text-sm text-foreground">Расширенные настройки</span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <Button 
          onClick={handleSync}
          disabled={isSyncing}
          className="w-full rounded-xl bg-primary text-primary-foreground"
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", isSyncing && "animate-spin")} />
          {isSyncing ? "Синхронизация..." : "Синхронизировать"}
        </Button>
        <Button 
          onClick={handleLogout}
          variant="outline" 
          className="w-full rounded-xl text-destructive border-destructive hover:bg-destructive/10"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Выйти из системы
        </Button>
      </div>
    </div>
  )
}
