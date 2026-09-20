"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createDirectoryZone,
  listDirectoryWarehouses,
  listDirectoryZones,
  type ZoneDirectoryRow,
} from "@/lib/wms-api"
import { formatZoneSelectLabel } from "@/lib/storage-slot-ui"
import { mapWmsError } from "@/lib/wms-error-messages"

export function SettingsDirectoriesZones() {
  const [rows, setRows] = useState<ZoneDirectoryRow[]>([])
  const [warehouses, setWarehouses] = useState<{ code: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [warehouseCode, setWarehouseCode] = useState("")
  const [zoneCode, setZoneCode] = useState("")
  const [zoneName, setZoneName] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [whRes, zonesRes] = await Promise.all([
        listDirectoryWarehouses(),
        listDirectoryZones(),
      ])
      setWarehouses(
        (whRes.warehouses ?? [])
          .filter((w) => w.isActive)
          .map((w) => ({ code: w.code, name: w.name }))
      )
      setRows(zonesRes.zones ?? [])
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate() {
    if (!warehouseCode.trim() || !zoneCode.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createDirectoryZone({
        warehouseCode,
        zoneCode,
        name: zoneName.trim() || zoneCode.trim(),
      })
      setZoneCode("")
      setZoneName("")
      await load()
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Зоны складов и цехов</h3>
          <p className="text-muted-foreground text-sm">
            Участки внутри склада: LINE, ST-SER, RECV и т.д. Нужны при создании ячеек.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <select
          value={warehouseCode}
          onChange={(e) => setWarehouseCode(e.target.value)}
          className="flex h-10 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">Склад…</option>
          {warehouses.map((wh) => (
            <option key={wh.code} value={wh.code}>
              {wh.name} ({wh.code})
            </option>
          ))}
        </select>
        <Input
          value={zoneCode}
          onChange={(e) => setZoneCode(e.target.value.toUpperCase())}
          placeholder="Код зоны (LINE)"
        />
        <Input
          value={zoneName}
          onChange={(e) => setZoneName(e.target.value)}
          placeholder="Название"
        />
        <Button onClick={() => void handleCreate()} disabled={saving || !warehouseCode || !zoneCode}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить зону
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="max-h-72 overflow-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Склад</th>
              <th className="px-3 py-2 text-left font-medium">Зона</th>
              <th className="px-3 py-2 text-left font-medium">Название</th>
              <th className="px-3 py-2 text-right font-medium">Ячеек</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.zoneId} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{row.warehouseCode}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.zoneCode}</td>
                <td className="px-3 py-2">
                  {formatZoneSelectLabel(row.zoneCode, row.zoneName, row.warehouseCode)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.locationCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
