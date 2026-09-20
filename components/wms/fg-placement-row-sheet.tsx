"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import {
  loadPlacementRow,
  resetPlacementRow,
  savePlacementRow,
} from "@/lib/wms/fg-placement-client"
import {
  ALLOCATION_STRATEGY_SHORT,
  CONFLICT_POLICY_SHORT,
  MATCH_KIND_SHORT,
  STORAGE_STRATEGY_SHORT,
  type AllowedMode,
  type AllocationStrategy,
  type ConflictPolicy,
  type EffectiveRowSettings,
  type ProductMatchKind,
  type ProductMatcher,
  type RowPlacementDraft,
  type StorageStrategy,
} from "@/lib/wms/fg-placement-types"

const CLIP_KEY = "wms.fgPlacement.clipboard.v1"

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"

function SelectField<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function MatchersEditor({
  value,
  onChange,
}: {
  value: ProductMatcher[]
  onChange: (next: ProductMatcher[]) => void
}) {
  return (
    <div className="space-y-2">
      {value.map((m, idx) => (
        <div key={`${m.kind}-${idx}`} className="flex gap-2">
          <select
            className={cn(selectClass, "w-36 shrink-0")}
            value={m.kind}
            onChange={(e) => {
              const next = [...value]
              next[idx] = { ...m, kind: e.target.value as ProductMatchKind }
              onChange(next)
            }}
          >
            {Object.entries(MATCH_KIND_SHORT).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <Input
            value={m.value === "*" ? "" : m.value}
            placeholder="Шмаковка"
            onChange={(e) => {
              const next = [...value]
              next[idx] = { ...m, value: e.target.value, label: e.target.value }
              onChange(next)
            }}
          />
          <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, i) => i !== idx))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...value, { kind: "name_ilike", value: "", label: "" }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Добавить
      </Button>
    </div>
  )
}

export function FgPlacementRowSheet({
  open,
  onOpenChange,
  rowId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rowId: string | null
  onSaved?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<EffectiveRowSettings | null>(null)
  const [draft, setDraft] = useState<RowPlacementDraft | null>(null)

  useEffect(() => {
    if (!open || !rowId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    loadPlacementRow(rowId)
      .then((data) => {
        if (cancelled) return
        setSettings(data.settings)
        setDraft(data.draft)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, rowId])

  const title = settings?.planRowId || rowId || "Ряд"

  const patch = (partial: Partial<RowPlacementDraft>) => {
    setDraft((prev) => (prev ? { ...prev, inherit: false, ...partial } : prev))
  }

  const allowedMode: AllowedMode = draft?.allowedMode === "any" || draft?.allowedMode === "list" ? draft.allowedMode : "inherit"

  const summary = useMemo(() => {
    if (!settings) return ""
    const sku =
      settings.allowedMode === "any"
        ? "любая номенклатура"
        : settings.allowedProducts.map((p) => p.label || p.value).join(", ") || "не задано"
    return `${STORAGE_STRATEGY_SHORT[settings.storageStrategy]} · ${ALLOCATION_STRATEGY_SHORT[settings.allocationStrategy]} · ${sku}`
  }, [settings])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-left font-mono">{title}</SheetTitle>
          <SheetDescription className="text-left">{summary}</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка настроек ряда…
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {draft && settings ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-secondary/40 p-2">
                <p className="text-muted-foreground">Зона</p>
                <p className="font-medium">{settings.zone || "—"}</p>
              </div>
              <div className="rounded-xl bg-secondary/40 p-2">
                <p className="text-muted-foreground">Мест / палет</p>
                <p className="font-medium tabular-nums">
                  {settings.capacity} / {settings.palletCount}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <div>
                <p className="text-sm font-medium">Наследовать зону / склад</p>
                <p className="text-xs text-muted-foreground">
                  {settings.inheritedFrom.join(" → ")}
                  {settings.ruleCode ? ` · ${settings.ruleCode}` : ""}
                </p>
              </div>
              <Switch checked={draft.inherit} onCheckedChange={(v) => patch({ inherit: v })} />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <p className="text-sm">Ряд активен</p>
              <Switch checked={draft.isActive} onCheckedChange={(v) => patch({ isActive: v, inherit: false })} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <p className="text-sm">Заблокирован</p>
              <Switch checked={draft.isBlocked} onCheckedChange={(v) => patch({ isBlocked: v, inherit: false })} />
            </div>

            <Field label="Разрешённые номенклатуры">
              <SelectField
                value={allowedMode}
                onChange={(v) =>
                  patch({
                    allowedMode: v,
                    allowedProducts: v === "any" ? [{ kind: "any", value: "*", label: "ANY PRODUCT" }] : draft.allowedProducts.filter((p) => p.kind !== "any"),
                  })
                }
                options={[
                  { value: "inherit", label: "Как у зоны / правила" },
                  { value: "any", label: "ANY PRODUCT — без ограничений" },
                  { value: "list", label: "Только выбранные" },
                ]}
              />
            </Field>
            {allowedMode === "list" ? <MatchersEditor value={draft.allowedProducts} onChange={(allowedProducts) => patch({ allowedProducts, allowedMode: "list" })} /> : null}

            <Field label="Физика ряда (как ставят и достают)">
              <SelectField
                value={(draft.storageStrategy ?? "fifo_lane") as StorageStrategy}
                onChange={(storageStrategy) => patch({ storageStrategy })}
                options={(Object.keys(STORAGE_STRATEGY_SHORT) as StorageStrategy[]).map((v) => ({
                  value: v,
                  label: STORAGE_STRATEGY_SHORT[v],
                }))}
              />
            </Field>
            <Field label="Отбор партии (какую палету взять в задание)">
              <SelectField
                value={(draft.allocationStrategy ?? "fefo") as AllocationStrategy}
                onChange={(allocationStrategy) => patch({ allocationStrategy })}
                options={(Object.keys(ALLOCATION_STRATEGY_SHORT) as AllocationStrategy[]).map((v) => ({
                  value: v,
                  label: ALLOCATION_STRATEGY_SHORT[v],
                }))}
              />
            </Field>
            <Field label="Если FEFO-палета перекрыта">
              <SelectField
                value={(draft.conflictPolicy ?? "next_accessible") as ConflictPolicy}
                onChange={(conflictPolicy) => patch({ conflictPolicy })}
                options={(Object.keys(CONFLICT_POLICY_SHORT) as ConflictPolicy[]).map((v) => ({
                  value: v,
                  label: CONFLICT_POLICY_SHORT[v],
                }))}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Загрузка">
                <SelectField
                  value={draft.loadSide ?? "end"}
                  onChange={(loadSide) => patch({ loadSide })}
                  options={[
                    { value: "start", label: "← начало ряда" },
                    { value: "end", label: "конец ряда →" },
                  ]}
                />
              </Field>
              <Field label="Отбор">
                <SelectField
                  value={draft.pickSide ?? "start"}
                  onChange={(pickSide) => patch({ pickSide })}
                  options={[
                    { value: "start", label: "← начало ряда" },
                    { value: "end", label: "конец ряда →" },
                  ]}
                />
              </Field>
            </div>

            <Field label="Приоритет размещения">
              <Input
                type="number"
                value={draft.placementPriority ?? 100}
                onChange={(e) => patch({ placementPriority: Number(e.target.value) })}
              />
            </Field>
            <Field label="Макс. заполненность, %">
              <Input
                type="number"
                value={draft.maxOccupancy ?? 95}
                onChange={(e) => patch({ maxOccupancy: Number(e.target.value) })}
              />
            </Field>

            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Смешивать SKU</span>
                <Switch checked={draft.allowMixedSku ?? true} onCheckedChange={(allowMixedSku) => patch({ allowMixedSku })} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Смешивать партии</span>
                <Switch checked={draft.allowMixedLot ?? true} onCheckedChange={(allowMixedLot) => patch({ allowMixedLot })} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">FEFO по сроку годности</span>
                <Switch checked={draft.useExpiry ?? true} onCheckedChange={(useExpiry) => patch({ useExpiry })} />
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={saving}
                onClick={async () => {
                  if (!settings || !draft) return
                  setSaving(true)
                  setError(null)
                  try {
                    const saved = await savePlacementRow(settings.locationId, draft)
                    setSettings(saved.settings)
                    onSaved?.()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "не сохранилось")
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Сохранить
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  try {
                    localStorage.setItem(CLIP_KEY, JSON.stringify(draft))
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Копировать
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem(CLIP_KEY)
                    if (!raw) return
                    setDraft(JSON.parse(raw) as RowPlacementDraft)
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Вставить
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  if (!settings) return
                  setSaving(true)
                  try {
                    const saved = await resetPlacementRow(settings.locationId)
                    setSettings(saved.settings)
                    const fresh = await loadPlacementRow(settings.planRowId)
                    setDraft(fresh.draft)
                    onSaved?.()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "сброс не удался")
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                Сбросить
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export { CLIP_KEY as FG_PLACEMENT_CLIP_KEY }
