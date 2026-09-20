"use client"

import { useEffect, useState } from "react"
import { Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
  createDirectoryRack,
  deleteDirectoryRack,
  listDirectoryRacks,
  patchDirectoryRack,
  setDirectoryRackCells,
  suggestDirectoryRackCells,
  type RackDirectoryRow,
} from "@/lib/wms-api"
import { RackBarcode } from "@/components/wms/rack-barcode"
import { WmsEmptyState, WmsTableSkeleton } from "@/components/wms/wms-shared"

function parseLocationCodes(raw: string): string[] {
  return [...new Set(raw.split(/[\n,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))]
}

export function SettingsDirectoriesRacks() {
  const [rows, setRows] = useState<RackDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RackDirectoryRow | null>(null)
  const [saving, setSaving] = useState(false)

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [addressLabel, setAddressLabel] = useState("")
  const [warehouseCode, setWarehouseCode] = useState("")
  const [zoneCode, setZoneCode] = useState("")
  const [cellsText, setCellsText] = useState("")
  const [isActive, setIsActive] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectoryRacks({ includeCells: true })
      setRows(res.racks || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить стеллажи")
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
    setName("")
    setAddressLabel("")
    setWarehouseCode("")
    setZoneCode("")
    setCellsText("")
    setIsActive(true)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(row: RackDirectoryRow) {
    setEditing(row)
    setCode(row.code)
    setName(row.name)
    setAddressLabel(row.addressLabel || "")
    setWarehouseCode(row.warehouseCode || "")
    setZoneCode(row.zoneCode || "")
    setCellsText((row.cells || []).map((c) => c.locationCode).join("\n"))
    setIsActive(row.isActive)
    setError(null)
    setDialogOpen(true)
  }

  async function submitDialog() {
    const rackName = name.trim()
    if (!rackName) {
      setError("Укажите название стеллажа")
      return
    }
    setSaving(true)
    setError(null)
    try {
      let rackCode = editing?.code
      if (editing) {
        await patchDirectoryRack(editing.code, {
          name: rackName,
          addressLabel: addressLabel.trim() || null,
          warehouseCode: warehouseCode.trim() || null,
          zoneCode: zoneCode.trim() || null,
          isActive,
        })
      } else {
        const res = await createDirectoryRack({
          code: code.trim() || undefined,
          name: rackName,
          addressLabel: addressLabel.trim() || null,
          warehouseCode: warehouseCode.trim() || null,
          zoneCode: zoneCode.trim() || null,
        })
        rackCode = res.rack.code
        setEditing(res.rack)
        setCode(res.rack.code)
      }
      if (rackCode) {
        await setDirectoryRackCells(rackCode, parseLocationCodes(cellsText))
      }
      if (editing) setDialogOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  async function suggestCells() {
    if (!editing?.code && !code.trim()) {
      setError("Сначала сохраните стеллаж или укажите метку адреса (A01)")
      return
    }
    const rackCode = editing?.code
    if (!rackCode) {
      setError("Сохраните стеллаж, затем нажмите «Подобрать ячейки»")
      return
    }
    setError(null)
    try {
      const res = await suggestDirectoryRackCells(rackCode)
      const suggested = (res.cells || []).map((c) => c.locationCode)
      if (suggested.length === 0) {
        setError("Подходящих свободных ячеек не найдено — проверьте метку адреса")
        return
      }
      const existing = parseLocationCodes(cellsText)
      setCellsText([...new Set([...existing, ...suggested])].join("\n"))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подобрать ячейки")
    }
  }

  async function deactivate(row: RackDirectoryRow) {
    if (!window.confirm(`Деактивировать стеллаж «${row.name}»?`)) return
    setError(null)
    try {
      await deleteDirectoryRack(row.code)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось деактивировать")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Стеллажи</h3>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Справочник физических стеллажей и привязка ячеек. QR стеллажа содержит JSON с кодами всех ячеек — тот же
            формат для ТСД (<code className="text-xs">kind: wms_rack</code>).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          <Button size="sm" className="rounded-xl" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
        </div>
      </div>

      {error && !dialogOpen ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : null}

      {loading ? (
        <WmsTableSkeleton rows={4} columns={5} />
      ) : rows.length === 0 ? (
        <WmsEmptyState
          title="Стеллажей пока нет"
          description="Создайте стеллаж, привяжите ячейки по кодам и распечатайте QR."
          action={
            <Button className="rounded-xl" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить стеллаж
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Стеллаж</th>
                <th className="px-4 py-3 font-medium">Метка</th>
                <th className="px-4 py-3 font-medium">Склад / зона</th>
                <th className="px-4 py-3 font-medium">Ячейки</th>
                <th className="px-4 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">{row.code}</div>
                    {!row.isActive ? <span className="text-muted-foreground text-xs">неактивен</span> : null}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 font-mono text-xs">{row.addressLabel || "—"}</td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {[row.warehouseCode, row.zoneCode].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {row.cellCount > 0 ? (
                      <div className="max-w-[280px]">
                        <div>{row.cellCount} шт.</div>
                        <div className="truncate font-mono text-[10px]">
                          {(row.cells || []).slice(0, 2).map((c) => c.locationCode).join(", ")}
                          {(row.cells?.length ?? 0) > 2 ? "…" : ""}
                        </div>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <RackBarcode
                        rackCode={row.code}
                        rackName={row.name}
                        cellCodes={(row.cells || []).map((c) => c.locationCode)}
                        triggerOnly
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {row.isActive ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => void deactivate(row)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать стеллаж" : "Новый стеллаж"}</DialogTitle>
            <DialogDescription>
              Метка адреса (например A01) — для автоподбора ячеек с physicalAddress A01-01, A01-02…
            </DialogDescription>
          </DialogHeader>

          {error && dialogOpen ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          ) : null}

          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {!editing ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Код</label>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="RACK_A01"
                    className="rounded-xl font-mono"
                  />
                </div>
              ) : null}
              <div className={`space-y-1.5 ${editing ? "sm:col-span-2" : ""}`}>
                <label className="text-sm font-medium">Название</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Стеллаж A01" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Метка адреса</label>
                <Input
                  value={addressLabel}
                  onChange={(e) => setAddressLabel(e.target.value)}
                  placeholder="A01"
                  className="rounded-xl font-mono uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Склад (код)</label>
                <Input
                  value={warehouseCode}
                  onChange={(e) => setWarehouseCode(e.target.value)}
                  placeholder="OS"
                  className="rounded-xl font-mono uppercase"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Зона (код)</label>
                <Input
                  value={zoneCode}
                  onChange={(e) => setZoneCode(e.target.value)}
                  placeholder="ST-BAGG"
                  className="rounded-xl font-mono uppercase"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium">Ячейки (коды, по одному в строке)</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => void suggestCells()}
                  disabled={!editing}
                >
                  <Search className="mr-2 h-4 w-4" />
                  Подобрать ячейки
                </Button>
              </div>
              <Textarea
                value={cellsText}
                onChange={(e) => setCellsText(e.target.value)}
                rows={8}
                className="rounded-xl font-mono text-xs"
                placeholder={"ST-BAGG-SQR-SLNG-15-A01-01\nST-BAGG-SQR-SLNG-15-A01-02"}
              />
            </div>

            {editing && parseLocationCodes(cellsText).length > 0 ? (
              <RackBarcode
                rackCode={editing.code}
                rackName={editing.name}
                cellCodes={parseLocationCodes(cellsText)}
              />
            ) : null}

            {editing ? (
              <div className="flex items-center justify-between rounded-xl border px-3 py-2">
                <span className="text-sm">Активен</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>
              {editing ? "Отмена" : "Закрыть"}
            </Button>
            <Button className="rounded-xl" disabled={saving} onClick={() => void submitDialog()}>
              {saving ? "Сохраняю..." : editing ? "Сохранить" : "Сохранить и привязать ячейки"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
