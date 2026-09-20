"use client"

import { useEffect, useState } from "react"
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
import {
  applyPlacementToRows,
  deletePlacementRule,
  savePlacementPolicy,
  savePlacementRule,
  seedFgPlacementDemo,
  type PlacementOverview,
} from "@/lib/wms/fg-placement-client"
import {
  ALLOCATION_STRATEGY_LABEL,
  ALLOCATION_STRATEGY_SHORT,
  CONFLICT_POLICY_LABEL,
  CONFLICT_POLICY_SHORT,
  DEFAULT_PLACEMENT_WEIGHTS,
  DEFAULT_WAREHOUSE_POLICY,
  MATCH_KIND_SHORT,
  STORAGE_STRATEGY_LABEL,
  STORAGE_STRATEGY_SHORT,
  WEIGHT_HELP,
  type AllocationStrategy,
  type ConflictPolicy,
  type PlacementRule,
  type PlacementWeights,
  type ProductMatchKind,
  type RowPlacementDraft,
  type StorageStrategy,
  type WarehousePlacementPolicy,
} from "@/lib/wms/fg-placement-types"

const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

function emptyRule(): PlacementRule {
  return {
    ruleId: "",
    code: "",
    name: "",
    isActive: true,
    storageStrategy: "fifo_lane",
    allocationStrategy: "fefo",
    conflictPolicy: "next_accessible",
    placementPriority: 100,
    maxOccupancy: 95,
    allowMixedSku: false,
    allowMixedLot: true,
    allowReserve: true,
    allowQuarantine: false,
    zoneCodes: [],
    rowFrom: "",
    rowTo: "",
    rowCodes: [],
    products: [{ kind: "name_ilike", value: "", label: "" }],
    productionPlanPriority: 0,
    note: "",
  }
}

function bulkDraft(rule: PlacementRule): RowPlacementDraft {
  return {
    inherit: false,
    isActive: true,
    isBlocked: false,
    storageStrategy: rule.storageStrategy,
    allocationStrategy: rule.allocationStrategy,
    conflictPolicy: rule.conflictPolicy,
    allowedMode: rule.products.some((p) => p.kind === "any") ? "any" : "list",
    allowedProducts: rule.products,
    placementPriority: rule.placementPriority,
    maxOccupancy: rule.maxOccupancy,
    allowMixedSku: rule.allowMixedSku,
    allowMixedLot: rule.allowMixedLot,
    allowReserve: rule.allowReserve,
    allowQuarantine: rule.allowQuarantine,
    loadSide: "end",
    pickSide: "start",
    useExpiry: true,
    useMfg: false,
    minRemainingDays: 0,
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground" title={hint}>
        {label}
      </span>
      {children}
      {hint ? <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function FgPlacementRulesDialog({
  open,
  onOpenChange,
  overview,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  overview: PlacementOverview | null
  onChanged: () => void
}) {
  const [tab, setTab] = useState<"rules" | "weights" | "bulk" | "audit">("rules")
  const [rule, setRule] = useState<PlacementRule>(emptyRule())
  const [policy, setPolicy] = useState<WarehousePlacementPolicy>(DEFAULT_WAREHOUSE_POLICY)
  const [selector, setSelector] = useState("C-1-C-40")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (overview?.policy) setPolicy(overview.policy)
  }, [overview?.policy])

  useEffect(() => {
    if (!open) return
    const first = overview?.rules?.[0]
    if (first && !rule.ruleId) setRule(first)
  }, [open, overview?.rules, rule.ruleId])

  const weights = policy.weights ?? DEFAULT_PLACEMENT_WEIGHTS
  const patchWeight = (key: keyof PlacementWeights, value: number) => {
    setPolicy({ ...policy, weights: { ...weights, [key]: value } })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-full flex-col gap-3 overflow-hidden p-4 sm:max-w-md sm:p-5">
        <SheetHeader className="shrink-0 space-y-1 text-left">
          <SheetTitle>Правила размещения ГП</SheetTitle>
          <SheetDescription>
            Два разных смысла: как ставят в ряд (FIFO-ряд) и какую партию берут (FEFO). Наведите на поле — есть пояснение.
          </SheetDescription>
        </SheetHeader>

        <div className="flex shrink-0 flex-wrap gap-1">
          {(
            [
              ["rules", "Правила"],
              ["bulk", "Массово"],
              ["weights", "Веса"],
              ["audit", "Журнал"],
            ] as const
          ).map(([id, label]) => (
            <Button key={id} size="sm" variant={tab === id ? "default" : "outline"} onClick={() => { setTab(id); setMessage(null) }}>
              {label}
            </Button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {tab === "rules" ? (
            <div className="space-y-4 pb-8">
              <div className="flex flex-wrap gap-1">
                {(overview?.rules ?? []).map((r) => (
                  <button
                    key={r.ruleId}
                    type="button"
                    className={`rounded-lg border px-2 py-1 text-left text-xs ${
                      rule.ruleId === r.ruleId ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
                    }`}
                    onClick={() => setRule(r)}
                  >
                    <span className="font-mono">{r.code}</span>
                  </button>
                ))}
                <Button size="sm" variant="outline" onClick={() => setRule(emptyRule())}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Новое
                </Button>
              </div>

              <Field label="Код">
                <Input value={rule.code} onChange={(e) => setRule({ ...rule, code: e.target.value })} placeholder="SHMAKOVKA_MAIN" />
              </Field>
              <Field label="Название">
                <Input value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} placeholder="Вода Шмаковка" />
              </Field>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-sm">Активно</span>
                <Switch checked={rule.isActive} onCheckedChange={(isActive) => setRule({ ...rule, isActive })} />
              </div>
              <Field
                label="Физика ряда"
                hint={STORAGE_STRATEGY_LABEL[(rule.storageStrategy ?? "fifo_lane") as StorageStrategy]}
              >
                <select
                  className={selectClass}
                  value={rule.storageStrategy ?? "fifo_lane"}
                  onChange={(e) => setRule({ ...rule, storageStrategy: e.target.value as StorageStrategy })}
                >
                  {Object.entries(STORAGE_STRATEGY_SHORT).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Отбор партии"
                hint={ALLOCATION_STRATEGY_LABEL[(rule.allocationStrategy ?? "fefo") as AllocationStrategy]}
              >
                <select
                  className={selectClass}
                  value={rule.allocationStrategy ?? "fefo"}
                  onChange={(e) => setRule({ ...rule, allocationStrategy: e.target.value as AllocationStrategy })}
                >
                  {Object.entries(ALLOCATION_STRATEGY_SHORT).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Если палета перекрыта"
                hint={CONFLICT_POLICY_LABEL[(rule.conflictPolicy ?? "next_accessible") as ConflictPolicy]}
              >
                <select
                  className={selectClass}
                  value={rule.conflictPolicy ?? "next_accessible"}
                  onChange={(e) => setRule({ ...rule, conflictPolicy: e.target.value as ConflictPolicy })}
                >
                  {Object.entries(CONFLICT_POLICY_SHORT).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Приоритет">
                  <Input type="number" value={rule.placementPriority} onChange={(e) => setRule({ ...rule, placementPriority: Number(e.target.value) })} />
                </Field>
                <Field label="Зоны">
                  <Input
                    value={rule.zoneCodes.join(", ")}
                    onChange={(e) =>
                      setRule({
                        ...rule,
                        zoneCodes: e.target.value
                          .split(",")
                          .map((z) => z.trim().toUpperCase())
                          .filter(Boolean),
                      })
                    }
                    placeholder="C, B, F"
                  />
                </Field>
                <Field label="Ряды с">
                  <Input value={rule.rowFrom ?? ""} onChange={(e) => setRule({ ...rule, rowFrom: e.target.value })} placeholder="C-1" />
                </Field>
                <Field label="по">
                  <Input value={rule.rowTo ?? ""} onChange={(e) => setRule({ ...rule, rowTo: e.target.value })} placeholder="C-140" />
                </Field>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Номенклатуры</p>
                {rule.products.map((p, idx) => (
                  <div key={idx} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2">
                    <select
                      className={selectClass}
                      value={p.kind}
                      onChange={(e) => {
                        const products = [...rule.products]
                        products[idx] = { ...p, kind: e.target.value as ProductMatchKind }
                        setRule({ ...rule, products })
                      }}
                    >
                      {Object.entries(MATCH_KIND_SHORT).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="min-w-0"
                      value={p.value === "*" ? "" : p.value}
                      placeholder="Шмаковка"
                      onChange={(e) => {
                        const products = [...rule.products]
                        products[idx] = { ...p, value: e.target.value, label: e.target.value }
                        setRule({ ...rule, products })
                      }}
                    />
                    <Button type="button" size="icon" variant="ghost" onClick={() => setRule({ ...rule, products: rule.products.filter((_, i) => i !== idx) })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRule({ ...rule, products: [...rule.products, { kind: "name_ilike", value: "" }] })}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Добавить
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !rule.code || !rule.name}
                  onClick={async () => {
                    setBusy(true)
                    setMessage(null)
                    try {
                      await savePlacementRule(rule)
                      setMessage("Правило сохранено")
                      onChanged()
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : "ошибка")
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Сохранить
                </Button>
                {rule.ruleId ? (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await deletePlacementRule(rule.ruleId)
                      setRule(emptyRule())
                      onChanged()
                    }}
                  >
                    Удалить
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === "bulk" ? (
            <div className="space-y-3 pb-8">
              <p className="text-sm text-muted-foreground">
                Диапазон <span className="font-mono">C-1-C-200</span> или список <span className="font-mono">C-12,C-13</span>.
              </p>
              <Input value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="C-1-C-200" />
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setMessage(null)
                  try {
                    const result = await applyPlacementToRows(selector, bulkDraft(rule))
                    setMessage(`Обновлено рядов: ${result.updated}`)
                    onChanged()
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "ошибка")
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Применить к выбранным
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setMessage(null)
                  try {
                    const seeded = await seedFgPlacementDemo()
                    setMessage(`Демо: ${seeded.rowsTagged} рядов, задание ${seeded.taskId}`)
                    onChanged()
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "ошибка")
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Демо Шмаковка / Славда / Медвежка
              </Button>
            </div>
          ) : null}

          {tab === "weights" ? (
            <div className="space-y-3 pb-8">
              <p className="text-sm text-muted-foreground">
                Score места = сумма плюсов минус штрафы. Больше число — сильнее влияет на «Куда ставить».
              </p>
              {(Object.keys(WEIGHT_HELP) as Array<keyof PlacementWeights>).map((key) => (
                <label key={key} className="block space-y-1 rounded-lg border border-border p-2">
                  <span className="flex items-center justify-between gap-3 text-sm">
                    {WEIGHT_HELP[key].label}
                    <Input className="w-20 shrink-0" type="number" value={weights[key]} onChange={(e) => patchWeight(key, Number(e.target.value))} />
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{WEIGHT_HELP[key].hint}</span>
                </label>
              ))}
              <Field label="Если FEFO-палета перекрыта" hint={CONFLICT_POLICY_LABEL[policy.conflictPolicy]}>
                <select
                  className={selectClass}
                  value={policy.conflictPolicy}
                  onChange={(e) => setPolicy({ ...policy, conflictPolicy: e.target.value as ConflictPolicy })}
                >
                  {Object.entries(CONFLICT_POLICY_SHORT).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await savePlacementPolicy(policy)
                    setMessage("Веса сохранены")
                    onChanged()
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "ошибка")
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Сохранить веса
              </Button>
            </div>
          ) : null}

          {tab === "audit" ? (
            <div className="space-y-2 pb-8 text-sm">
              {(overview?.audit ?? []).length === 0 ? (
                <p className="text-muted-foreground">Пока нет изменений.</p>
              ) : (
                overview!.audit.map((row) => (
                  <div key={row.auditId} className="rounded-lg border border-border p-2">
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.at).toLocaleString("ru-RU")} · {row.actor} · {row.kind} · {row.target}
                    </p>
                    <p>{row.detail}</p>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
        {message ? <p className="shrink-0 text-sm text-muted-foreground">{message}</p> : null}
      </SheetContent>
    </Sheet>
  )
}
