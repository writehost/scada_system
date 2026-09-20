"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Pencil, Plus, RefreshCw } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import {
  createDirectorySlotProfileOption,
  listDirectorySlotProfileOptions,
  patchDirectorySlotProfileOption,
  type SlotProfileOptionDirectoryRow,
} from "@/lib/wms-api"
import { SLOT_FIELD_LABELS } from "@/lib/storage-slot-ui"

const FIELD_KEYS = [
  "materialType",
  "processType",
  "stickerShape",
  "productGroup",
  "volume",
  "applicationPlace",
  "equipment",
] as const

type FieldKey = (typeof FIELD_KEYS)[number]

export function SettingsDirectoriesCellProfile() {
  const [activeField, setActiveField] = useState<FieldKey>("materialType")
  const [rows, setRows] = useState<SlotProfileOptionDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SlotProfileOptionDirectoryRow | null>(null)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [sort, setSort] = useState("100")
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectorySlotProfileOptions()
      setRows(res.options ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить справочник")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const fieldRows = useMemo(
    () =>
      rows
        .filter((r) => r.fieldKey === activeField)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru")),
    [rows, activeField]
  )

  function openCreate() {
    setEditing(null)
    setCode("")
    setName("")
    setDesc("")
    setSort("100")
    setActive(true)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(row: SlotProfileOptionDirectoryRow) {
    setEditing(row)
    setCode(row.code)
    setName(row.name)
    setDesc(row.description || "")
    setSort(String(row.sortOrder))
    setActive(row.isActive)
    setError(null)
    setDialogOpen(true)
  }

  async function submit() {
    const trimmedCode = code.trim()
    const trimmedName = name.trim()
    if (!trimmedCode || !trimmedName) {
      setError("Код и название обязательны")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const sortOrder = Number(sort)
      if (editing) {
        await patchDirectorySlotProfileOption(editing.fieldKey, editing.code, {
          name: trimmedName,
          description: desc.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : editing.sortOrder,
          isActive: active,
        })
      } else {
        await createDirectorySlotProfileOption({
          fieldKey: activeField,
          code: trimmedCode,
          name: trimmedName,
          description: desc.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Значения для полей профиля ячейки — используются при создании ячеек и правил размещения.{" "}
          <Link href="/help#fefo" className="text-primary underline-offset-2 hover:underline">
            Справка: FEFO и ячейки цеха
          </Link>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl bg-secondary/40 p-1">
        {FIELD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveField(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeField === key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {SLOT_FIELD_LABELS[key]}
          </button>
        ))}
      </div>

      {error && !dialogOpen ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : fieldRows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
          Нет значений для «{SLOT_FIELD_LABELS[activeField]}». Добавьте первое или выполните миграцию
          справочников.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/30 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Код</th>
                <th className="px-3 py-2 font-medium">Название</th>
                <th className="px-3 py-2 font-medium">Порядок</th>
                <th className="px-3 py-2 font-medium">Активен</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {fieldRows.map((row) => (
                <tr key={`${row.fieldKey}:${row.code}`} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 tabular-nums">{row.sortOrder}</td>
                  <td className="px-3 py-2">{row.isActive ? "да" : "нет"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Изменить значение" : "Новое значение"} — {SLOT_FIELD_LABELS[activeField]}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {error && dialogOpen ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <div>
              <label className="text-sm font-medium">Код</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!!editing || saving}
                placeholder="ST"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Название</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                placeholder="Стикеры"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Описание</label>
              <Textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                disabled={saving}
                rows={2}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Порядок сортировки</label>
              <Input
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                disabled={saving}
                inputMode="numeric"
                className="mt-1"
              />
            </div>
            {editing ? (
              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <span className="text-sm">Активен</span>
                <Switch checked={active} onCheckedChange={setActive} disabled={saving} />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
