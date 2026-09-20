"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Building2, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  createItemAlias,
  listDirectorySuppliers,
  listItemAliases,
  type ItemAliasRow,
  type SupplierDirectoryRow,
} from "@/lib/wms-api"
import { WmsEmptyState, WmsTableSkeleton } from "@/components/wms/wms-shared"

export function NomenclatureItemSuppliersPanel({
  itemCode,
  onAliasesChange,
}: {
  itemCode: string
  onAliasesChange?: (aliases: ItemAliasRow[]) => void
}) {
  const [aliases, setAliases] = useState<ItemAliasRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [supplierCode, setSupplierCode] = useState("")
  const [aliasName, setAliasName] = useState("")
  const [aliasSku, setAliasSku] = useState("")

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [aliasRes, supplierRes] = await Promise.all([
        listItemAliases(itemCode),
        listDirectorySuppliers({ activeOnly: true }),
      ])
      const nextAliases = aliasRes.aliases || []
      setAliases(nextAliases)
      onAliasesChange?.(nextAliases)
      setSuppliers(supplierRes.suppliers || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить контрагентов")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [itemCode])

  const selectedSupplier = suppliers.find((s) => s.code === supplierCode)

  async function addAlias() {
    const name = aliasName.trim()
    if (!supplierCode || !name) {
      setError("Выберите контрагента и укажите, как он называет товар")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createItemAlias(itemCode, {
        supplierCode,
        supplierName: selectedSupplier?.name ?? null,
        aliasName: name,
        aliasSku: aliasSku.trim() || null,
      })
      setAliasName("")
      setAliasSku("")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить алиас")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <WmsTableSkeleton rows={4} columns={3} />

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold">Контрагенты и алиасы</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Как поставщик называет этот товар при ручной приёмке. Справочник контрагентов —{" "}
          <Link href="/settings?section=directories&dirTab=suppliers" className="text-primary underline-offset-2 hover:underline">
            Настройки → Справочники → Контрагенты
          </Link>
          .
        </p>
      </div>

      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}

      {suppliers.length === 0 ? (
        <WmsEmptyState
          title="Сначала добавьте контрагента"
          description="Без справочника нельзя привязать поставщика к номенклатуре."
          action={
            <Button asChild className="rounded-xl">
              <Link href="/settings?section=directories&dirTab=suppliers">
                <Building2 className="mr-2 h-4 w-4" />
                Открыть справочник
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <p className="mb-3 text-sm font-medium">Добавить алиас контрагента</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Контрагент</Label>
              <select
                value={supplierCode}
                onChange={(e) => setSupplierCode(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Выберите…</option>
                {suppliers.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Артикул у контрагента</Label>
              <Input value={aliasSku} onChange={(e) => setAliasSku(e.target.value)} placeholder="необязательно" className="rounded-xl" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Как называет товар</Label>
              <Input
                value={aliasName}
                onChange={(e) => setAliasName(e.target.value)}
                placeholder="пробка розовая 28 мм"
                className="rounded-xl"
              />
            </div>
          </div>
          <Button className="mt-3 rounded-xl" disabled={saving} onClick={() => void addAlias()}>
            <Plus className="mr-2 h-4 w-4" />
            {saving ? "Сохраняю..." : "Добавить алиас"}
          </Button>
        </div>
      )}

      {aliases.length === 0 ? (
        <p className="text-muted-foreground text-sm">Алиасов пока нет — добавьте, чтобы при приёмке находить товар по названию поставщика.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Контрагент</th>
                <th className="px-4 py-3 font-medium">Алиас</th>
                <th className="px-4 py-3 font-medium">Артикул</th>
              </tr>
            </thead>
            <tbody>
              {aliases.map((row) => (
                <tr key={row.aliasId} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.supplierName || "—"}</div>
                    <div className="text-muted-foreground font-mono text-xs">{row.supplierCode || "—"}</div>
                  </td>
                  <td className="px-4 py-3">{row.aliasName}</td>
                  <td className="text-muted-foreground px-4 py-3">{row.aliasSku || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void load()}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Обновить
      </Button>
    </div>
  )
}
