"use client"

import { useEffect, useMemo, useState } from "react"
import { Pencil, Plus, Power, RefreshCw, Trash2, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  createDirectoryItemClass,
  deleteDirectoryItemClass,
  listDirectoryItemClasses,
  patchDirectoryItemClass,
  seedDirectoryItemClasses,
  type ItemClassDirectoryRow,
} from "@/lib/wms-api"

export function SettingsDirectoriesItemClasses() {
  const [rows, setRows] = useState<ItemClassDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [showLegacy, setShowLegacy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ItemClassDirectoryRow | null>(null)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [sortOrder, setSortOrder] = useState("100")
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionCode, setActionCode] = useState<string | null>(null)

  const storageRows = useMemo(
    () => rows.filter((row) => row.kind === "storage" || (!row.kind && /^S[1-5]$/i.test(row.code))),
    [rows]
  )
  const legacyRows = useMemo(
    () => rows.filter((row) => row.kind === "legacy" || (!row.kind && /^[A-F]$/i.test(row.code))),
    [rows]
  )
  const customRows = useMemo(
    () => rows.filter((row) => row.kind === "custom" || (!row.kind && !/^S[1-5]$/i.test(row.code) && !/^[A-F]$/i.test(row.code))),
    [rows]
  )
  const visibleRows = useMemo(
    () => (showLegacy ? [...storageRows, ...customRows, ...legacyRows] : [...storageRows, ...customRows]),
    [customRows, legacyRows, showLegacy, storageRows]
  )

  async function load(seed = false) {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectoryItemClasses({ seedDefaults: seed })
      setRows(res.classes || [])
      if (res.tableMissing) setError("Таблица классов отсутствует в БД")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить классы")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(true)
  }, [])

  function openCreate() {
    setEditing(null)
    setCode("")
    setName("")
    setSortOrder("100")
    setIsActive(true)
    setDialogOpen(true)
  }

  function openEdit(row: ItemClassDirectoryRow) {
    setEditing(row)
    setCode(row.code)
    setName(row.name)
    setSortOrder(String(row.sortOrder ?? 100))
    setIsActive(row.isActive !== false)
    setDialogOpen(true)
  }

  async function save() {
    const c = code.trim().toUpperCase()
    const n = name.trim()
    if (!c || !n) {
      setError("Код и название обязательны")
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await patchDirectoryItemClass({
          code: editing.code,
          name: n,
          sortOrder: Number(sortOrder) || 100,
          isActive,
        })
      } else {
        await createDirectoryItemClass({
          code: c,
          name: n,
          sortOrder: Number(sortOrder) || 100,
        })
      }
      setDialogOpen(false)
      setSuccessMsg("Сохранено")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: ItemClassDirectoryRow) {
    setActionCode(row.code)
    try {
      await patchDirectoryItemClass({ code: row.code, isActive: !row.isActive })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setActionCode(null)
    }
  }

  async function remove(row: ItemClassDirectoryRow) {
    if (row.kind === "storage" || /^S[1-5]$/i.test(row.code)) {
      setError("Системный класс S1–S5 удалять нельзя")
      return
    }
    if (!window.confirm(`Удалить класс ${row.code}? У позиций класс будет сброшен.`)) return
    setActionCode(row.code)
    try {
      await deleteDirectoryItemClass(row.code)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления")
    } finally {
      setActionCode(null)
    }
  }

  async function seed() {
    setLoading(true)
    setError(null)
    try {
      const res = await seedDirectoryItemClasses()
      const moved = res.rematerialized ?? 0
      setSuccessMsg(
        moved > 0
          ? `Справочник S1–S5 обновлён, на ${moved} карточках старый A–F заменён расчётным классом`
          : "Справочник S1–S5 синхронизирован"
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать классы")
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Классы хранения S1–S5</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Класс считается сам по названию и физике: S1 мелкоштучный, S2 средний тарный,
            S3 сырьё линии (в том числе картон и плёнка),
            S4 палета/ГП, S5 карантин. Это не ABC-оборачиваемость и не старые A/B/C/E/F.
            На карточке класс больше не выбирают вручную.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void seed()} disabled={loading}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Синхронизировать S1–S5
          </Button>
          <Button type="button" size="sm" className="rounded-xl" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Новый класс
          </Button>
        </div>
      </div>

      {legacyRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Switch checked={showLegacy} onCheckedChange={setShowLegacy} />
          <span className="text-muted-foreground">
            Показать устаревшие A–F ({legacyRows.reduce((sum, row) => sum + (row.itemCount ?? 0), 0)} карточек ещё с старым кодом)
          </span>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {successMsg ? <p className="text-sm text-emerald-700">{successMsg}</p> : null}

      <div className="overflow-auto rounded-xl border border-border">
        <table className="wms-ag-grid min-w-[640px]">
          <thead>
            <tr>
              <th>Код</th>
              <th>Название</th>
              <th className="text-right">Позиций</th>
              <th>Активен</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-4 text-sm text-muted-foreground">
                  Загрузка…
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-sm text-muted-foreground">
                  Классов нет. Нажмите «Синхронизировать S1–S5».
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.code} className="wms-ag-row">
                  <td className="font-mono font-semibold">{row.code}</td>
                  <td>{row.name}</td>
                  <td className="wms-ag-cell-num">{row.itemCount ?? 0}</td>
                  <td>
                    <Switch
                      checked={row.isActive !== false}
                      disabled={actionCode === row.code}
                      onCheckedChange={() => void toggleActive(row)}
                    />
                  </td>
                  <td className="text-right">
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {row.kind === "storage" || /^S[1-5]$/i.test(row.code) ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        disabled={actionCode === row.code}
                        onClick={() => void remove(row)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Класс ${editing.code}` : "Новый класс"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Код</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={Boolean(editing)}
                placeholder="S1"
                className="rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Название</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Мелкоштучный…" className="rounded-xl" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Порядок</label>
              <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="rounded-xl" />
            </div>
            {editing ? (
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Активен</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" className="rounded-xl" disabled={saving} onClick={() => void save()}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
