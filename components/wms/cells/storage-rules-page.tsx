"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, Copy, Pencil, Plus, Scale, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { StorageSlotProfileForm } from "@/components/wms/storage-slot-profile-form"
import {
  createStorageRule,
  deleteStorageRule,
  listLocations,
  listStorageRules,
  updateStorageRule,
  type WmsStorageRule,
} from "@/lib/wms-api"
import { EMPTY_SLOT_PROFILE, slotLabel, type StorageSlotProfile } from "@/lib/storage-slot-ui"
import {
  HANDLING_LABELS,
  STORAGE_CLASS_META,
  STORAGE_CLASSES,
  STORAGE_FORM_LABELS,
  STORAGE_FORMS,
  defaultCriteriaForClass,
  describePhysicalCriteria,
  normalizeStorageClass,
  storageClassLabel,
  type StorageClassCode,
} from "@/lib/wms/physical-profile"
import { cn } from "@/lib/utils"
import { CellsRulesTest } from "@/components/wms/cells/cells-rules-test"

const ANY = "ANY"

type RuleForm = {
  name: string
  storageClass: string
  maxDimensionMm: string
  maxWeightG: string
  handling: string
  storageForms: string[]
  hazardous: boolean
  requiresTemperatureControl: boolean
  requiresQuarantine: boolean
  allowedZoneCodes: string
  forbiddenZoneCodes: string
  slotProfile: StorageSlotProfile
  showProduction: boolean
  preferredZoneId: string
  preferredLocationId: string
  priority: string
  isActive: boolean
  note: string
}

const emptyForm = (): RuleForm => ({
  name: "",
  storageClass: "S1",
  maxDimensionMm: "400",
  maxWeightG: "5000",
  handling: "MANUAL",
  storageForms: ["piece", "pack", "small_box", "bag"],
  hazardous: false,
  requiresTemperatureControl: false,
  requiresQuarantine: false,
  allowedZoneCodes: "STORE, ST-SER, ST-BAGG, RECV, MARK",
  forbiddenZoneCodes: "QUARANTINE, DEFECT",
  slotProfile: { ...EMPTY_SLOT_PROFILE, materialType: ANY, processType: ANY },
  showProduction: false,
  preferredZoneId: "",
  preferredLocationId: "",
  priority: "100",
  isActive: true,
  note: "",
})

function splitCodes(raw: string): string[] | null {
  const parts = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length ? parts : null
}

function ruleToCriteria(rule: WmsStorageRule): string {
  const parts = describePhysicalCriteria({
    ...rule.criteria,
    storageClass: rule.storageClass ?? rule.criteria?.storageClass,
  })
  if (rule.allowedZoneCodes?.length) parts.push(`зоны ${rule.allowedZoneCodes.join(", ")}`)
  if (rule.materialType) parts.push(slotLabel("materialType", rule.materialType))
  if (rule.processType) parts.push(slotLabel("processType", rule.processType))
  return parts.length ? parts.join(" · ") : "Любая партия"
}

function formToPayload(form: RuleForm) {
  const sp = form.slotProfile
  const cls = normalizeStorageClass(form.storageClass) ?? "S1"
  return {
    name: form.name.trim(),
    storageClass: cls,
    allowedZoneCodes: splitCodes(form.allowedZoneCodes),
    forbiddenZoneCodes: splitCodes(form.forbiddenZoneCodes),
    criteria: {
      storageClass: cls,
      handling: form.handling || null,
      storageForms: form.storageForms,
      maxDimensionMm: form.maxDimensionMm.trim() ? Number(form.maxDimensionMm) : null,
      maxWeightG: form.maxWeightG.trim() ? Number(form.maxWeightG) : null,
      hazardous: form.hazardous ? null : false,
      requiresTemperatureControl: form.requiresTemperatureControl ? null : false,
      requiresQuarantine: form.requiresQuarantine ? true : false,
    },
    materialType: sp.materialType && sp.materialType !== ANY ? sp.materialType : null,
    processType: sp.processType && sp.processType !== ANY ? sp.processType : null,
    stickerShape: sp.stickerShape && sp.stickerShape !== ANY ? sp.stickerShape : null,
    productGroup: sp.productGroup && sp.productGroup !== ANY ? sp.productGroup : null,
    volume: sp.volume && sp.volume !== ANY ? sp.volume : null,
    applicationPlace:
      sp.applicationPlace && sp.applicationPlace !== ANY ? sp.applicationPlace : null,
    preferredZoneId: form.preferredZoneId.trim() || null,
    preferredLocationId: form.preferredLocationId.trim() || null,
    priority: Number(form.priority) || 100,
    isActive: form.isActive,
    note: form.note.trim() || null,
  }
}

function ruleToForm(rule: WmsStorageRule): RuleForm {
  const cls = normalizeStorageClass(rule.storageClass ?? rule.criteria?.storageClass) ?? "S1"
  const defaults = defaultCriteriaForClass(cls)
  const c = rule.criteria ?? {}
  return {
    name: rule.name,
    storageClass: cls,
    maxDimensionMm: String(c.maxDimensionMm ?? defaults.maxDimensionMm ?? ""),
    maxWeightG: String(c.maxWeightG ?? defaults.maxWeightG ?? ""),
    handling: c.handling ?? defaults.handling ?? "",
    storageForms: c.storageForms ?? defaults.storageForms ?? [],
    hazardous: c.hazardous === true,
    requiresTemperatureControl: c.requiresTemperatureControl === true,
    requiresQuarantine: c.requiresQuarantine === true,
    allowedZoneCodes: (rule.allowedZoneCodes ?? []).join(", "),
    forbiddenZoneCodes: (rule.forbiddenZoneCodes ?? []).join(", "),
    slotProfile: {
      ...EMPTY_SLOT_PROFILE,
      materialType: rule.materialType ?? ANY,
      processType: rule.processType ?? ANY,
      stickerShape: rule.stickerShape ?? ANY,
      productGroup: rule.productGroup ?? ANY,
      volume: rule.volume ?? ANY,
      applicationPlace: rule.applicationPlace ?? ANY,
    },
    showProduction: Boolean(
      rule.materialType || rule.processType || rule.volume || rule.applicationPlace
    ),
    preferredZoneId: rule.preferredZoneId ?? "",
    preferredLocationId: rule.preferredLocationId ?? "",
    priority: String(rule.priority),
    isActive: rule.isActive,
    note: rule.note ?? "",
  }
}

export function StorageRulesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Загрузка правил…</div>
      }
    >
      <StorageRulesPageInner />
    </Suspense>
  )
}

function StorageRulesPageInner() {
  const search = useSearchParams()
  const prefillDone = useRef(false)

  const [rules, setRules] = useState<WmsStorageRule[]>([])
  const [locations, setLocations] = useState<Awaited<ReturnType<typeof listLocations>>["locations"]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WmsStorageRule | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyForm())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, loc] = await Promise.all([listStorageRules(), listLocations()])
      setRules(r.rules ?? [])
      setLocations(loc.locations ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить правила")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (prefillDone.current || search.get("new") !== "1" || locations.length === 0) return
    const locId = (search.get("locationId") || "").trim()
    const locCode = (search.get("locationCode") || "").trim()
    const loc =
      (locId ? locations.find((l) => l.locationId === locId) : null) ??
      (locCode ? locations.find((l) => l.locationCode === locCode) : null)
    if (!loc) return
    prefillDone.current = true
    setEditing(null)
    setForm({
      ...emptyForm(),
      name: `Размещение → ${loc.locationCode}`,
      storageClass: loc.slotProfile?.storageClass || emptyForm().storageClass,
      slotProfile: loc.slotProfile
        ? { ...EMPTY_SLOT_PROFILE, ...loc.slotProfile }
        : { ...EMPTY_SLOT_PROFILE },
      preferredZoneId: loc.zoneId ?? "",
      preferredLocationId: loc.locationId ?? "",
      priority: "200",
      isActive: true,
      note: `Создано из ячейки ${loc.locationCode}`,
    })
    setDialogOpen(true)
  }, [search, locations])

  const zoneOptions = useMemo(() => {
    const map = new Map<string, { zoneId: string; zoneCode: string; label: string }>()
    for (const loc of locations) {
      if (!loc.zoneId) continue
      const key = loc.zoneId
      if (!map.has(key)) {
        map.set(key, {
          zoneId: loc.zoneId,
          zoneCode: loc.zoneCode,
          label: loc.zoneName ? `${loc.zoneCode} · ${loc.zoneName}` : loc.zoneCode,
        })
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "ru"))
  }, [locations])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(rule: WmsStorageRule) {
    setEditing(rule)
    setForm(ruleToForm(rule))
    setDialogOpen(true)
  }

  function duplicateRule(rule: WmsStorageRule) {
    setEditing(null)
    const f = ruleToForm(rule)
    setForm({ ...f, name: `${f.name} (копия)` })
    setDialogOpen(true)
  }

  async function saveRule() {
    if (!form.name.trim()) {
      setError("Укажите название правила")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = formToPayload(form)
      if (editing) {
        await updateStorageRule(editing.ruleId, payload)
      } else {
        await createStorageRule(payload)
      }
      setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  async function removeRule(rule: WmsStorageRule) {
    if (!window.confirm(`Удалить правило «${rule.name}»?`)) return
    try {
      await deleteStorageRule(rule.ruleId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить")
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 rounded-lg">
            <Link href="/cells">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              К ячейкам
            </Link>
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Scale className="h-6 w-6 text-primary" />
            Правила размещения
          </h1>
        </div>
        <Button className="rounded-xl" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Новое правило
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <CellsRulesTest />

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 py-16 text-center">
          <p className="font-medium">Правил пока нет</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Создайте первое — например, S1 · мелкоштучный → ячейки A-*. Не перечисляйте SKU в правиле.
          </p>
          <Button className="mt-4 rounded-xl" onClick={openCreate}>
            Создать правило
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <article
              key={rule.ruleId}
              className={cn(
                "rounded-2xl border bg-card p-4 shadow-sm",
                rule.isActive ? "border-border/60" : "border-border/40 opacity-60"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{rule.name}</h2>
                    {rule.storageClass ? (
                      <Badge variant="outline" className="rounded-lg text-[10px]">
                        {storageClassLabel(rule.storageClass)}
                      </Badge>
                    ) : null}
                    <Badge variant="secondary" className="rounded-lg text-[10px]">
                      приоритет {rule.priority}
                    </Badge>
                    {!rule.isActive ? (
                      <Badge variant="outline" className="rounded-lg text-[10px]">
                        выкл
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{ruleToCriteria(rule)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {rule.preferredLocationCode ? (
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-primary">
                        → {rule.preferredLocationCode}
                      </span>
                    ) : null}
                    {rule.preferredZoneCode && !rule.preferredLocationCode ? (
                      <span className="rounded-md bg-secondary px-2 py-0.5 font-mono">
                        зона {rule.preferredZoneCode}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    title="Дублировать"
                    onClick={() => duplicateRule(rule)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openEdit(rule)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-destructive"
                    onClick={() => void removeRule(rule)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Изменить правило" : "Новое правило"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Название</Label>
              <Input
                className="mt-1 rounded-lg"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="S1 · Мелкоштучный"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-border/60 bg-secondary/10 p-3">
              <p className="text-sm font-medium">Слой 1 · физический профиль</p>
              <p className="text-xs text-muted-foreground">
                Не перечисляйте «болтики, ручки, скотч». Класс — это размер, вес и способ отбора.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Класс хранения</Label>
                  <select
                    value={form.storageClass}
                    onChange={(e) => {
                      const storageClass = e.target.value as StorageClassCode
                      const d = defaultCriteriaForClass(storageClass)
                      setForm((f) => ({
                        ...f,
                        storageClass,
                        maxDimensionMm: d.maxDimensionMm != null ? String(d.maxDimensionMm) : "",
                        maxWeightG: d.maxWeightG != null ? String(d.maxWeightG) : "",
                        handling: d.handling ?? "",
                        storageForms: d.storageForms ?? [],
                        requiresQuarantine: d.requiresQuarantine === true,
                        name:
                          !f.name.trim() || /^S[1-5]\s*·/.test(f.name)
                            ? STORAGE_CLASS_META[storageClass].short
                            : f.name,
                      }))
                    }}
                    className="mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    {STORAGE_CLASSES.map((code) => (
                      <option key={code} value={code}>
                        {STORAGE_CLASS_META[code].short}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {STORAGE_CLASS_META[form.storageClass as StorageClassCode]?.hint}
                  </p>
                </div>
                <div>
                  <Label>Способ обработки</Label>
                  <select
                    value={form.handling}
                    onChange={(e) => setForm((f) => ({ ...f, handling: e.target.value }))}
                    className="mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    <option value="">— любой —</option>
                    {Object.entries(HANDLING_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Макс. сторона, мм</Label>
                  <Input
                    className="mt-1 rounded-lg"
                    value={form.maxDimensionMm}
                    onChange={(e) => setForm((f) => ({ ...f, maxDimensionMm: e.target.value }))}
                    inputMode="numeric"
                    placeholder="400"
                  />
                </div>
                <div>
                  <Label>Макс. вес, г</Label>
                  <Input
                    className="mt-1 rounded-lg"
                    value={form.maxWeightG}
                    onChange={(e) => setForm((f) => ({ ...f, maxWeightG: e.target.value }))}
                    inputMode="numeric"
                    placeholder="5000"
                  />
                </div>
              </div>
              <div>
                <Label>Форма хранения</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {STORAGE_FORMS.map((formCode) => {
                    const on = form.storageForms.includes(formCode)
                    return (
                      <button
                        key={formCode}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            storageForms: on
                              ? f.storageForms.filter((x) => x !== formCode)
                              : [...f.storageForms, formCode],
                          }))
                        }
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-xs",
                          on
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/60 text-muted-foreground"
                        )}
                      >
                        {STORAGE_FORM_LABELS[formCode]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border/60 p-3">
              <p className="text-sm font-medium">Слой 2 · ограничения</p>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <Switch
                    checked={!form.hazardous}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, hazardous: !v }))}
                  />
                  Только неопасный
                </label>
                <label className="flex items-center gap-2">
                  <Switch
                    checked={!form.requiresTemperatureControl}
                    onCheckedChange={(v) =>
                      setForm((f) => ({ ...f, requiresTemperatureControl: !v }))
                    }
                  />
                  Без холода
                </label>
                <label className="flex items-center gap-2">
                  <Switch
                    checked={form.requiresQuarantine}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, requiresQuarantine: v }))}
                  />
                  Карантин / брак
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Разрешённые зоны</Label>
                  <Input
                    className="mt-1 rounded-lg font-mono text-xs"
                    value={form.allowedZoneCodes}
                    onChange={(e) => setForm((f) => ({ ...f, allowedZoneCodes: e.target.value }))}
                    placeholder="STORE, RECV"
                  />
                </div>
                <div>
                  <Label>Запрещённые зоны</Label>
                  <Input
                    className="mt-1 rounded-lg font-mono text-xs"
                    value={form.forbiddenZoneCodes}
                    onChange={(e) => setForm((f) => ({ ...f, forbiddenZoneCodes: e.target.value }))}
                    placeholder="QUARANTINE, DEFECT"
                  />
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                className="text-sm font-medium text-emerald-800 hover:underline"
                onClick={() => setForm((f) => ({ ...f, showProduction: !f.showProduction }))}
              >
                {form.showProduction
                  ? "Скрыть производственные поля"
                  : "Производство (аппликатор, линейка, куда клеится)"}
              </button>
              {form.showProduction ? (
                <div className="mt-2">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Опционально. Пустое = не участвует в универсальной классификации.
                  </p>
                  <StorageSlotProfileForm
                    value={form.slotProfile}
                    onChange={(slotProfile) => setForm((f) => ({ ...f, slotProfile }))}
                    disabled={saving}
                    showPhysical={false}
                    compact
                  />
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Предпочтительная зона</Label>
                <select
                  value={form.preferredZoneId}
                  onChange={(e) => setForm((f) => ({ ...f, preferredZoneId: e.target.value }))}
                  className="mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="">— не задана —</option>
                  {zoneOptions.map((z) => (
                    <option key={z.zoneId} value={z.zoneId}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Целевая ячейка (сильнее зоны)</Label>
                <select
                  value={form.preferredLocationId}
                  onChange={(e) => setForm((f) => ({ ...f, preferredLocationId: e.target.value }))}
                  className="mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-2 text-xs font-mono"
                >
                  <option value="">— не задана —</option>
                  {locations.map((loc) => (
                    <option key={loc.locationId ?? loc.locationCode} value={loc.locationId ?? ""}>
                      {loc.locationCode}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Приоритет (0–10000)</Label>
                <Input
                  className="mt-1 rounded-lg"
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                />
                <Label>Активно</Label>
              </div>
            </div>

            <div>
              <Label>Комментарий</Label>
              <Textarea
                className="mt-1 min-h-16 rounded-lg"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={() => void saveRule()} disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
