"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronUp, Plus, Star, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createSupplierContract,
  deleteSupplierContract,
  listSupplierContracts,
  patchSupplierContract,
  type SupplierContractRow,
  type SupplierContractType,
} from "@/lib/wms-api"
import { SUPPLIER_CONTRACT_SOURCES, SUPPLIER_CONTRACT_TYPES } from "@/lib/wms/supplier-contract-meta"

type DraftContract = {
  number: string
  name: string
  contractType: SupplierContractType
  validFrom: string
  validTo: string
  currency: string
  isDefault: boolean
  externalId: string
  note: string
  metaJson: string
  externalRefJson: string
  showAdvanced: boolean
}

function emptyDraft(): DraftContract {
  return {
    number: "",
    name: "",
    contractType: "supply",
    validFrom: "",
    validTo: "",
    currency: "RUB",
    isDefault: false,
    externalId: "",
    note: "",
    metaJson: "{}",
    externalRefJson: "{}",
    showAdvanced: false,
  }
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const t = raw.trim()
  if (!t || t === "{}") return {}
  try {
    const v = JSON.parse(t) as unknown
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new Error(`${label}: ожидается JSON-объект`)
    }
    return v as Record<string, unknown>
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : `${label}: неверный JSON`)
  }
}

function sourceLabel(source: string): string {
  return SUPPLIER_CONTRACT_SOURCES.find((s) => s.value === source)?.label ?? source
}

function typeLabel(type: string): string {
  return SUPPLIER_CONTRACT_TYPES.find((t) => t.value === type)?.label ?? type
}

export function SettingsSupplierContractsPanel({ supplierCode }: { supplierCode: string | null }) {
  const [contracts, setContracts] = useState<SupplierContractRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<DraftContract>(emptyDraft())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!supplierCode) {
      setContracts([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await listSupplierContracts(supplierCode)
      setContracts(res.contracts || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить договоры")
      setContracts([])
    } finally {
      setLoading(false)
    }
  }, [supplierCode])

  useEffect(() => {
    void load()
  }, [load])

  async function submitNew() {
    if (!supplierCode) return
    const name = draft.name.trim() || draft.number.trim()
    if (!name) {
      setError("Укажите номер или название договора")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createSupplierContract({
        supplierCode,
        number: draft.number.trim() || null,
        name,
        contractType: draft.contractType,
        validFrom: draft.validFrom.trim() || null,
        validTo: draft.validTo.trim() || null,
        currency: draft.currency.trim() || "RUB",
        isDefault: draft.isDefault,
        externalId: draft.externalId.trim() || null,
        externalSource: draft.externalId.trim() ? "manual" : "manual",
        meta: parseJsonObject(draft.metaJson, "meta"),
        externalRef: parseJsonObject(draft.externalRefJson, "externalRef"),
        note: draft.note.trim() || null,
      })
      setAdding(false)
      setDraft(emptyDraft())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить договор")
    } finally {
      setSaving(false)
    }
  }

  async function toggleDefault(row: SupplierContractRow) {
    if (row.isDefault) return
    setError(null)
    try {
      await patchSupplierContract(row.code, { isDefault: true })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить договор")
    }
  }

  async function deactivate(row: SupplierContractRow) {
    if (!window.confirm(`Деактивировать договор «${row.number || row.name}»?`)) return
    setError(null)
    try {
      await deleteSupplierContract(row.code)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось деактивировать")
    }
  }

  if (!supplierCode) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        Сохраните контрагента — затем можно добавить договоры вручную или загрузить из 1С, когда появится интеграция.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Договоры привязаны к контрагенту. Источник «1С» — для будущей синхронизации; сейчас можно вводить вручную и
          указать внешний ID.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => {
            setAdding((v) => !v)
            setDraft(emptyDraft())
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Договор
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">{error}</div>
      ) : null}

      {adding ? (
        <div className="grid gap-3 rounded-xl border bg-muted/20 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Номер договора</label>
              <Input
                value={draft.number}
                onChange={(e) => setDraft((d) => ({ ...d, number: e.target.value }))}
                placeholder="№ 45/2024"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Название / предмет</label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Поставка сырья"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Тип</label>
              <Select
                value={draft.contractType}
                onValueChange={(v) => setDraft((d) => ({ ...d, contractType: v as SupplierContractType }))}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPLIER_CONTRACT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Валюта</label>
              <Input
                value={draft.currency}
                onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
                className="rounded-xl font-mono uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Действует с</label>
              <Input
                type="date"
                value={draft.validFrom}
                onChange={(e) => setDraft((d) => ({ ...d, validFrom: e.target.value }))}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Действует по</label>
              <Input
                type="date"
                value={draft.validTo}
                onChange={(e) => setDraft((d) => ({ ...d, validTo: e.target.value }))}
                className="rounded-xl"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Примечание</label>
            <Textarea
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              rows={2}
              className="rounded-xl"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border px-3 py-2">
            <span className="text-sm">Основной договор контрагента</span>
            <Switch checked={draft.isDefault} onCheckedChange={(v) => setDraft((d) => ({ ...d, isDefault: v }))} />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start px-0 text-muted-foreground"
            onClick={() => setDraft((d) => ({ ...d, showAdvanced: !d.showAdvanced }))}
          >
            {draft.showAdvanced ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
            Интеграция и доп. поля
          </Button>
          {draft.showAdvanced ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Внешний ID (GUID 1С и т.п.)</label>
                <Input
                  value={draft.externalId}
                  onChange={(e) => setDraft((d) => ({ ...d, externalId: e.target.value }))}
                  className="rounded-xl font-mono text-xs"
                  placeholder="00000000-0000-0000-0000-000000000000"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">meta (JSON)</label>
                <Textarea
                  value={draft.metaJson}
                  onChange={(e) => setDraft((d) => ({ ...d, metaJson: e.target.value }))}
                  rows={3}
                  className="rounded-xl font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">externalRef (JSON)</label>
                <Textarea
                  value={draft.externalRefJson}
                  onChange={(e) => setDraft((d) => ({ ...d, externalRefJson: e.target.value }))}
                  rows={3}
                  className="rounded-xl font-mono text-xs"
                />
              </div>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setAdding(false)}>
              Отмена
            </Button>
            <Button type="button" size="sm" className="rounded-xl" disabled={saving} onClick={() => void submitNew()}>
              {saving ? "Сохраняю…" : "Сохранить договор"}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground text-sm">Загрузка договоров…</p>
      ) : contracts.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-sm">Договоров пока нет.</p>
      ) : (
        <div className="divide-y rounded-xl border">
          {contracts.map((row) => (
            <div key={row.code} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  {row.isDefault ? (
                    <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Основной" />
                  ) : null}
                  <span className="font-medium">{row.number || row.name}</span>
                  {!row.isActive ? <span className="text-muted-foreground text-xs">неактивен</span> : null}
                </div>
                <p className="text-muted-foreground text-xs">
                  {typeLabel(row.contractType)}
                  {row.validFrom || row.validTo
                    ? ` · ${row.validFrom || "…"} — ${row.validTo || "бессрочно"}`
                    : ""}
                  {row.currency ? ` · ${row.currency}` : ""}
                </p>
                <p className="text-muted-foreground font-mono text-[10px]">
                  {row.code}
                  {row.externalId ? ` · ${sourceLabel(row.externalSource)}: ${row.externalId}` : ` · ${sourceLabel(row.externalSource)}`}
                </p>
                {row.note ? <p className="text-muted-foreground text-xs">{row.note}</p> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                {!row.isDefault && row.isActive ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg text-xs"
                    onClick={() => void toggleDefault(row)}
                  >
                    Сделать основным
                  </Button>
                ) : null}
                {row.isActive ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => void deactivate(row)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
