"use client"

import { useEffect, useState } from "react"
import { Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react"
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
  createDirectoryIssueRecipient,
  deleteDirectoryIssueRecipient,
  importDirectoryIssueRecipientsFromUsers,
  listDirectoryIssueRecipients,
  patchDirectoryIssueRecipient,
  type IssueRecipientDirectoryRow,
} from "@/lib/wms-api"

export function SettingsDirectoriesIssueRecipients() {
  const [rows, setRows] = useState<IssueRecipientDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<IssueRecipientDirectoryRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)

  const [code, setCode] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [position, setPosition] = useState("")
  const [sortOrder, setSortOrder] = useState("100")
  const [isActive, setIsActive] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectoryIssueRecipients()
      setRows(res.recipients || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить получателей")
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
    setPosition("")
    setSortOrder("100")
    setIsActive(true)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(row: IssueRecipientDirectoryRow) {
    setEditing(row)
    setCode(row.code)
    setDisplayName(row.displayName)
    setPosition(row.position || "")
    setSortOrder(String(row.sortOrder))
    setIsActive(row.isActive)
    setError(null)
    setDialogOpen(true)
  }

  async function submitDialog() {
    const name = displayName.trim()
    if (!name) {
      setError("Укажите ФИО получателя")
      return
    }
    const sort = Number(sortOrder)
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await patchDirectoryIssueRecipient(editing.code, {
          displayName: name,
          position: position.trim() || null,
          sortOrder: Number.isFinite(sort) ? sort : editing.sortOrder,
          isActive,
        })
      } else {
        await createDirectoryIssueRecipient({
          code: code.trim() || undefined,
          displayName: name,
          position: position.trim() || null,
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

  async function importFromUsers() {
    setImporting(true)
    setError(null)
    try {
      const res = await importDirectoryIssueRecipientsFromUsers()
      if (res.message) setError(res.message)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Импорт не выполнен")
    } finally {
      setImporting(false)
    }
  }

  async function removeRow(row: IssueRecipientDirectoryRow) {
    const label = row.displayName.trim() || row.code
    if (!window.confirm(`Удалить получателя «${label}» из справочника?`)) return
    setError(null)
    try {
      await deleteDirectoryIssueRecipient(row.code)
      if (editing?.code === row.code) setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить")
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Список сотрудников для поля «Получатель» при свободной выдаче в цех. В документе сохраняется ФИО из
        справочника.
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-lg"
          disabled={importing}
          onClick={() => void importFromUsers()}
        >
          <Upload className="mr-1.5 h-4 w-4" />
          {importing ? "Импорт…" : "Импорт из wms-users.json"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Справочник пуст. Добавьте получателя вручную или импортируйте из файла пользователей. Если таблица в БД
          ещё не создана, выполните патч{" "}
          <span className="font-mono text-xs">Backend/db/patches/2026-05-26_issue_recipient_defs.sql</span>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-secondary/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">ФИО</th>
                <th className="px-3 py-2 font-medium">Должность</th>
                <th className="px-3 py-2 font-medium">Код</th>
                <th className="px-3 py-2 font-medium">Порядок</th>
                <th className="px-3 py-2 font-medium">Активен</th>
                <th className="px-3 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{row.displayName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.position || "—"}</td>
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
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => void removeRow(row)}
                        aria-label="Удалить получателя"
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
            <DialogTitle>{editing ? "Редактировать получателя" : "Новый получатель"}</DialogTitle>
            <DialogDescription>
              ФИО отображается в выпадающем списке на странице «Выдача → Свободная выдача».
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">ФИО</label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Иванов Иван Иванович"
                className="rounded-lg"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Должность / подразделение</label>
              <Input
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="Оператор линии"
                className="rounded-lg"
              />
            </div>
            {!editing ? (
              <div>
                <label className="mb-1 block text-sm font-medium">Код (необязательно)</label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Авто из ФИО"
                  className="rounded-lg font-mono text-sm"
                />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Код: <span className="font-mono">{editing.code}</span>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">Порядок в списке</label>
              <Input
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                type="number"
                className="rounded-lg"
              />
            </div>
            {editing ? (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-sm">Активен в списке выдачи</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-lg" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" className="rounded-lg" disabled={saving} onClick={() => void submitDialog()}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
