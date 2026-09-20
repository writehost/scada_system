"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Smartphone,
  Server,
  Wifi,
  CheckCircle2,
  XCircle,
  ScanBarcode,
  RefreshCw,
  AlertTriangle,
  KeyRound,
  Camera,
  ShieldCheck,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DEFAULT_TSD_WMS_API_ORIGIN,
  enrollDeviceByCode,
  getWmsApiOrigin,
  identifyWmsUser,
  listUsers,
  loginWmsUser,
  registerWmsDevice,
  setWmsApiOrigin,
  normalizeWmsServerInput,
  type WmsUserRow,
} from "@/lib/wms-api"
import { setTsdLastSyncNow } from "@/lib/tsd-offline-store"
import { deviceTokenHint, getDeviceToken } from "@/lib/wms/device-token-client"

type SyncStep = "input" | "connecting" | "syncing" | "success" | "error"
type SyncMode = "code" | "credentials"

interface SyncState {
  step: SyncStep
  deviceId: string
  terminalName: string
  serverUrl: string
  errorMessage: string
  progress: number
}

/** Код подключения приходит либо из QR (ссылка `?code=`), либо вводится руками. */
function extractCode(raw: string): string {
  const value = raw.trim()
  if (!value) return ""
  try {
    const url = new URL(value)
    const fromQuery = url.searchParams.get("code")
    if (fromQuery) return fromQuery.trim()
  } catch {
    /* не ссылка — значит сам код */
  }
  return value
}

function formatCodeInput(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)
  return clean.replace(/(.{4})(?=.)/g, "$1-")
}

export default function MobileSyncPage() {
  const router = useRouter()
  const [mode, setMode] = useState<SyncMode>("code")
  const [operators, setOperators] = useState<WmsUserRow[]>([])
  const [operatorsError, setOperatorsError] = useState<string | null>(null)
  const [operatorUserId, setOperatorUserId] = useState("")
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [pin, setPin] = useState("")
  const [showReregisterInfo, setShowReregisterInfo] = useState(false)
  const [enrollCode, setEnrollCode] = useState("")
  const [existingTokenHint, setExistingTokenHint] = useState("")

  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null)

  const [state, setState] = useState<SyncState>({
    step: "input",
    deviceId: "",
    terminalName: "",
    serverUrl: "",
    errorMessage: "",
    progress: 0,
  })

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      const reason = q.get("reason")
      setShowReregisterInfo(reason === "reregister" || reason === "token")
      const code = q.get("code")
      if (code) {
        setMode("code")
        setEnrollCode(formatCodeInput(code))
      }
    } catch {
      setShowReregisterInfo(false)
    }
    setExistingTokenHint(deviceTokenHint())
  }, [])

  useEffect(() => {
    const savedOrigin = getWmsApiOrigin()
    const savedName = localStorage.getItem("tsd_terminal_name") || ""
    setState((prev) => ({
      ...prev,
      serverUrl: savedOrigin || prev.serverUrl || DEFAULT_TSD_WMS_API_ORIGIN,
      terminalName: savedName || prev.terminalName,
    }))
  }, [])

  useEffect(() => {
    const existingId = localStorage.getItem("tsd_device_id")
    if (existingId) {
      setState((prev) => ({ ...prev, deviceId: existingId }))
    } else {
      const newId = `TSD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
      localStorage.setItem("tsd_device_id", newId)
      setState((prev) => ({ ...prev, deviceId: newId }))
    }
    const savedOp = localStorage.getItem("tsd_operator_user_id") || ""
    setOperatorUserId(savedOp)
  }, [])

  useEffect(() => {
    const o = normalizeWmsServerInput(state.serverUrl)
    if (o) setWmsApiOrigin(state.serverUrl)
  }, [state.serverUrl])

  // Список операторов нужен только для входа по логину: при подключении по коду
  // оператора выбирают уже в смене.
  useEffect(() => {
    if (mode !== "credentials") return
    let cancelled = false
    async function loadOps() {
      setOperatorsError(null)
      try {
        const data = await listUsers({ query: "" })
        if (!cancelled) setOperators(data.users || [])
      } catch (e) {
        if (!cancelled) {
          setOperatorsError(e instanceof Error ? e.message : "Не удалось загрузить пользователей")
        }
      }
    }
    void loadOps()
    return () => {
      cancelled = true
    }
  }, [state.serverUrl, mode])

  const stopScanner = useCallback(() => {
    try {
      scannerControlsRef.current?.stop()
    } catch {
      /* уже остановлен */
    }
    scannerControlsRef.current = null
  }, [])

  useEffect(() => stopScanner, [stopScanner])

  const startScanner = useCallback(async () => {
    setScannerError(null)
    setScannerOpen(true)
    try {
      const mod = await import("@zxing/browser")
      const reader = new mod.BrowserMultiFormatReader()
      // Элемент видео появляется вместе с оверлеем — ждём кадр рендера.
      await new Promise((resolve) => setTimeout(resolve, 60))
      const video = videoRef.current
      if (!video) throw new Error("Камера недоступна")
      const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (!result) return
        const code = extractCode(result.getText())
        if (!code) return
        setEnrollCode(formatCodeInput(code))
        stopScanner()
        setScannerOpen(false)
      })
      scannerControlsRef.current = controls
    } catch (e) {
      setScannerError(
        e instanceof Error
          ? `${e.message}. Введите код с клавиатуры.`
          : "Камера недоступна. Введите код с клавиатуры."
      )
    }
  }, [stopScanner])

  function closeScanner() {
    stopScanner()
    setScannerOpen(false)
  }

  function finishSync(terminalName: string, operatorId: string, operatorLogin: string) {
    localStorage.setItem("tsd_synced", "true")
    localStorage.setItem("tsd_terminal_name", terminalName)
    localStorage.setItem("tsd_last_sync_at", new Date().toISOString())
    setTsdLastSyncNow()
    if (operatorId) {
      localStorage.setItem("tsd_operator_user_id", operatorId)
    } else {
      localStorage.removeItem("tsd_operator_user_id")
    }
    if (operatorLogin) localStorage.setItem("tsd_operator_login", operatorLogin)
    setTimeout(() => router.push("/mobile"), 800)
  }

  const handleEnroll = async () => {
    const code = extractCode(enrollCode)
    if (!code) {
      setState((prev) => ({ ...prev, errorMessage: "Введите код подключения из веб-интерфейса WMS" }))
      return
    }

    setState((prev) => ({ ...prev, step: "connecting", errorMessage: "" }))
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      setState((prev) => ({ ...prev, step: "syncing", progress: 30 }))

      const result = await enrollDeviceByCode({
        code,
        deviceUid: state.deviceId,
        deviceName: state.terminalName.trim() || undefined,
        platform: "mobile-web",
        appVersion: "interface",
        deviceInfo: {
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          language: typeof navigator !== "undefined" ? navigator.language : undefined,
          screen:
            typeof window !== "undefined"
              ? { w: window.screen?.width, h: window.screen?.height }
              : undefined,
        },
      })

      localStorage.setItem("tsd_device_id", result.deviceUid)
      setExistingTokenHint(deviceTokenHint())
      setState((prev) => ({
        ...prev,
        deviceId: result.deviceUid,
        terminalName: result.deviceName || prev.terminalName,
        progress: 100,
        step: "success",
      }))
      finishSync(result.deviceName || state.terminalName.trim() || result.deviceUid, "", "")
    } catch (e) {
      setState((prev) => ({
        ...prev,
        step: "error",
        errorMessage: e instanceof Error ? e.message : "Не удалось подключиться по коду",
      }))
    }
  }

  const handleSync = async () => {
    if (!state.terminalName.trim()) {
      setState((prev) => ({ ...prev, errorMessage: "Введите имя терминала" }))
      return
    }
    if (!login.trim() || !password) {
      setState((prev) => ({ ...prev, errorMessage: "Введите логин и пароль WMS" }))
      return
    }

    setState((prev) => ({ ...prev, step: "connecting", errorMessage: "" }))

    try {
      await new Promise((resolve) => setTimeout(resolve, 400))
      setState((prev) => ({ ...prev, step: "syncing", progress: 15 }))

      const auth = await loginWmsUser(login, password)
      setState((prev) => ({ ...prev, progress: 35 }))

      await registerWmsDevice({
        deviceUid: state.deviceId,
        deviceName: state.terminalName.trim(),
        platform: "mobile-web",
        appVersion: "interface",
        deviceInfo: {
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          language: typeof navigator !== "undefined" ? navigator.language : undefined,
          screen:
            typeof window !== "undefined"
              ? { w: window.screen?.width, h: window.screen?.height }
              : undefined,
        },
      })

      if (pin.trim()) {
        await identifyWmsUser({ method: "pin", identity: login.trim(), pin: pin.trim() }).catch(
          () => undefined
        )
      }

      setState((prev) => ({ ...prev, progress: 100, step: "success" }))
      localStorage.setItem("tsd_device_id", state.deviceId)
      finishSync(
        state.terminalName.trim(),
        operatorUserId.trim() || auth.user.userId || "",
        auth.user.login
      )
    } catch (e) {
      setState((prev) => ({
        ...prev,
        step: "error",
        errorMessage: e instanceof Error ? e.message : "Не удалось подключиться к серверу",
      }))
    }
  }

  const handleRetry = () => {
    setState((prev) => ({ ...prev, step: "input", errorMessage: "", progress: 0 }))
  }

  return (
    <div className="flex min-h-screen flex-col bg-background tsd-light-root">
      <div className="flex h-14 items-center justify-center border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <ScanBarcode className="h-5 w-5 text-primary" />
          <span className="font-bold text-foreground">SCADA WMS</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center p-6">
        {state.step === "input" && (
          <div className="w-full max-w-sm">
            {showReregisterInfo && (
              <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">
                <div className="mb-1 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-100">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Терминал нужно подключить заново
                </div>
                <p className="text-muted-foreground">
                  Устройства нет в базе или его токен отозвали. Возьмите новый код подключения в разделе
                  «Терминалы» веб-интерфейса и введите его ниже.
                </p>
              </div>
            )}

            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
                <Smartphone className="h-10 w-10 text-primary" />
              </div>
              <h1 className="mb-2 text-2xl font-bold text-foreground">Настройка терминала</h1>
              <p className="text-sm text-muted-foreground">
                Подключите ТСД одноразовым кодом из веб-интерфейса
              </p>
              {existingTokenHint && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs text-success">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Терминал уже подключён (токен {existingTokenHint})
                </div>
              )}
            </div>

            <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
              <button
                type="button"
                onClick={() => setMode("code")}
                className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                  mode === "code" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                По коду
              </button>
              <button
                type="button"
                onClick={() => setMode("credentials")}
                className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                  mode === "credentials" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                Логин и пароль
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">ID устройства</label>
                <Input value={state.deviceId} disabled className="rounded-xl bg-secondary font-mono" />
                <p className="mt-1 text-xs text-muted-foreground">Генерируется автоматически</p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Имя терминала{mode === "code" ? " (можно оставить пустым)" : ""}
                </label>
                <Input
                  placeholder="Например: Терминал Склад А"
                  value={state.terminalName}
                  onChange={(e) => setState((prev) => ({ ...prev, terminalName: e.target.value }))}
                  className="rounded-xl"
                />
                {mode === "code" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Если кладовщик указал имя при выпуске кода, оно подставится само.
                  </p>
                )}
              </div>

              {mode === "code" ? (
                <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-3">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Код подключения</label>
                    <Input
                      value={enrollCode}
                      onChange={(e) => setEnrollCode(formatCodeInput(e.target.value))}
                      placeholder="XXXX-XXXX-XXXX"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      className="rounded-xl text-center font-mono text-lg tracking-[0.2em]"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Веб-интерфейс WMS → «Терминалы» → «Подключить терминал».
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-xl"
                    onClick={() => void startScanner()}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    Сканировать QR
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card/70 p-3">
                    <p className="text-xs text-muted-foreground">
                      Резервный способ: подключение по учётной записи WMS. Обычный порядок — код подключения,
                      он не раскрывает пароль на складе.
                    </p>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">Логин WMS</label>
                      <Input
                        autoComplete="username"
                        placeholder="petrov"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">Пароль</label>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        PIN / карта RFID (опционально)
                      </label>
                      <Input
                        inputMode="numeric"
                        placeholder="для быстрой идентификации смены"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        className="rounded-xl"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Оператор на этом ТСД
                    </label>
                    <select
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                      value={operatorUserId}
                      onChange={(e) => setOperatorUserId(e.target.value)}
                    >
                      <option value="">Не выбран (как в учётке устройства на сервере)</option>
                      {operators.map((u) => (
                        <option key={u.userId} value={u.userId}>
                          {u.displayName} · {u.login}
                        </option>
                      ))}
                    </select>
                    {operatorsError ? (
                      <p className="mt-1 text-xs text-destructive">{operatorsError}</p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Выберите себя для профиля и правил доступа. Иначе используется пользователь,
                        закреплённый за ТСД в веб-интерфейсе.
                      </p>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Адрес сервера</label>
                <Input
                  value={state.serverUrl}
                  onChange={(e) => setState((prev) => ({ ...prev, serverUrl: e.target.value }))}
                  placeholder="192.168.31.236:3001"
                  className="rounded-xl"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  По умолчанию: <code className="text-[11px]">https://scada25.ru</code>. Для локальной
                  разработки: IP компьютера и порт <strong>3001</strong>.
                </p>
              </div>

              {state.errorMessage && (
                <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {state.errorMessage}
                </div>
              )}

              {mode === "code" ? (
                <Button
                  onClick={handleEnroll}
                  className="w-full rounded-xl bg-primary py-6 text-primary-foreground"
                >
                  <KeyRound className="mr-2 h-5 w-5" />
                  Подключиться по коду
                </Button>
              ) : (
                <Button
                  onClick={handleSync}
                  className="w-full rounded-xl bg-primary py-6 text-primary-foreground"
                >
                  <Server className="mr-2 h-5 w-5" />
                  Синхронизировать
                </Button>
              )}
            </div>
          </div>
        )}

        {state.step === "connecting" && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center">
              <div className="relative">
                <Wifi className="h-12 w-12 animate-pulse text-primary" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-16 w-16 animate-ping rounded-full border-2 border-primary opacity-30" />
                </div>
              </div>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">Подключение к серверу</h2>
            <p className="text-sm text-muted-foreground">{state.serverUrl}</p>
          </div>
        )}

        {state.step === "syncing" && (
          <div className="w-full max-w-sm text-center">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center">
              <RefreshCw className="h-12 w-12 animate-spin text-primary" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">Синхронизация</h2>
            <p className="mb-4 text-sm text-muted-foreground">Загрузка данных...</p>

            <div className="mb-2 h-3 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <span className="text-sm font-medium text-foreground">{state.progress}%</span>
          </div>
        )}

        {state.step === "success" && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-12 w-12 text-success" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">Готово!</h2>
            <p className="mb-2 text-sm text-muted-foreground">
              {mode === "code" ? "Терминал подключён по токену" : "Терминал успешно синхронизирован"}
            </p>
            <p className="text-sm font-medium text-foreground">{state.terminalName || state.deviceId}</p>
            <p className="mt-4 text-xs text-muted-foreground">Переход на главную...</p>
          </div>
        )}

        {state.step === "error" && (
          <div className="w-full max-w-sm text-center">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-12 w-12 text-destructive" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">Не удалось подключиться</h2>
            <p className="mb-6 text-sm text-muted-foreground">{state.errorMessage}</p>
            <Button onClick={handleRetry} className="w-full rounded-xl bg-primary text-primary-foreground">
              <RefreshCw className="mr-2 h-4 w-4" />
              Попробовать снова
            </Button>
          </div>
        )}
      </div>

      {scannerOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex h-14 shrink-0 items-center justify-between px-4 text-white">
            <span className="text-sm font-medium">Наведите на QR-код подключения</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10"
              onClick={closeScanner}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="relative flex-1">
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-56 w-56 rounded-2xl border-2 border-white/70" />
            </div>
          </div>
          {scannerError && (
            <div className="shrink-0 bg-destructive/90 p-3 text-center text-sm text-white">{scannerError}</div>
          )}
        </div>
      )}

      <div className="p-4 text-center text-xs text-muted-foreground">
        {getDeviceToken() ? "Подключение по токену устройства" : "SCADA System WMS"}
      </div>
    </div>
  )
}
