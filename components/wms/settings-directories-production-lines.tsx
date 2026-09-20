"use client"

import { useEffect, useState } from "react"
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  createDirectoryProductionLine,
  deleteDirectoryProductionLine,
  listDirectoryProductionLines,
  patchDirectoryProductionLine,
  type ProductionLineDirectoryRow,
} from "@/lib/wms-api"

export function SettingsDirectoriesProductionLines() {
  const [rows, setRows] = useState<ProductionLineDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProductionLineDirectoryRow | null>(null)
  const [saving, setSaving] = useState(false)

  const [code, setCode] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [sortOrder, setSortOrder] = useState("100")
  const [isActive, setIsActive] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectoryProductionLines()
      setRows(res.lines || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить линии")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditing(null)
    setCode("")
    setDisplayName("")
    setSortOrder("100")
    setIsActive(true)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(row: ProductionLineDirectoryRow) {
    setEditing(row)
    setCode(row.code)
    setDisplayName(row.displayName)
    setSortOrder(String(row.sortOrder))
    setIsActive(row.isActive)
    setError(null)
    setDialogOpen(true)
  }

  async function submitDialog() {
    const name = displayName.trim()
    if (!name) {
      setError("Укажите название линии")
      return
    }
    const sort = Number(sortOrder)
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await patchDirectoryProductionLine(editing.code, {
          displayName: name,
          sortOrder: Number.isFinite(sort) ? sort : editing.sortOrder,
          isActive,
        })
      } else {
        await createDirectoryProductionLine({
          code: code.trim() || undefined,
          displayName: name,
          sortOrder: Number.isFinite(sort) ? sort : 100,
        })
      }
      setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  async function removeRow(row: ProductionLineDirectoryRow) {
    const label = row.displayName.trim() || row.code
    if (!window.confirm(`Удалить линию «${label}» из справочника?`)) return
    setError(null)
    try {
      await deleteDirectoryProductionLine(row.code)
      if (editing?.code === row.code) setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить")
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Линии производства для поля «Линия расхода» в Цехе (передача на линию). По умолчанию: Sipa, JR, Devin,
        Линия 5 литров, Линия 19 литров. Можно добавлять и удалять.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Обновить
        </Button>
        <Button type="button" size="sm" className="rounded-lg" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Добавить
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Справочник пуст — добавьте линию.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-secondary/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Название</th>
                <th className="px-3 py-2 font-medium">Код</th>
                <th className="px-3 py-2 font-medium">Порядок</th>
                <th className="px-3 py-2 font-medium">Активна</th>
                <th className="px-3 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{row.displayName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                  <td className="px-3 py-2 tabular-nums">{row.sortOrder}</td>
                  <td className="px-3 py-2">{row.isActive ? "Да" : "Нет"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Изменить"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        title="Удалить"
                        onClick={() => void removeRow(row)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Изменить линию" : "Новая линия производства"}</DialogTitle>
            <DialogDescription>
              Код используется для сопоставления с APS (например SIPA, JR). Название видно оператору в Цехе.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="pline-name">
                Название
              </label>
              <Input
                id="pline-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Линия 5 литров"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="pline-code">
                Код {editing ? "" : "(необязательно)"}
              </label>
              <Input
                id="pline-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="L5"
                className="rounded-xl font-mono"
                disabled={Boolean(editing)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="pline-sort">
                Порядок
              </label>
              <Input
                id="pline-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="rounded-xl"
              />
            </div>
            {editing ? (
              <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2">
                <span className="text-sm">Активна</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" className="rounded-xl" disabled={saving} onClick={() => void submitDialog()}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
