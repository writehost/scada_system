"use client"

import { useEffect, useState } from "react"
import { Pencil, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createDirectoryWarehouse,
  listDirectoryWarehouses,
  patchDirectoryWarehouse,
  type WarehouseDirectoryRow,
} from "@/lib/wms-api"
import {
  isWorkshopDirectoryRow,
  mergeWorkshopMeta,
  workshopSummary,
} from "@/lib/wms/workshop-directory"
import { WAREHOUSE_STATUS_CODES } from "@/lib/wms/warehouse-directory-meta"

const WORKSHOP_STATUS_CODES = WAREHOUSE_STATUS_CODES

type WorkshopForm = {
  locationName: string
  scadaAreaCode: string
  defaultZoneId: string
  managerUserId: string
  defaultKeeperUserId: string
}

function formFromRow(row: WarehouseDirectoryRow | null): WorkshopForm {
  const m = row?.meta ?? {}
  return {
    locationName: String(m.locationName ?? ""),
    scadaAreaCode: String(m.scadaAreaCode ?? ""),
    defaultZoneId: String(m.defaultZoneId ?? "LINE"),
    managerUserId: String(m.managerUserId ?? ""),
    defaultKeeperUserId: String(m.defaultKeeperUserId ?? ""),
  }
}

export function SettingsDirectoriesWorkshops() {
  const [rows, setRows] = useState<WarehouseDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WarehouseDirectoryRow | null>(null)
  const [saving, setSaving] = useState(false)

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [shortName, setShortName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<(typeof WORKSHOP_STATUS_CODES)[number]>("ACTIVE")
  const [form, setForm] = useState<WorkshopForm>(() => formFromRow(null))

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectoryWarehouses()
      setRows(
        (res.warehouses || []).filter(
          (w) => isWorkshopDirectoryRow(w) && w.status !== "ARCHIVED" && w.isActive !== false
        )
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить цехи")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setError(null)
    setEditing(null)
    setCode("")
    setName("")
    setShortName("")
    setDescription("")
    setStatus("ACTIVE")
    setForm(formFromRow(null))
    setDialogOpen(true)
  }

  function openEdit(row: WarehouseDirectoryRow) {
    setError(null)
    setEditing(row)
    setCode(row.code)
    setName(row.name)
    setShortName(row.shortName || "")
    setDescription(row.description || "")
    setStatus(
      (WORKSHOP_STATUS_CODES as readonly string[]).includes(row.status)
        ? (row.status as (typeof WORKSHOP_STATUS_CODES)[number])
        : "ACTIVE"
    )
    setForm(formFromRow(row))
    setDialogOpen(true)
  }

  async function submitDialog() {
    const c = code.trim()
    const n = name.trim()
    if (!c || !n) {
      setError("Код и наименование обязательны")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payloadMeta = mergeWorkshopMeta(editing?.meta, form)
      if (editing) {
        await patchDirectoryWarehouse(editing.id, {
          code: c,
          name: n,
          shortName: shortName.trim() || null,
          description: description.trim() || null,
          status,
          warehouseType: "PRODUCTION",
          meta: payloadMeta,
        })
      } else {
        await createDirectoryWarehouse({
          code: c,
          name: n,
          shortName: shortName.trim() || null,
          description: description.trim() || null,
          status,
          warehouseType: "PRODUCTION",
          meta: payloadMeta,
        })
      }
      setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Цехи и линии</h3>
          <p className="text-sm text-muted-foreground">
            Производственные участки для ячеек стикеров, сериализации и линий. Отображаются в форме создания ячейки в группе «Цехи и линии».
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <Button type="button" size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить цех
          </Button>
        </div>
      </div>

      {error && !dialogOpen && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Нет цехов в справочнике. Создайте участок (например <span className="font-mono">Цех №1</span>) — он появится в выпадающем списке «Склад или цех» при создании ячейки.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {rows.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/40">
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold text-foreground">{w.code}</div>
                <div className="truncate text-sm text-foreground">{w.name}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{workshopSummary(w)}</span>
                  <span>статус: {w.status}</span>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="rounded-xl shrink-0" onClick={() => openEdit(w)}>
                <Pencil className="mr-2 h-4 w-4" />
                Карточка
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => !saving && setDialogOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Карточка цеха" : "Новый цех / линия"}</DialogTitle>
            <DialogDescription>
              Код используется при создании ячеек и в SCADA. Зона по умолчанию — <span className="font-mono">LINE</span> для производственных участков.
            </DialogDescription>
          </DialogHeader>

          {error && dialogOpen && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Код цеха</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!editing} className="rounded-xl font-mono" placeholder="LINE" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Наименование</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" placeholder="Линия сериализации" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Краткое название</label>
              <Input value={shortName} onChange={(e) => setShortName(e.target.value)} className="rounded-xl" placeholder="Для ТСД и отчётов" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Описание</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Статус</label>
              <Select value={status} onValueChange={(v) => setStatus(v as (typeof WORKSHOP_STATUS_CODES)[number])}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKSHOP_STATUS_CODES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Участок / расположение</label>
              <Input
                value={form.locationName}
                onChange={(e) => setForm((f) => ({ ...f, locationName: e.target.value }))}
                className="rounded-xl"
                placeholder="Цех маркировки, линия 1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Зона по умолчанию</label>
                <Input
                  value={form.defaultZoneId}
                  onChange={(e) => setForm((f) => ({ ...f, defaultZoneId: e.target.value }))}
                  className="rounded-xl font-mono"
                  placeholder="LINE"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Код SCADA</label>
                <Input
                  value={form.scadaAreaCode}
                  onChange={(e) => setForm((f) => ({ ...f, scadaAreaCode: e.target.value }))}
                  className="rounded-xl font-mono"
                  placeholder="AREA_LINE_1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <label className="text-sm font-medium">managerUserId</label>
                <Input
                  value={form.managerUserId}
                  onChange={(e) => setForm((f) => ({ ...f, managerUserId: e.target.value }))}
                  className="rounded-xl font-mono text-xs"
                  placeholder="UUID начальника"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">defaultKeeperUserId</label>
                <Input
                  value={form.defaultKeeperUserId}
                  onChange={(e) => setForm((f) => ({ ...f, defaultKeeperUserId: e.target.value }))}
                  className="rounded-xl font-mono text-xs"
                  placeholder="UUID оператора"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button className="bg-primary text-primary-foreground" onClick={() => void submitDialog()} disabled={saving}>
              {saving ? "Сохранение…" : editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
