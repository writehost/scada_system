"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { mapWmsError } from "@/lib/wms-error-messages"
import { formatZoneSelectLabel, warehouseDisplayLabel } from "@/lib/storage-slot-ui"
import {
  createDirectoryRack,
  createDirectoryZone,
  createWaitingCellsBatch,
  listDirectoryReceivingCategories,
  listDirectoryWarehouses,
  listDirectoryZones,
  setDirectoryRackCells,
  type RackDirectoryRow,
  type ReceivingCategoryDirectoryRow,
  type WarehouseDirectoryRow,
  type ZoneDirectoryRow,
} from "@/lib/wms-api"
import { isWorkshopDirectoryRow } from "@/lib/wms/workshop-directory"
import {
  DEFAULT_RECEIVING_CATEGORY_CODE,
  MAX_WAITING_BATCH_COUNT,
  defaultWorkshopZoneCode,
} from "@/lib/wms/workshop-waiting-cell"
import { RackBarcode } from "@/components/wms/rack-barcode"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (rack: RackDirectoryRow) => void
  defaultWarehouseCode?: string
  defaultZoneCode?: string
}

function defaultWorkshopWarehouse(warehouses: WarehouseDirectoryRow[]): string {
  const workshops = warehouses.filter(isWorkshopDirectoryRow)
  const line = workshops.find((w) => w.code?.trim().toUpperCase() === "LINE")
  if (line?.code?.trim()) return line.code.trim()
  return workshops[0]?.code?.trim() || "LINE"
}

export function WorkshopRackCreateDialog({
  open,
  onOpenChange,
  onCreated,
  defaultWarehouseCode,
  defaultZoneCode,
}: Props) {
  const [warehouses, setWarehouses] = useState<WarehouseDirectoryRow[]>([])
  const [zoneOptions, setZoneOptions] = useState<ZoneDirectoryRow[]>([])
  const [warehouseCode, setWarehouseCode] = useState("LINE")
  const [zoneCode, setZoneCode] = useState("LINE")
  const [rackName, setRackName] = useState("")
  const [rackCode, setRackCode] = useState("")
  const [addressLabel, setAddressLabel] = useState("")
  const [receivingCategories, setReceivingCategories] = useState<ReceivingCategoryDirectoryRow[]>([])
  const [receivingCategoryCode, setReceivingCategoryCode] = useState(DEFAULT_RECEIVING_CATEGORY_CODE)
  const [codePrefix, setCodePrefix] = useState("A")
  const [startIndex, setStartIndex] = useState("1")
  const [count, setCount] = useState("5")
  const [loading, setLoading] = useState(false)
  const [loadingDirs, setLoadingDirs] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdRack, setCreatedRack] = useState<RackDirectoryRow | null>(null)

  const loadDirectories = useCallback(async () => {
    setLoadingDirs(true)
    try {
      const [whRes, catRes] = await Promise.all([
        listDirectoryWarehouses(),
        listDirectoryReceivingCategories(),
      ])
      const wh = (whRes.warehouses ?? []).filter((w) => w.isActive)
      setWarehouses(wh)
      const cats = (catRes.categories ?? []).filter((c) => c.isActive)
      setReceivingCategories(cats)
      if (cats.some((c) => c.code === DEFAULT_RECEIVING_CATEGORY_CODE)) {
        setReceivingCategoryCode(DEFAULT_RECEIVING_CATEGORY_CODE)
      } else if (cats[0]) {
        setReceivingCategoryCode(cats[0].code)
      }
      const whDefault = defaultWarehouseCode?.trim() || defaultWorkshopWarehouse(wh)
      setWarehouseCode(whDefault)
      const zonesRes = await listDirectoryZones(whDefault)
      setZoneOptions(zonesRes.zones ?? [])
      const zones = zonesRes.zones ?? []
      const zoneDefault =
        defaultZoneCode?.trim() || defaultWorkshopZoneCode(zones)
      setZoneCode(zoneDefault)
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setLoadingDirs(false)
    }
  }, [defaultWarehouseCode, defaultZoneCode])

  useEffect(() => {
    if (!open) return
    setError(null)
    setCreatedRack(null)
    setRackName("")
    setRackCode("")
    setAddressLabel("")
    setCount("5")
    setCodePrefix("A")
    setStartIndex("1")
    void loadDirectories()
  }, [open, loadDirectories])

  useEffect(() => {
    if (!open || !warehouseCode.trim()) return
    let cancelled = false
    void listDirectoryZones(warehouseCode)
      .then((res) => {
        if (cancelled) return
        setZoneOptions(res.zones ?? [])
        const zones = res.zones ?? []
        if (!zones.some((z) => z.zoneCode === zoneCode) && zones[0]) {
          setZoneCode(defaultWorkshopZoneCode(zones))
        }
      })
      .catch(() => {
        if (!cancelled) setZoneOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [open, warehouseCode, zoneCode])

  const warehouseOptions = useMemo(() => {
    const workshops = warehouses.filter(isWorkshopDirectoryRow)
    const list = workshops.length > 0 ? workshops : warehouses
    return list
      .map((wh) => ({
        code: wh.code?.trim() ?? "",
        label: warehouseDisplayLabel(wh.code?.trim() ?? "", wh.name),
      }))
      .filter((w) => w.code)
      .sort((a, b) => a.label.localeCompare(b.label, "ru"))
  }, [warehouses])

  async function handleCreateZone() {
    const code = window.prompt("Код новой зоны (например LINE, ST-SER):", "LINE")?.trim()
    if (!code) return
    const name = window.prompt("Название зоны:", code)?.trim() || code
    setLoading(true)
    setError(null)
    try {
      await createDirectoryZone({ warehouseCode, zoneCode: code, name })
      const res = await listDirectoryZones(warehouseCode)
      setZoneOptions(res.zones ?? [])
      setZoneCode(code.toUpperCase())
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit() {
    const name = rackName.trim()
    const n = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), MAX_WAITING_BATCH_COUNT)
    const start = Math.min(Math.max(Number.parseInt(startIndex, 10) || 1, 1), 99999)
    const prefix = codePrefix.trim().toUpperCase()
    if (!name) {
      setError("Укажите название стеллажа")
      return
    }
    if (!warehouseCode.trim() || !zoneCode.trim()) {
      setError("Укажите склад и зону")
      return
    }
    if (!prefix) {
      setError("Укажите префикс ячеек")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const cellsRes = await createWaitingCellsBatch({
        warehouseCode,
        zoneCode,
        count: n,
        codePrefix: prefix,
        startIndex: start,
        namingMode: "sequential",
        receivingCategoryCode,
      })
      const locationCodes = (cellsRes.locations ?? []).map((r) => r.locationCode)
      if (locationCodes.length === 0) {
        throw new Error("Ячейки не созданы")
      }

      const label = addressLabel.trim().toUpperCase() || prefix
      const rackRes = await createDirectoryRack({
        code: rackCode.trim() || undefined,
        name,
        addressLabel: label,
        warehouseCode,
        zoneCode,
      })

      const linked = await setDirectoryRackCells(rackRes.rack.code, locationCodes)
      setCreatedRack(linked.rack)
      onCreated?.(linked.rack)
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setLoading(false)
    }
  }

  const selectedCategory = useMemo(
    () => receivingCategories.find((c) => c.code === receivingCategoryCode),
    [receivingCategories, receivingCategoryCode]
  )

  const previewEnd = useMemo(() => {
    const n = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), MAX_WAITING_BATCH_COUNT)
    const start = Math.min(Math.max(Number.parseInt(startIndex, 10) || 1, 1), 99999)
    const prefix = codePrefix.trim().toUpperCase() || "A"
    return `${prefix}-${start} … ${prefix}-${start + n - 1}`
  }, [codePrefix, count, startIndex])

  const createdCellCodes = createdRack?.cells?.map((c) => c.locationCode) ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (loading) return
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Стеллаж цеха</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Создаёт стеллаж, пакет ячеек с кодами A-1, A-2… и сразу привязывает их к стеллажу для QR и
          ТСД.
        </p>

        {createdRack ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-emerald-800">
              Стеллаж «{createdRack.name}» ({createdRack.code}) · ячеек: {createdRack.cellCount}
            </p>
            <ul className="max-h-40 space-y-1 overflow-auto rounded-xl border p-3 text-sm">
              {createdCellCodes.slice(0, 24).map((code) => (
                <li key={code} className="font-mono text-xs">
                  {code}
                </li>
              ))}
              {createdCellCodes.length > 24 ? (
                <li className="text-muted-foreground text-xs">
                  … и ещё {createdCellCodes.length - 24}
                </li>
              ) : null}
            </ul>
            <RackBarcode
              rackCode={createdRack.code}
              rackName={createdRack.name}
              cellCodes={createdCellCodes}
            />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <label htmlFor="rack-name" className="text-sm font-medium">
                Название стеллажа
              </label>
              <Input
                id="rack-name"
                value={rackName}
                onChange={(e) => setRackName(e.target.value)}
                placeholder="Стеллаж линии 1"
                disabled={loading || loadingDirs}
                className="rounded-lg"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="rack-code" className="text-sm font-medium">
                  Код (необяз.)
                </label>
                <Input
                  id="rack-code"
                  value={rackCode}
                  onChange={(e) => setRackCode(e.target.value.toUpperCase())}
                  placeholder="RACK-A"
                  disabled={loading || loadingDirs}
                  className="rounded-lg font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="rack-label" className="text-sm font-medium">
                  Метка адреса
                </label>
                <Input
                  id="rack-label"
                  value={addressLabel}
                  onChange={(e) => setAddressLabel(e.target.value.toUpperCase())}
                  placeholder="A01"
                  disabled={loading || loadingDirs}
                  className="rounded-lg font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="rack-wh" className="text-sm font-medium">
                  Склад / цех
                </label>
                <select
                  id="rack-wh"
                  value={warehouseCode}
                  onChange={(e) => setWarehouseCode(e.target.value)}
                  disabled={loading || loadingDirs}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {warehouseOptions.map((wh) => (
                    <option key={wh.code} value={wh.code}>
                      {wh.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="rack-zone" className="text-sm font-medium">
                  Зона
                </label>
                <div className="flex gap-2">
                  <select
                    id="rack-zone"
                    value={`${warehouseCode}::${zoneCode}`}
                    onChange={(e) => {
                      const [, zc] = e.target.value.split("::")
                      if (zc) setZoneCode(zc)
                    }}
                    disabled={loading || loadingDirs || zoneOptions.length === 0}
                    className="flex h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    {zoneOptions.map((z) => (
                      <option
                        key={`${z.warehouseCode}-${z.zoneCode}`}
                        value={`${z.warehouseCode}::${z.zoneCode}`}
                      >
                        {formatZoneSelectLabel(z.zoneCode, z.zoneName, z.warehouseCode)}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void handleCreateZone()}
                    disabled={loading || loadingDirs}
                  >
                    +
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rack-category" className="text-sm font-medium">
                Подгруппа приёмки (профиль ячеек)
              </label>
              <select
                id="rack-category"
                value={receivingCategoryCode}
                onChange={(e) => setReceivingCategoryCode(e.target.value)}
                disabled={loading || loadingDirs || receivingCategories.length === 0}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {receivingCategories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
              {selectedCategory?.linkedGroupCodes?.length ? (
                <p className="text-muted-foreground text-xs">
                  Группы: {selectedCategory.linkedGroupCodes.join(", ")}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label htmlFor="rack-prefix" className="text-sm font-medium">
                  Префикс ячеек
                </label>
                <Input
                  id="rack-prefix"
                  value={codePrefix}
                  onChange={(e) => setCodePrefix(e.target.value.toUpperCase())}
                  placeholder="A"
                  disabled={loading || loadingDirs}
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="rack-start" className="text-sm font-medium">
                  С номера
                </label>
                <Input
                  id="rack-start"
                  inputMode="numeric"
                  value={startIndex}
                  onChange={(e) => setStartIndex(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  disabled={loading || loadingDirs}
                  className="rounded-lg"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="rack-count" className="text-sm font-medium">
                  Ячеек (1–{MAX_WAITING_BATCH_COUNT})
                </label>
                <Input
                  id="rack-count"
                  inputMode="numeric"
                  value={count}
                  onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  disabled={loading || loadingDirs}
                  className="rounded-lg"
                />
              </div>
            </div>

            <p className="text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2 font-mono text-xs">
              Ячейки: {previewEnd}
            </p>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {createdRack ? "Закрыть" : "Отмена"}
          </Button>
          {!createdRack ? (
            <Button onClick={() => void handleSubmit()} disabled={loading || loadingDirs}>
              {loading ? "Создание…" : "Создать стеллаж с ячейками"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
