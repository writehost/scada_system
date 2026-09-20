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
  createDirectoryWriteoffReason,
  deleteDirectoryWriteoffReason,
  listDirectoryWriteoffReasons,
  patchDirectoryWriteoffReason,
  type WriteoffReasonRow,
} from "@/lib/wms-api"

export function SettingsDirectoriesWriteoffReasons() {
  const [rows, setRows] = useState<WriteoffReasonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WriteoffReasonRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [code, setCode] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [sortOrder, setSortOrder] = useState("100")
  const [isActive, setIsActive] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectoryWriteoffReasons()
      setRows(res.reasons || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить основания")
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

  function openEdit(row: WriteoffReasonRow) {
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
      setError("Укажите основание")
      return
    }
    const sort = Number(sortOrder)
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await patchDirectoryWriteoffReason(editing.code, {
          displayName: name,
          sortOrder: Number.isFinite(sort) ? sort : editing.sortOrder,
          isActive,
        })
      } else {
        await createDirectoryWriteoffReason({
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

  async function removeRow(row: WriteoffReasonRow) {
    if (!window.confirm(`Удалить основание «${row.displayName}»?`)) return
    setError(null)
    try {
      await deleteDirectoryWriteoffReason(row.code)
      if (editing?.code === row.code) setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить")
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Основания для операции «Списание» из ячейки. Первое значение — «По истечению срока годности».
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
        <p className="text-sm text-muted-foreground">Справочник пуст.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-secondary/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Основание</th>
                <th className="px-3 py-2 font-medium">Код</th>
                <th className="px-3 py-2 font-medium">Порядок</th>
                <th className="px-3 py-2 font-medium">Активно</th>
                <th className="w-20 px-3 py-2" />
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
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => void removeRow(row)}
                      >
                        <Trash2 className="h-4 w-4" />
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
            <DialogTitle>{editing ? "Основание списания" : "Новое основание"}</DialogTitle>
            <DialogDescription>Текст попадёт в акт ТОРГ-16 как основание списания.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Название</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="rounded-xl" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Код</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={Boolean(editing)}
                placeholder="EXPIRED"
                className="rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Порядок</label>
              <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="rounded-xl" />
            </div>
            {editing ? (
              <label className="flex items-center justify-between gap-3 text-sm">
                Активно
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={saving} onClick={() => void submitDialog()}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
