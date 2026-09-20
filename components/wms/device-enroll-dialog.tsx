"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Timer,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { QrCodeSvg } from "@/components/wms/qr-code-svg"
import {
  issueDeviceEnrollToken,
  loadDeviceEnrollState,
  revokeDeviceEnrollToken,
  saveDeviceAuthSettings,
  type DeviceAuthMode,
  type DeviceAuthSettings,
  type DeviceEnrollToken,
} from "@/lib/wms-api"

const TTL_OPTIONS = [
  { value: 15, label: "15 минут" },
  { value: 60, label: "1 час" },
  { value: 480, label: "8 часов" },
  { value: 1440, label: "24 часа" },
]

const MODE_OPTIONS: Array<{ value: DeviceAuthMode; title: string; hint: string }> = [
  {
    value: "off",
    title: "Выключена",
    hint: "ТСД работает по одному ID, без секрета. Только для стенда. Печатные терминалы этот режим не затрагивает.",
  },
  {
    value: "soft",
    title: "Мягкая",
    hint: "Новые ТСД подключаются по коду, старые пока работают как раньше. Печатный терминал в очередь печати ходит без токена ТСД.",
  },
  {
    value: "strict",
    title: "Строгая",
    hint: "Без действующего токена ТСД не пускается. Печатные терминалы по-прежнему работают через очередь GSMT, без кода ТСД.",
  },
]

function minutesLeft(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.round(ms / 60000))
}

function formatLeft(iso: string): string {
  const left = minutesLeft(iso)
  if (left <= 0) return "истёк"
  if (left < 60) return `${left} мин`
  const hours = Math.floor(left / 60)
  const mins = left % 60
  return mins ? `${hours} ч ${mins} мин` : `${hours} ч`
}

function formatMoment(iso: string | null): string {
  if (!iso) return "—"
  try {
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

export function DeviceEnrollDialog({
  open,
  onOpenChange,
  devicesTotal,
  devicesWithTokenCount,
  onEnrolled,
  onManualRegister,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  devicesTotal: number
  devicesWithTokenCount: number
  onEnrolled?: () => void
  onManualRegister?: () => void
}) {
  const [tab, setTab] = useState("issue")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokens, setTokens] = useState<DeviceEnrollToken[]>([])
  const [settings, setSettings] = useState<DeviceAuthSettings | null>(null)

  const [deviceName, setDeviceName] = useState("")
  const [ttlMinutes, setTtlMinutes] = useState(60)
  const [maxUses, setMaxUses] = useState(1)
  const [note, setNote] = useState("")
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<{ code: string; token: DeviceEnrollToken } | null>(null)
  const [copied, setCopied] = useState(false)
  const [savingMode, setSavingMode] = useState(false)
  const [modeDraft, setModeDraft] = useState<DeviceAuthMode>("soft")

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await loadDeviceEnrollState()
      setTokens(data.tokens ?? [])
      setSettings(data.settings)
      setModeDraft(data.settings?.mode ?? "soft")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить коды подключения")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setIssued(null)
    setCopied(false)
    void reload()
  }, [open, reload])

  const devicesWithoutToken = Math.max(0, devicesTotal - devicesWithTokenCount)

  const enrollUrl = useMemo(() => {
    if (!issued) return ""
    const origin = typeof window === "undefined" ? "" : window.location.origin
    return `${origin}/mobile/sync?code=${encodeURIComponent(issued.code)}`
  }, [issued])

  async function submitIssue() {
    setIssuing(true)
    setError(null)
    try {
      const result = await issueDeviceEnrollToken({
        deviceName: deviceName.trim() || undefined,
        ttlMinutes,
        maxUses,
        note: note.trim() || undefined,
      })
      setIssued({ code: result.code, token: result.token })
      setCopied(false)
      await reload()
      onEnrolled?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выпустить код")
    } finally {
      setIssuing(false)
    }
  }

  async function submitRevoke(tokenId: string) {
    setError(null)
    try {
      await revokeDeviceEnrollToken(tokenId)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отозвать код")
    }
  }

  async function submitMode() {
    if (!settings) return
    setSavingMode(true)
    setError(null)
    try {
      const saved = await saveDeviceAuthSettings({ ...settings, mode: modeDraft })
      setSettings(saved.settings)
      setModeDraft(saved.settings.mode)
      onEnrolled?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить режим")
    } finally {
      setSavingMode(false)
    }
  }

  async function copyCode() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const activeTokens = tokens.filter((t) => t.state === "active")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            Подключение терминала по коду
          </DialogTitle>
          <DialogDescription className="text-xs">
            Код и токен нужны только ТСД. Печатный терминал в этом диалоге не подключается — он сам
            появляется в разделе «Терминалы», когда опрашивает очередь печати.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="issue" className="text-xs">
              Новый код
            </TabsTrigger>
            <TabsTrigger value="active" className="text-xs">
              Активные {activeTokens.length ? `(${activeTokens.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="security" className="text-xs">
              Безопасность
            </TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <TabsContent value="issue" className="mt-0 space-y-3">
              {issued ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <div className="flex justify-center">
                        <div className="rounded-lg bg-white p-2">
                          <QrCodeSvg value={enrollUrl} size={160} />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Код подключения
                        </div>
                        <div className="font-mono text-2xl font-bold tracking-[0.18em] text-foreground">
                          {issued.code}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={copyCode}>
                            {copied ? (
                              <Check className="mr-1.5 h-3.5 w-3.5 text-success" />
                            ) : (
                              <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            {copied ? "Скопировано" : "Копировать"}
                          </Button>
                          <Badge variant="outline" className="gap-1 text-[11px]">
                            <Timer className="h-3 w-3" />
                            {formatLeft(issued.token.expiresAt)}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            устройств: {issued.token.maxUses}
                          </Badge>
                        </div>
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          На ТСД: «Настройки» → «Сервер» → поле «Код или токен». Можно отсканировать QR
                          или ввести код руками — регистр и дефисы не важны.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => {
                        setIssued(null)
                        setDeviceName("")
                        setNote("")
                      }}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Выпустить ещё код
                    </Button>
                    <Button size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
                      Готово
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-foreground/80">Имя терминала (необязательно)</span>
                    <Input
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                      placeholder="Например: ТСД приёмка №2"
                      className="h-9"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Подставится на терминале автоматически. Если оставить пустым — кладовщик впишет имя сам.
                    </span>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-xs font-medium text-foreground/80">Код действует</span>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={ttlMinutes}
                        onChange={(e) => setTtlMinutes(Number(e.target.value))}
                      >
                        {TTL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-medium text-foreground/80">Сколько устройств подключить</span>
                      <Input
                        value={maxUses}
                        onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
                        inputMode="numeric"
                        className="h-9 tabular-nums"
                      />
                      <span className="text-[11px] text-muted-foreground">
                        Обычно 1. Больше — когда настраиваете партию терминалов одним кодом.
                      </span>
                    </label>
                  </div>

                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-foreground/80">Заметка (необязательно)</span>
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Кому выдали код"
                      className="h-9"
                    />
                  </label>

                  {error && (
                    <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" className="h-9 text-xs" onClick={submitIssue} disabled={issuing}>
                      {issuing ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Выпустить код
                    </Button>
                    {onManualRegister && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 text-xs text-muted-foreground"
                        onClick={() => {
                          onOpenChange(false)
                          onManualRegister()
                        }}
                      >
                        Завести терминал вручную
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="active" className="mt-0 space-y-2">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Загрузка…
                </div>
              ) : activeTokens.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Действующих кодов нет. Выпустите код на вкладке «Новый код» — он живёт минуты и гаснет
                  после подключения.
                </div>
              ) : (
                activeTokens.map((t) => (
                  <div
                    key={t.tokenId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <span className="font-mono tracking-wider">••••-••••-{t.codeHint}</span>
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Timer className="h-2.5 w-2.5" />
                          {formatLeft(t.expiresAt)}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {t.deviceName || "имя не задано"} · выдал {t.createdBy} ·{" "}
                        {t.usedCount}/{t.maxUses} подключений
                        {t.note ? ` · ${t.note}` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-destructive hover:text-destructive"
                      onClick={() => submitRevoke(t.tokenId)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Отозвать
                    </Button>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="security" className="mt-0 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 p-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">С токеном</div>
                  <div className="text-xl font-semibold tabular-nums text-foreground">
                    {devicesWithTokenCount}
                  </div>
                </div>
                <div
                  className={cn(
                    "rounded-lg border p-2.5",
                    devicesWithoutToken > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border/70"
                  )}
                >
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Без токена</div>
                  <div className="text-xl font-semibold tabular-nums text-foreground">{devicesWithoutToken}</div>
                </div>
              </div>

              <p className="text-[11px] leading-snug text-muted-foreground">
                Режим проверки токена действует только на ТСД. Печатные терминалы сюда не входят и в
                счётчике «без токена» не считаются.
              </p>
              <div className="space-y-1.5">
                {MODE_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                      modeDraft === o.value
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/70 hover:border-border"
                    )}
                  >
                    <input
                      type="radio"
                      name="device-auth-mode"
                      className="mt-0.5"
                      checked={modeDraft === o.value}
                      onChange={() => setModeDraft(o.value)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{o.title}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              {modeDraft === "strict" && devicesWithoutToken > 0 && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {devicesWithoutToken} ТСД ещё без токена — после включения строгого режима они
                    перестанут работать до подключения по коду. Печатные терминалы не затрагиваются.
                  </span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-9 text-xs"
                  onClick={submitMode}
                  disabled={savingMode || !settings || modeDraft === settings.mode}
                >
                  {savingMode ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Сохранить режим
                </Button>
                {settings?.updatedAt && (
                  <span className="text-[11px] text-muted-foreground">
                    изменено {formatMoment(settings.updatedAt)}
                    {settings.updatedBy ? ` · ${settings.updatedBy}` : ""}
                  </span>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
