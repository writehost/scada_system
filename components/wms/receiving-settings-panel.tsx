"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, Settings2 } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { listLocations, saveReceivingSiteRules, type WmsLocationRow } from "@/lib/wms-api"
import {
  cacheReceivingSiteRules,
  getCachedReceivingSiteRules,
  getReceivingAutoPostStock,
  getReceivingTargetLocationCode,
  operatorMayOverrideReceiving,
  setReceivingTargetLocationCode,
} from "@/lib/receiving-settings"
import {
  DEFAULT_RECEIVING_SITE_RULES,
  type ExpiryMode,
  type ReceivingSiteRules,
} from "@/lib/receiving-scan-policy"
import { cn } from "@/lib/utils"

function isStorageLocation(row: WmsLocationRow): boolean {
  return Boolean((row.locationCode ?? "").trim())
}

function shortenCode(code: string, max = 28): string {
  const c = code.trim()
  if (c.length <= max) return c
  return `${c.slice(0, 14)}…${c.slice(-10)}`
}

const STATUS_OPTIONS = [
  { value: "EMITTED", label: "Эмитирован" },
  { value: "APPLIED", label: "Нанесён" },
  { value: "INTRODUCED", label: "В обороте" },
  { value: "*", label: "Любой / без ЧЗ" },
]

type ReceivingSettingsPanelProps = {
  highlightMissing?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ReceivingSettingsPanel({
  highlightMissing = false,
  defaultOpen = false,
  open: openControlled,
  onOpenChange,
}: ReceivingSettingsPanelProps) {
  const [rules, setRules] = useState<ReceivingSiteRules>(DEFAULT_RECEIVING_SITE_RULES)
  const [locationCode, setLocationCode] = useState("")
  const [openInternal, setOpenInternal] = useState(false)
  const [locations, setLocations] = useState<WmsLocationRow[]>([])
  const [loadingLoc, setLoadingLoc] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const open = openControlled ?? openInternal
  const setOpen = onOpenChange ?? setOpenInternal
  const mayOverride = rules.allowOperatorOverride

  const persistRules = useCallback(async (next: ReceivingSiteRules) => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await saveReceivingSiteRules(next)
      setRules(res.rules)
      cacheReceivingSiteRules(res.rules)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Не удалось сохранить правило площадки")
    } finally {
      setSaving(false)
    }
  }, [])

  const loadLocations = useCallback(async () => {
    setLoadingLoc(true)
    try {
      const recv = await listLocations({ zoneCode: "RECV" })
      let rows = recv.locations.filter(isStorageLocation)
      if (rows.length < 8) {
        const all = await listLocations()
        const extra = all.locations.filter(
          (row) => isStorageLocation(row) && !rows.some((r) => r.locationCode === row.locationCode)
        )
        rows = [...rows, ...extra].slice(0, 80)
      }
      setLocations(rows)
    } catch {
      setLocations([])
    } finally {
      setLoadingLoc(false)
    }
  }, [])

  useEffect(() => {
    setRules(getCachedReceivingSiteRules())
    setLocationCode(getReceivingTargetLocationCode())
    void loadLocations()
  }, [loadLocations])

  useEffect(() => {
    if (defaultOpen || highlightMissing) setOpen(true)
  }, [defaultOpen, highlightMissing, setOpen])

  const autoPost = getReceivingAutoPostStock()
  const missingLocation = highlightMissing && !locationCode.trim() && !autoPost

  const summaryShort = autoPost
    ? locationCode.trim()
      ? `Авто · ${shortenCode(locationCode.trim())}`
      : "Авто · подбор ячейки"
    : locationCode.trim()
      ? shortenCode(locationCode.trim())
      : "Правило площадки"

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        title={
          autoPost
            ? "Автопроведение — правило площадки"
            : locationCode.trim()
              ? `Ячейка: ${locationCode.trim()}`
              : "Правила приёмки площадки"
        }
        onClick={() => setOpen(true)}
        className={cn(
          "h-8 max-w-[min(100%,220px)] rounded-xl px-2.5 text-xs",
          missingLocation && "border-destructive/50 text-destructive ring-1 ring-destructive/20"
        )}
      >
        <Settings2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Правила</span>
        <span
          className={cn(
            "hidden truncate font-mono text-[10px] font-normal sm:inline",
            missingLocation ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {summaryShort}
        </span>
        {autoPost ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg gap-0 overflow-y-auto p-0">
          <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              Правила приёмки площадки
            </DialogTitle>
            <DialogDescription className="text-left text-xs">
              Одно правило для веба и ТСД: статусы ЧЗ, просрочка, автопроведение и ячейка по
              умолчанию. Это не настройка браузера.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            {missingLocation ? (
              <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Укажите ячейку на документе или в правиле площадки.</p>
              </div>
            ) : null}
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="recv-auto-post" className="text-sm font-medium">
                  Автопроведение после закрытия
                </Label>
                <p className="text-xs text-muted-foreground">
                  Правило площадки: закрытая на ТСД сессия сама ляжет на остаток.
                </p>
              </div>
              <Switch
                id="recv-auto-post"
                checked={rules.autoPostStock}
                disabled={saving}
                onCheckedChange={(v) => {
                  const next = { ...rules, autoPostStock: v }
                  setRules(next)
                  void persistRules(next)
                }}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="recv-override" className="text-sm font-medium">
                  Оператору можно сменить ячейку
                </Label>
                <p className="text-xs text-muted-foreground">
                  Иначе проводка берёт только ячейку из правила или со строки заказа.
                </p>
              </div>
              <Switch
                id="recv-override"
                checked={rules.allowOperatorOverride}
                disabled={saving}
                onCheckedChange={(v) => {
                  const next = { ...rules, allowOperatorOverride: v }
                  setRules(next)
                  void persistRules(next)
                }}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Просрочка</Label>
              <select
                value={rules.expiryMode}
                disabled={saving}
                onChange={(e) => {
                  const next = { ...rules, expiryMode: e.target.value as ExpiryMode }
                  setRules(next)
                  void persistRules(next)
                }}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="block">Блокировать</option>
                <option value="confirm">Пускать с подтверждением</option>
                <option value="allow">Пускать</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Статусы ЧЗ по умолчанию</Label>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((opt) => {
                  const on = rules.defaultAllowedStatuses.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        const set = new Set(rules.defaultAllowedStatuses)
                        if (on) set.delete(opt.value)
                        else set.add(opt.value)
                        const next = { ...rules, defaultAllowedStatuses: [...set] }
                        setRules(next)
                        void persistRules(next)
                      }}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-xs",
                        on
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800"
                          : "border-border/60 text-muted-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">По группам</Label>
              <div className="space-y-2 text-xs">
                {rules.groupPolicies.map((policy, idx) => (
                  <div key={policy.match.join("-")} className="rounded-lg border border-border/60 px-3 py-2">
                    <p className="font-medium text-foreground">{policy.match[0]}</p>
                    <p className="text-muted-foreground">
                      {policy.allowedStatuses.join(", ")} · просрочка: {policy.expiryMode ?? rules.expiryMode}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {STATUS_OPTIONS.map((opt) => {
                        const on = policy.allowedStatuses.includes(opt.value)
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              const statuses = new Set(policy.allowedStatuses)
                              if (on) statuses.delete(opt.value)
                              else statuses.add(opt.value)
                              const groupPolicies = rules.groupPolicies.map((p, i) =>
                                i === idx ? { ...p, allowedStatuses: [...statuses] } : p
                              )
                              const next = { ...rules, groupPolicies }
                              setRules(next)
                              void persistRules(next)
                            }}
                            className={cn(
                              "rounded-md border px-1.5 py-0.5",
                              on
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800"
                                : "border-border/60 text-muted-foreground"
                            )}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="recv-target-loc" className="text-sm font-medium">
                Ячейка площадки по умолчанию
              </Label>
              <p className="text-xs text-muted-foreground">
                Пусто — подбор по профилю номенклатуры. На строке заказа ячейка важнее.
              </p>
              {locations.length > 0 ? (
                <select
                  id="recv-target-loc"
                  value={locationCode}
                  onChange={(e) => {
                    const v = e.target.value
                    setLocationCode(v)
                    if (mayOverride) setReceivingTargetLocationCode(v)
                    const next = { ...rules, defaultTargetLocationCode: v }
                    setRules(next)
                    void persistRules(next)
                  }}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="">— подобрать автоматически —</option>
                  {locations.map((loc) => (
                    <option key={loc.locationCode} value={loc.locationCode}>
                      {loc.displayName || loc.slotTitle || loc.locationCode}
                      {loc.locationCode ? ` · ${loc.locationCode}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-amber-800">
                  {loadingLoc ? "Загрузка ячеек…" : "Нет ячеек — создайте профиль в разделе «Ячейки»."}
                </p>
              )}
              <Input
                value={locationCode}
                onChange={(e) => setLocationCode(e.target.value)}
                onBlur={() => {
                  if (mayOverride) setReceivingTargetLocationCode(locationCode)
                  const next = { ...rules, defaultTargetLocationCode: locationCode.trim() }
                  setRules(next)
                  void persistRules(next)
                }}
                placeholder="Код ячейки или пусто для автоподбора"
                className="rounded-lg text-sm"
                aria-label="Код ячейки по умолчанию"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border/60 px-5 py-3">
            <Button type="button" size="sm" className="rounded-lg" onClick={() => setOpen(false)}>
              {saving ? "Сохраняем…" : "Готово"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
