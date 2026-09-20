"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Pencil, Plus, RefreshCw } from "lucide-react"
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
import { WAREHOUSE_STATUS_CODES } from "@/lib/wms/warehouse-directory-meta"
import { isWorkshopDirectoryRow } from "@/lib/wms/workshop-directory"

const WAREHOUSE_TYPES = [
  "MAIN",
  "RESERVE",
  "PRODUCTION",
  "QUARANTINE",
  "TRANSIT",
  "RETURNS",
  "DEFECTIVE",
  "VIRTUAL",
] as const

const ACCOUNTING_MODES = ["PIECE", "BATCH", "SERIAL", "MARKING"] as const

type MetaForm = {
  isDefault: boolean
  isVirtual: boolean
  isQuarantine: boolean
  isProduction: boolean
  isTransit: boolean
  locationName: string
  defaultZoneId: string
  defaultCellId: string
  addrCountry: string
  addrRegion: string
  addrCity: string
  addrStreet: string
  addrBuilding: string
  addrRoom: string
  addrFull: string
  hasZones: boolean
  hasCells: boolean
  allowReceiving: boolean
  allowTransferFrom: boolean
  allowTransferTo: boolean
  allowWriteOff: boolean
  allowInventory: boolean
  fefoEnabled: boolean
  expirationControlEnabled: boolean
  nearExpirationDays: number
  criticalExpirationDays: number
  blockExpiredItems: boolean
  allowNoExpirationDate: boolean
  defaultPrinterId: string
  defaultPrinterName: string
  printLabelOnReceiving: boolean
  labelTemplateId: string
  labelWidthMm: number
  labelHeightMm: number
  accountingMode: (typeof ACCOUNTING_MODES)[number]
  negativeStockAllowed: boolean
  reservationEnabled: boolean
  batchControlEnabled: boolean
  serialControlEnabled: boolean
  markingCodeControlEnabled: boolean
  allowedUserIdsComma: string
  externalId: string
  externalCode: string
  erpWarehouseCode: string
  scadaAreaCode: string
  managerUserId: string
  defaultKeeperUserId: string
}

function metaFromRow(m: Record<string, unknown>): MetaForm {
  const g = (k: string, def: unknown) => (m[k] !== undefined ? m[k] : def)
  const addr =
    m.address && typeof m.address === "object" && !Array.isArray(m.address)
      ? (m.address as Record<string, unknown>)
      : {}
  const allowedRaw = g("allowedUserIds", [])
  const allowedComma = Array.isArray(allowedRaw)
    ? allowedRaw.map((x) => String(x)).join(", ")
    : ""

  const am = String(g("accountingMode", "MARKING") ?? "MARKING")
  const accountingMode = (ACCOUNTING_MODES as readonly string[]).includes(am)
    ? (am as MetaForm["accountingMode"])
    : "MARKING"

  return {
    isDefault: Boolean(g("isDefault", false)),
    isVirtual: Boolean(g("isVirtual", false)),
    isQuarantine: Boolean(g("isQuarantine", false)),
    isProduction: Boolean(g("isProduction", false)),
    isTransit: Boolean(g("isTransit", false)),
    locationName: String(g("locationName", "") ?? ""),
    defaultZoneId: String(g("defaultZoneId", "") ?? ""),
    defaultCellId: String(g("defaultCellId", "") ?? ""),
    addrCountry: String(addr.country ?? ""),
    addrRegion: String(addr.region ?? ""),
    addrCity: String(addr.city ?? ""),
    addrStreet: String(addr.street ?? ""),
    addrBuilding: String(addr.building ?? ""),
    addrRoom: String(addr.room ?? ""),
    addrFull: String(addr.fullAddress ?? ""),
    hasZones: Boolean(g("hasZones", true)),
    hasCells: Boolean(g("hasCells", true)),
    allowReceiving: Boolean(g("allowReceiving", true)),
    allowTransferFrom: Boolean(g("allowTransferFrom", true)),
    allowTransferTo: Boolean(g("allowTransferTo", true)),
    allowWriteOff: Boolean(g("allowWriteOff", true)),
    allowInventory: Boolean(g("allowInventory", true)),
    fefoEnabled: Boolean(g("fefoEnabled", true)),
    expirationControlEnabled: Boolean(g("expirationControlEnabled", true)),
    nearExpirationDays: Number(g("nearExpirationDays", 60)) || 60,
    criticalExpirationDays: Number(g("criticalExpirationDays", 30)) || 30,
    blockExpiredItems: Boolean(g("blockExpiredItems", true)),
    allowNoExpirationDate: Boolean(g("allowNoExpirationDate", false)),
    defaultPrinterId: String(g("defaultPrinterId", "") ?? ""),
    defaultPrinterName: String(g("defaultPrinterName", "") ?? ""),
    printLabelOnReceiving: Boolean(g("printLabelOnReceiving", true)),
    labelTemplateId: String(g("labelTemplateId", "") ?? ""),
    labelWidthMm: Number(g("labelWidthMm", 58)) || 58,
    labelHeightMm: Number(g("labelHeightMm", 40)) || 40,
    accountingMode,
    negativeStockAllowed: Boolean(g("negativeStockAllowed", false)),
    reservationEnabled: Boolean(g("reservationEnabled", true)),
    batchControlEnabled: Boolean(g("batchControlEnabled", true)),
    serialControlEnabled: Boolean(g("serialControlEnabled", false)),
    markingCodeControlEnabled: Boolean(g("markingCodeControlEnabled", true)),
    allowedUserIdsComma: allowedComma,
    externalId: String(g("externalId", "") ?? ""),
    externalCode: String(g("externalCode", "") ?? ""),
    erpWarehouseCode: String(g("erpWarehouseCode", "") ?? ""),
    scadaAreaCode: String(g("scadaAreaCode", "") ?? ""),
    managerUserId: String(g("managerUserId", "") ?? ""),
    defaultKeeperUserId: String(g("defaultKeeperUserId", "") ?? ""),
  }
}

function metaToRecord(f: MetaForm): Record<string, unknown> {
  const address: Record<string, string> = {}
  const a = (k: string, v: string) => {
    const t = v.trim()
    if (t) address[k] = t
  }
  a("country", f.addrCountry)
  a("region", f.addrRegion)
  a("city", f.addrCity)
  a("street", f.addrStreet)
  a("building", f.addrBuilding)
  a("room", f.addrRoom)
  a("fullAddress", f.addrFull)

  const allowedUserIds = f.allowedUserIdsComma
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    isDefault: f.isDefault,
    isVirtual: f.isVirtual,
    isQuarantine: f.isQuarantine,
    isProduction: f.isProduction,
    isTransit: f.isTransit,
    locationName: f.locationName.trim() || undefined,
    defaultZoneId: f.defaultZoneId.trim() || undefined,
    defaultCellId: f.defaultCellId.trim() || undefined,
    address: Object.keys(address).length ? address : undefined,
    hasZones: f.hasZones,
    hasCells: f.hasCells,
    allowReceiving: f.allowReceiving,
    allowTransferFrom: f.allowTransferFrom,
    allowTransferTo: f.allowTransferTo,
    allowWriteOff: f.allowWriteOff,
    allowInventory: f.allowInventory,
    fefoEnabled: f.fefoEnabled,
    expirationControlEnabled: f.expirationControlEnabled,
    nearExpirationDays: f.nearExpirationDays,
    criticalExpirationDays: f.criticalExpirationDays,
    blockExpiredItems: f.blockExpiredItems,
    allowNoExpirationDate: f.allowNoExpirationDate,
    defaultPrinterId: f.defaultPrinterId.trim() || undefined,
    defaultPrinterName: f.defaultPrinterName.trim() || undefined,
    printLabelOnReceiving: f.printLabelOnReceiving,
    labelTemplateId: f.labelTemplateId.trim() || undefined,
    labelWidthMm: f.labelWidthMm,
    labelHeightMm: f.labelHeightMm,
    accountingMode: f.accountingMode,
    negativeStockAllowed: f.negativeStockAllowed,
    reservationEnabled: f.reservationEnabled,
    batchControlEnabled: f.batchControlEnabled,
    serialControlEnabled: f.serialControlEnabled,
    markingCodeControlEnabled: f.markingCodeControlEnabled,
    allowedUserIds: allowedUserIds.length ? allowedUserIds : undefined,
    externalId: f.externalId.trim() || undefined,
    externalCode: f.externalCode.trim() || undefined,
    erpWarehouseCode: f.erpWarehouseCode.trim() || undefined,
    scadaAreaCode: f.scadaAreaCode.trim() || undefined,
    managerUserId: f.managerUserId.trim() || undefined,
    defaultKeeperUserId: f.defaultKeeperUserId.trim() || undefined,
  }
}

export function SettingsDirectoriesWarehouses() {
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
  const [status, setStatus] = useState<(typeof WAREHOUSE_STATUS_CODES)[number]>("ACTIVE")
  const [warehouseType, setWarehouseType] = useState<string>("MAIN")
  const [meta, setMeta] = useState<MetaForm>(() => metaFromRow({}))

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectoryWarehouses()
      setRows((res.warehouses || []).filter((w) => !isWorkshopDirectoryRow(w)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить склады")
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
    setWarehouseType("MAIN")
    setMeta(metaFromRow({}))
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
      (WAREHOUSE_STATUS_CODES as readonly string[]).includes(row.status)
        ? (row.status as (typeof WAREHOUSE_STATUS_CODES)[number])
        : "ACTIVE"
    )
    setWarehouseType(row.warehouseType || "MAIN")
    setMeta(metaFromRow(row.meta || {}))
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
      const payloadMeta = metaToRecord(meta)
      if (editing) {
        await patchDirectoryWarehouse(editing.id, {
          code: c,
          name: n,
          shortName: shortName.trim() || null,
          description: description.trim() || null,
          status,
          warehouseType,
          meta: payloadMeta,
        })
      } else {
        await createDirectoryWarehouse({
          code: c,
          name: n,
          shortName: shortName.trim() || null,
          description: description.trim() || null,
          status,
          warehouseType,
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
          <h3 className="text-lg font-semibold text-foreground">Склады</h3>
          <p className="text-sm text-muted-foreground">
            Карточка склада: код, тип, статус и расширенные настройки в JSON meta (FEFO, печать, права — связи с пользователями по userId).
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <Button type="button" size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить склад
          </Button>
        </div>
      </div>

      {error && !dialogOpen && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="font-medium">Не удалось загрузить склады</div>
          <div className="mt-1">{error}</div>
          <Button type="button" variant="outline" size="sm" className="mt-3 rounded-xl" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Повторить
          </Button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : error && rows.length === 0 ? null : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Нет складов в справочнике. Создайте первую карточку или импортируйте локации — склады создаются и при импорте.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {rows.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/40">
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold text-foreground">{w.code}</div>
                <div className="truncate text-sm text-foreground">{w.name}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>uuid: {w.publicId.slice(0, 8)}…</span>
                  <span>тип: {w.warehouseType}</span>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Карточка склада" : "Новый склад"}</DialogTitle>
            <DialogDescription>
              Код склада используется в документах и привязке ячеек. Связь с пользователями — поля managerUserId / defaultKeeperUserId (ID из списка пользователей площадки).
            </DialogDescription>
          </DialogHeader>

          {error && dialogOpen && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Код склада</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!editing} className="rounded-xl font-mono" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Наименование</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Краткое название</label>
              <Input value={shortName} onChange={(e) => setShortName(e.target.value)} className="rounded-xl" placeholder="Для заголовков и ТСД" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Описание</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Статус</label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as (typeof WAREHOUSE_STATUS_CODES)[number])}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WAREHOUSE_STATUS_CODES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Тип склада</label>
                <Select value={warehouseType} onValueChange={setWarehouseType}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WAREHOUSE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Признаки</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["isDefault", "Склад по умолчанию"],
                    ["isVirtual", "Виртуальный"],
                    ["isQuarantine", "Карантин"],
                    ["isProduction", "Производственный"],
                    ["isTransit", "Транзит"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                    <span className="text-sm">{label}</span>
                    <Switch
                      checked={meta[key]}
                      onCheckedChange={(v) => setMeta((m) => ({ ...m, [key]: v }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Местоположение</div>
              <label className="mb-2 block text-xs text-muted-foreground">
                Внутреннее (цех, этаж)
              </label>
              <Input
                value={meta.locationName}
                onChange={(e) => setMeta((m) => ({ ...m, locationName: e.target.value }))}
                placeholder="Корпус 1, 2 этаж, помещение маркировки"
                className="mb-3 rounded-xl"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">defaultZoneId</label>
                  <Input
                    className="rounded-xl font-mono text-sm"
                    value={meta.defaultZoneId}
                    onChange={(e) => setMeta((m) => ({ ...m, defaultZoneId: e.target.value }))}
                    placeholder="UUID зоны по умолчанию"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">defaultCellId</label>
                  <Input
                    className="rounded-xl font-mono text-sm"
                    value={meta.defaultCellId}
                    onChange={(e) => setMeta((m) => ({ ...m, defaultCellId: e.target.value }))}
                    placeholder="UUID ячейки по умолчанию"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Адрес (юридический / почтовый)</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Страна"
                  className="rounded-xl"
                  value={meta.addrCountry}
                  onChange={(e) => setMeta((m) => ({ ...m, addrCountry: e.target.value }))}
                />
                <Input
                  placeholder="Регион"
                  className="rounded-xl"
                  value={meta.addrRegion}
                  onChange={(e) => setMeta((m) => ({ ...m, addrRegion: e.target.value }))}
                />
                <Input
                  placeholder="Город"
                  className="rounded-xl"
                  value={meta.addrCity}
                  onChange={(e) => setMeta((m) => ({ ...m, addrCity: e.target.value }))}
                />
                <Input
                  placeholder="Улица"
                  className="rounded-xl"
                  value={meta.addrStreet}
                  onChange={(e) => setMeta((m) => ({ ...m, addrStreet: e.target.value }))}
                />
                <Input
                  placeholder="Дом / строение"
                  className="rounded-xl"
                  value={meta.addrBuilding}
                  onChange={(e) => setMeta((m) => ({ ...m, addrBuilding: e.target.value }))}
                />
                <Input
                  placeholder="Помещение / офис"
                  className="rounded-xl"
                  value={meta.addrRoom}
                  onChange={(e) => setMeta((m) => ({ ...m, addrRoom: e.target.value }))}
                />
              </div>
              <Input
                className="mt-2 rounded-xl"
                placeholder="Полный адрес одной строкой"
                value={meta.addrFull}
                onChange={(e) => setMeta((m) => ({ ...m, addrFull: e.target.value }))}
              />
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Доступ к складу (ТСД)</div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Разрешённые пользователи — <span className="font-mono">userId</span> через запятую
              </label>
              <Input
                className="rounded-xl font-mono text-sm"
                value={meta.allowedUserIdsComma}
                onChange={(e) => setMeta((m) => ({ ...m, allowedUserIdsComma: e.target.value }))}
                placeholder="1, 2, 3"
              />
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Структура и операции</div>
              <div className="grid gap-3">
                {(
                  [
                    ["hasZones", "Есть зоны"],
                    ["hasCells", "Есть ячейки"],
                    ["allowReceiving", "Приёмка"],
                    ["allowTransferFrom", "Отгрузка со склада"],
                    ["allowTransferTo", "Передача на склад"],
                    ["allowWriteOff", "Списание"],
                    ["allowInventory", "Инвентаризация"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                    <span className="text-sm">{label}</span>
                    <Switch
                      checked={meta[key]}
                      onCheckedChange={(v) => setMeta((m) => ({ ...m, [key]: v }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">FEFO и сроки</div>
              <p className="mb-3 text-xs text-muted-foreground">
                Пороги сроков для склада. Подробнее —{" "}
                <Link href="/help#fefo" className="text-primary underline-offset-2 hover:underline">
                  справка FEFO и ячейки
                </Link>
                .
              </p>
              <div className="mb-3 flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span className="text-sm">FEFO</span>
                <Switch checked={meta.fefoEnabled} onCheckedChange={(v) => setMeta((m) => ({ ...m, fefoEnabled: v }))} />
              </div>
              <div className="mb-3 flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span className="text-sm">Контроль срока годности</span>
                <Switch
                  checked={meta.expirationControlEnabled}
                  onCheckedChange={(v) => setMeta((m) => ({ ...m, expirationControlEnabled: v }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Порог «скоро истекает», дн.</label>
                  <Input
                    type="number"
                    value={meta.nearExpirationDays}
                    onChange={(e) => setMeta((m) => ({ ...m, nearExpirationDays: Number(e.target.value) || 0 }))}
                    className="rounded-xl"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Критический порог, дн.</label>
                  <Input
                    type="number"
                    value={meta.criticalExpirationDays}
                    onChange={(e) => setMeta((m) => ({ ...m, criticalExpirationDays: Number(e.target.value) || 0 }))}
                    className="rounded-xl"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span className="text-sm">Блокировать просрочку</span>
                <Switch
                  checked={meta.blockExpiredItems}
                  onCheckedChange={(v) => setMeta((m) => ({ ...m, blockExpiredItems: v }))}
                />
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span className="text-sm">Разрешать маркировку без срока годности</span>
                <Switch
                  checked={meta.allowNoExpirationDate}
                  onCheckedChange={(v) => setMeta((m) => ({ ...m, allowNoExpirationDate: v }))}
                />
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Печать этикеток</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">defaultPrinterId</label>
                  <Input
                    className="rounded-xl font-mono text-sm"
                    value={meta.defaultPrinterId}
                    onChange={(e) => setMeta((m) => ({ ...m, defaultPrinterId: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Имя принтера</label>
                  <Input
                    className="rounded-xl"
                    placeholder="TSC TE200 — склад маркировки"
                    value={meta.defaultPrinterName}
                    onChange={(e) => setMeta((m) => ({ ...m, defaultPrinterName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">labelTemplateId</label>
                  <Input
                    className="rounded-xl font-mono text-sm"
                    value={meta.labelTemplateId}
                    onChange={(e) => setMeta((m) => ({ ...m, labelTemplateId: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Ширина, мм</label>
                    <Input
                      type="number"
                      className="rounded-xl"
                      value={meta.labelWidthMm}
                      onChange={(e) => setMeta((m) => ({ ...m, labelWidthMm: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Высота, мм</label>
                    <Input
                      type="number"
                      className="rounded-xl"
                      value={meta.labelHeightMm}
                      onChange={(e) => setMeta((m) => ({ ...m, labelHeightMm: Number(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span className="text-sm">Печать этикетки при приёмке</span>
                <Switch
                  checked={meta.printLabelOnReceiving}
                  onCheckedChange={(v) => setMeta((m) => ({ ...m, printLabelOnReceiving: v }))}
                />
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Учёт запасов</div>
              <div className="mb-3 grid gap-2 sm:max-w-xs">
                <label className="text-xs text-muted-foreground">Режим учёта</label>
                <Select
                  value={meta.accountingMode}
                  onValueChange={(v) =>
                    setMeta((m) => ({ ...m, accountingMode: v as MetaForm["accountingMode"] }))
                  }
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNTING_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {mode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["negativeStockAllowed", "Разрешить отрицательные остатки"],
                    ["reservationEnabled", "Резервирование"],
                    ["batchControlEnabled", "Партионный контроль"],
                    ["serialControlEnabled", "Серийный контроль"],
                    ["markingCodeControlEnabled", "Контроль кодов маркировки"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                    <span className="text-sm">{label}</span>
                    <Switch
                      checked={meta[key]}
                      onCheckedChange={(v) => setMeta((m) => ({ ...m, [key]: v }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Интеграции (внешние коды)</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="externalId"
                  className="rounded-xl font-mono text-sm"
                  value={meta.externalId}
                  onChange={(e) => setMeta((m) => ({ ...m, externalId: e.target.value }))}
                />
                <Input
                  placeholder="externalCode"
                  className="rounded-xl font-mono text-sm"
                  value={meta.externalCode}
                  onChange={(e) => setMeta((m) => ({ ...m, externalCode: e.target.value }))}
                />
                <Input
                  placeholder="erpWarehouseCode (1С / ERP)"
                  className="rounded-xl font-mono text-sm"
                  value={meta.erpWarehouseCode}
                  onChange={(e) => setMeta((m) => ({ ...m, erpWarehouseCode: e.target.value }))}
                />
                <Input
                  placeholder="scadaAreaCode"
                  className="rounded-xl font-mono text-sm"
                  value={meta.scadaAreaCode}
                  onChange={(e) => setMeta((m) => ({ ...m, scadaAreaCode: e.target.value }))}
                />
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-2 text-sm font-semibold text-foreground">Ответственные (userId)</div>
              <Input
                className="mb-2 rounded-xl font-mono text-sm"
                placeholder="managerUserId"
                value={meta.managerUserId}
                onChange={(e) => setMeta((m) => ({ ...m, managerUserId: e.target.value }))}
              />
              <Input
                className="rounded-xl font-mono text-sm"
                placeholder="defaultKeeperUserId (кладовщик)"
                value={meta.defaultKeeperUserId}
                onChange={(e) => setMeta((m) => ({ ...m, defaultKeeperUserId: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button type="button" className="rounded-xl bg-primary text-primary-foreground" onClick={() => void submitDialog()} disabled={saving}>
              {saving ? "Сохранение…" : editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
