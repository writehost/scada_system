"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, Plus, Save, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  listItems,
  updateWmsItemResources,
  type WmsItemDetailResponse,
  type WmsItemListRow,
  type WmsItemResourceRow,
} from "@/lib/wms-api"

type ResourceEditorRow = {
  itemCode: string
  name: string
  qtyPer: string
  uomCode: string
  componentRoleCode: string
}

const linkClass =
  "font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400"

function resourceToEditorRow(row: WmsItemResourceRow): ResourceEditorRow {
  return {
    itemCode: row.itemCode,
    name: row.name,
    qtyPer: String(row.qtyPer ?? 1),
    uomCode: row.uomCode || "pcs",
    componentRoleCode: row.componentRoleCode || "material",
  }
}

function itemToEditorRow(row: WmsItemListRow): ResourceEditorRow {
  return {
    itemCode: row.itemCode,
    name: row.name,
    qtyPer: "1",
    uomCode: row.uomCode || "pcs",
    componentRoleCode: "material",
  }
}

type Props = {
  itemCode: string
  active: boolean
  resources: WmsItemResourceRow[]
  onSaved: (detail: WmsItemDetailResponse) => void
}

export function NomenclatureItemCompositionPanel({
  itemCode,
  active,
  resources,
  onSaved,
}: Props) {
  const [resourceRows, setResourceRows] = useState<ResourceEditorRow[]>([])
  const [resourceQuery, setResourceQuery] = useState("")
  const [resourceResults, setResourceResults] = useState<WmsItemListRow[]>([])
  const [resourceSearching, setResourceSearching] = useState(false)
  const [resourceSaving, setResourceSaving] = useState(false)
  const [resourceError, setResourceError] = useState<string | null>(null)

  useEffect(() => {
    setResourceRows(resources.map(resourceToEditorRow))
  }, [resources])

  async function searchResourceItems() {
    const q = resourceQuery.trim()
    if (!q) {
      setResourceResults([])
      return
    }
    setResourceSearching(true)
    setResourceError(null)
    try {
      const res = await listItems({ query: q, limit: 20 })
      setResourceResults((res.items || []).filter((row) => row.itemCode !== itemCode))
    } catch (e) {
      setResourceError(e instanceof Error ? e.message : "Не удалось найти материалы")
    } finally {
      setResourceSearching(false)
    }
  }

  function addResourceRow(row: WmsItemListRow) {
    setResourceError(null)
    setResourceRows((prev) => {
      if (prev.some((x) => x.itemCode === row.itemCode)) return prev
      return [...prev, itemToEditorRow(row)]
    })
    setResourceResults([])
    setResourceQuery("")
  }

  function updateResourceRow(idx: number, patch: Partial<ResourceEditorRow>) {
    setResourceRows((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
  }

  function removeResourceRow(idx: number) {
    setResourceRows((prev) => prev.filter((_, i) => i !== idx))
  }

  async function saveResources() {
    if (!itemCode) return
    setResourceSaving(true)
    setResourceError(null)
    try {
      const components = resourceRows.map((row, idx) => {
        const qtyPer = Number(row.qtyPer.replace(",", "."))
        if (!row.itemCode.trim()) throw new Error(`Строка ${idx + 1}: не выбран материал`)
        if (!Number.isFinite(qtyPer) || qtyPer <= 0) {
          throw new Error(`Строка ${idx + 1}: расход должен быть больше нуля`)
        }
        return {
          itemCode: row.itemCode.trim(),
          qtyPer,
          uomCode: row.uomCode.trim() || "pcs",
          componentRoleCode: row.componentRoleCode.trim() || "material",
        }
      })
      const detail = await updateWmsItemResources(itemCode, components)
      setResourceRows((detail.resources || []).map(resourceToEditorRow))
      onSaved(detail)
    } catch (e) {
      setResourceError(e instanceof Error ? e.message : "Не удалось сохранить состав")
    } finally {
      setResourceSaving(false)
    }
  }

  if (!active) return null

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold sm:text-lg">Состав / рецептура</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Материалы и нормы расхода на 1 единицу готовой продукции: бутылка, крышка, этикетка,
            стикер и т.д. Сначала создайте каждый материал отдельной позицией в справочнике, затем
            добавьте их сюда.
          </p>
        </div>
        <Button onClick={() => void saveResources()} disabled={resourceSaving} className="rounded-xl">
          {resourceSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Сохранить состав
        </Button>
      </div>

      {resourceError ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {resourceError}
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-border/60 bg-secondary/20 p-4">
        <Label>Добавить материал</Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            value={resourceQuery}
            onChange={(e) => setResourceQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void searchResourceItems()
            }}
            className="rounded-xl"
            placeholder="Код, артикул или название материала"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void searchResourceItems()}
            disabled={resourceSearching}
            className="rounded-xl"
          >
            {resourceSearching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Найти
          </Button>
        </div>
        {resourceResults.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {resourceResults.map((row) => (
              <button
                key={row.itemCode}
                type="button"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/40"
                onClick={() => addResourceRow(row)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{row.itemCode}</span>
                </span>
                <Plus className="h-4 w-4 shrink-0 text-emerald-700" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {resourceRows.length === 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
          Состав не задан. Добавьте материалы и укажите расход на 1 единицу готовой продукции.
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Материал</th>
                <th className="px-4 py-3 text-right font-medium">Расход на 1 ГП</th>
                <th className="px-4 py-3 text-left font-medium">Ед.</th>
                <th className="px-4 py-3 text-left font-medium">Роль</th>
                <th className="px-4 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {resourceRows.map((row, idx) => (
                <tr key={row.itemCode}>
                  <td className="px-4 py-3">
                    <Link href={`/nomenclature/${encodeURIComponent(row.itemCode)}`} className={linkClass}>
                      {row.name || row.itemCode}
                    </Link>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{row.itemCode}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      value={row.qtyPer}
                      onChange={(e) => updateResourceRow(idx, { qtyPer: e.target.value })}
                      className="ml-auto w-32 rounded-xl text-right"
                      inputMode="decimal"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      value={row.uomCode}
                      onChange={(e) => updateResourceRow(idx, { uomCode: e.target.value })}
                      className="w-24 rounded-xl"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      value={row.componentRoleCode}
                      onChange={(e) => updateResourceRow(idx, { componentRoleCode: e.target.value })}
                      className="w-36 rounded-xl"
                      placeholder="material"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeResourceRow(idx)}
                      className="rounded-xl text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Удалить
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
