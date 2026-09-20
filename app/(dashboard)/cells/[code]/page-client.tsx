"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Copy,
  History,
  Loader2,
  Lock,
  MapPin,
  Package,
  PlugZap,
  RefreshCw,
  Scale,
  Shield,
  Timer,
  Trash2,
  Warehouse,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CellLocationRules } from "@/components/wms/cells/cell-location-rules"
import { CellPlacementTest } from "@/components/wms/cells/cell-placement-test"
import { CellsProfileTemplates } from "@/components/wms/cells/cells-profile-templates"
import { CellsRulesTest } from "@/components/wms/cells/cells-rules-test"
import { useCellsRequestGuard } from "@/components/wms/cells/cells-request-guard"
import { CellLocationBarcode } from "@/components/wms/cells/cell-location-barcode"
import { CellsWriteoffDialog } from "@/components/wms/cells/cells-writeoff-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RackBarcode } from "@/components/wms/rack-barcode"
import { CellsLocationCodeHelp } from "@/components/wms/cells/cells-location-code-help"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { StorageSlotProfileForm } from "@/components/wms/storage-slot-profile-form"
import {
  getWmsLocationDetail,
  getRackByLocation,
  moveWmsLotBucket,
  patchWmsLocationSlotProfile,
  setWmsLocationBlocked,
  deleteWmsLocation,
  updateWmsLot,
  type WmsLocationDetailResponse,
  type WmsLocationStockLotRow,
  type RackDirectoryRow,
} from "@/lib/wms-api"
import {
  buildSlotTitle,
  EMPTY_SLOT_PROFILE,
  resolveLocationCode,
  formatCellQty,
  slotLabel,
  warehouseDisplayLabel,
  zoneDisplayLabel,
  type StorageSlotProfile,
} from "@/lib/storage-slot-ui"
import {
  accuracyStatusLabelRU,
  locationStatusLabelRU,
  movementTypeLabelRU,
} from "@/lib/wms-labels"
import { WorkshopCodesPanel } from "@/components/wms/workshop-codes-panel"

function isBlockedStatus(status: string) {
  return status.toLowerCase().includes("block")
}

function formatDateShort(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

function lotExpiryValue(row: Pick<WmsLocationStockLotRow, "expiryAt" | "bestBeforeAt">) {
  return row.expiryAt || row.bestBeforeAt || null
}

function daysLeft(value: string | null | undefined) {
  if (!value) return null
  const end = new Date(value)
  if (Number.isNaN(end.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  return Math.ceil((end.getTime() - today.getTime()) / 86400000)
}

function lotRiskMeta(row: WmsLocationStockLotRow) {
  if (row.isBlocked) {
    return { label: "Блок", className: "bg-destructive/10 text-destructive border-destructive/20" }
  }
  if (Number(row.quarantineQty || 0) > 0) {
    return { label: "Карантин", className: "bg-amber-100 text-amber-800 border-amber-200" }
  }
  const left = daysLeft(lotExpiryValue(row))
  if (left == null) {
    return { label: "Без срока", className: "bg-secondary text-muted-foreground border-border" }
  }
  if (left < 0) {
    return { label: "Просрочено", className: "bg-destructive/10 text-destructive border-destructive/20" }
  }
  if (left <= 7) {
    return { label: `${left} дн.`, className: "bg-red-100 text-red-800 border-red-200" }
  }
  if (left <= 30) {
    return { label: `${left} дн.`, className: "bg-amber-100 text-amber-800 border-amber-200" }
  }
  return { label: `${left} дн.`, className: "bg-lime-100 text-lime-900 border-lime-200" }
}

function CellDetailPageInner() {
  const params = useParams()
  const router = useRouter()
  const search = useSearchParams()
  const raw = typeof params?.code === "string" ? params.code : ""
  const locationCode = raw ? decodeURIComponent(raw) : ""

  const from = (search.get("from") || "").trim()
  const tabParam = (search.get("tab") || "").trim()
  const initialTab = ["overview", "profile", "stock", "rules", "api", "history", "codes"].includes(tabParam)
    ? tabParam
    : "overview"
  const backHref = from ? `/cells?${decodeURIComponent(from)}` : "/cells"

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writeoffOpen, setWriteoffOpen] = useState(false)
  const [data, setData] = useState<WmsLocationDetailResponse | null>(null)
  const [rack, setRack] = useState<RackDirectoryRow | null>(null)

  const [lotOpen, setLotOpen] = useState(false)
  const [activeLotId, setActiveLotId] = useState<string | null>(null)
  const [lotSaving, setLotSaving] = useState(false)
  const [lotError, setLotError] = useState<string | null>(null)
  const [lotQaStatusCode, setLotQaStatusCode] = useState("")
  const [lotNote, setLotNote] = useState("")
  const [lotMoveQty, setLotMoveQty] = useState("")
  const [slotProfile, setSlotProfile] = useState<StorageSlotProfile>({ ...EMPTY_SLOT_PROFILE })
  const [slotSaving, setSlotSaving] = useState(false)
  const [slotSaved, setSlotSaved] = useState(false)
  const [apiOrigin, setApiOrigin] = useState("")
  const { nextGeneration, isCurrent } = useCellsRequestGuard()

  const load = useCallback(async () => {
    if (!locationCode.trim()) return
    const generation = nextGeneration()
    setLoading(true)
    setError(null)
    try {
      const d = await getWmsLocationDetail(locationCode)
      const rackRes = await getRackByLocation(locationCode).catch(() => ({ rack: null }))
      if (!isCurrent(generation)) return
      setData(d)
      setRack(rackRes.rack ?? null)
      const sp = d.location?.slotProfile
      setSlotProfile(sp ? { ...EMPTY_SLOT_PROFILE, ...sp } : { ...EMPTY_SLOT_PROFILE })
      setSlotSaved(false)
    } catch (e) {
      if (!isCurrent(generation)) return
      setError(e instanceof Error ? e.message : "Не удалось загрузить ячейку")
      setData(null)
      setRack(null)
    } finally {
      if (isCurrent(generation)) setLoading(false)
    }
  }, [locationCode, nextGeneration, isCurrent])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setApiOrigin(window.location.origin)
  }, [])

  const loc = data?.location
  const stock = data?.stock || []
  const lots = data?.lots ?? []
  const history = data?.history || []

  const activeLot = useMemo(() => {
    if (!activeLotId) return null
    return lots.find((x) => String(x.lotId) === activeLotId) ?? null
  }, [lots, activeLotId])

  useEffect(() => {
    if (!lotOpen || !activeLot) return
    setLotError(null)
    setLotQaStatusCode(String(activeLot.qaStatusCode ?? ""))
    setLotNote(String(activeLot.note ?? ""))
    const avail = Number(activeLot.availableQty ?? 0)
    setLotMoveQty(avail > 0 ? String(Math.round(avail)) : "")
  }, [lotOpen, activeLot])

  function openLot(lotId: string) {
    setActiveLotId(lotId)
    setLotOpen(true)
  }

  async function saveLotFields() {
    if (!activeLotId) return
    setLotSaving(true)
    setLotError(null)
    try {
      await updateWmsLot(activeLotId, {
        qaStatusCode: lotQaStatusCode.trim() || null,
        note: lotNote.trim() || null,
      })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Не удалось сохранить лот")
    } finally {
      setLotSaving(false)
    }
  }

  async function toggleLotBlocked() {
    if (!activeLotId || !activeLot) return
    setLotSaving(true)
    setLotError(null)
    try {
      await updateWmsLot(activeLotId, { isBlocked: !Boolean(activeLot.isBlocked) })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Не удалось изменить блокировку")
    } finally {
      setLotSaving(false)
    }
  }

  async function moveLot(fromBucket: "available" | "quarantine", toBucket: "available" | "quarantine") {
    if (!activeLotId) return
    const qty = Number(lotMoveQty)
    if (!(qty > 0)) {
      setLotError("Укажите количество больше 0")
      return
    }
    setLotSaving(true)
    setLotError(null)
    try {
      await moveWmsLotBucket({ lotId: activeLotId, fromBucket, toBucket, qty })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Не удалось переместить между корзинами")
    } finally {
      setLotSaving(false)
    }
  }

  const semanticPreview = useMemo(() => {
    return resolveLocationCode(slotProfile, locationCode) || locationCode
  }, [slotProfile, locationCode])

  const totals = useMemo(() => {
    const s = { available: 0, reserved: 0, quarantine: 0, rejected: 0, inProduction: 0 }
    for (const row of stock) {
      s.available += Number(row.availableQty || 0)
      s.reserved += Number(row.reservedQty || 0)
      s.quarantine += Number(row.quarantineQty || 0)
      s.rejected += Number(row.rejectedQty || 0)
      s.inProduction += Number(row.inProductionQty || 0)
    }
    return s
  }, [stock])

  const totalQty =
    totals.available + totals.reserved + totals.quarantine + totals.rejected + totals.inProduction

  const sortedLots = useMemo(() => {
    return [...lots].sort((a, b) => {
      const ax = lotExpiryValue(a) ? new Date(lotExpiryValue(a)!).getTime() : Number.MAX_SAFE_INTEGER
      const bx = lotExpiryValue(b) ? new Date(lotExpiryValue(b)!).getTime() : Number.MAX_SAFE_INTEGER
      if (ax !== bx) return ax - bx
      return String(a.itemName || a.itemCode).localeCompare(String(b.itemName || b.itemCode), "ru")
    })
  }, [lots])

  const nearestLot = useMemo(() => {
    return sortedLots.find((row) => Number(row.availableQty || 0) > 0) ?? sortedLots[0] ?? null
  }, [sortedLots])

  const isProductionCell = useMemo(() => {
    if (data?.location?.isWorkshop) return true
    if ((data?.markingCodesTotal ?? 0) > 0) return true
    const hay = [
      locationCode,
      loc?.displayName,
      loc?.warehouseCode,
      loc?.zoneCode,
      loc?.slotTitle,
      slotProfile.processType,
      slotProfile.equipment,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return (
      totals.inProduction > 0 ||
      hay.includes("цех") ||
      hay.includes("line") ||
      hay.includes("prod") ||
      hay.includes("sipa") ||
      hay.includes("производ")
    )
  }, [loc, locationCode, slotProfile, totals.inProduction, data?.location?.isWorkshop, data?.markingCodesTotal])

  const productionApiUrl = `${apiOrigin || "http://localhost:3000"}/api/wms/production/consume`
  const apiQtyExample = useMemo(
    () =>
      JSON.stringify(
        {
          siteCode: "DEFAULT",
          requestId: "00000000-0000-4000-8000-000000000001",
          locationCode,
          itemCode: stock[0]?.itemCode || "GTIN_OR_ITEM_CODE",
          qty: 180000,
          sourceSystem: "line-camera",
          externalEventId: "line-batch-001",
          lineCode: loc?.zoneCode || "SIPA",
        },
        null,
        2
      ),
    [locationCode, loc?.zoneCode, stock]
  )
  const apiDmExample = useMemo(
    () =>
      JSON.stringify(
        {
          siteCode: "DEFAULT",
          requestId: "00000000-0000-4000-8000-000000000002",
          locationCode,
          datamatrix: "010123456789012821SERIAL123",
          sourceSystem: "line-camera",
          externalEventId: "camera-event-001",
          lineCode: loc?.zoneCode || "SIPA",
        },
        null,
        2
      ),
    [locationCode, loc?.zoneCode]
  )
  const apiCurlExample = useMemo(
    () =>
      [
        `curl -X POST "${productionApiUrl}" \\`,
        `  -H "Authorization: Bearer <TOKEN>" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${apiDmExample.replace(/'/g, "'\\''")}'`,
      ].join("\n"),
    [apiDmExample, productionApiUrl]
  )

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      /* ignore */
    }
  }

  async function saveSlotProfile() {
    if (!loc) return
    setSlotSaving(true)
    setError(null)
    try {
      await patchWmsLocationSlotProfile(loc.locationCode, {
        slotProfile,
        displayName: buildSlotTitle(slotProfile),
      })
      setSlotSaved(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить профиль ячейки")
    } finally {
      setSlotSaving(false)
    }
  }

  async function toggleBlocked() {
    if (!loc) return
    setBusy(true)
    setError(null)
    try {
      await setWmsLocationBlocked(loc.locationCode, !isBlockedStatus(loc.locationStatus))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить статус")
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!loc) return
    const stockRows = data?.stock ?? []
    const hasStock = stockRows.some(
      (row) =>
        Number(row.availableQty || 0) +
          Number(row.reservedQty || 0) +
          Number(row.inProductionQty || 0) +
          Number(row.quarantineQty || 0) +
          Number(row.rejectedQty || 0) >
        0
    )
    if (hasStock) {
      setError("Нельзя удалить ячейку с остатками. Сначала переместите или спишите товар.")
      return
    }
    if (!confirm(`Удалить ячейку «${loc.locationCode}»? Это действие необратимо.`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteWmsLocation(loc.locationCode)
      router.push(backHref)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить ячейку")
    } finally {
      setBusy(false)
    }
  }

  if (!locationCode) {
    return <div className="p-6 text-destructive">Некорректный код ячейки</div>
  }

  return (
    <div className="space-y-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К ячейкам
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex flex-wrap items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <span className="font-mono break-all">{locationCode}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {loc
              ? `${warehouseDisplayLabel(loc.warehouseCode)} / ${zoneDisplayLabel(loc.zoneCode)}`
              : "—"}
            {loc?.displayName ? <span className="ml-2">· {String(loc.displayName)}</span> : null}
          </p>
          <CellsLocationCodeHelp
            showLink
            linkClassName="mt-1"
            locationCode={locationCode}
            slotProfile={loc?.slotProfile ?? slotProfile}
            warehouseCode={loc?.warehouseCode}
            zoneCode={loc?.zoneCode}
            displayName={loc?.displayName}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl" asChild>
            <Link href="/cells/rules">
              <Scale className="mr-2 h-4 w-4" />
              Правила
            </Link>
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => void load()}
            disabled={loading || busy}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" className="rounded-xl">
                Операции
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setWriteoffOpen(true)}>Списание</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {loc ? (
            <Button
              variant={isBlockedStatus(loc.locationStatus) ? "secondary" : "destructive"}
              className="rounded-xl"
              onClick={() => void toggleBlocked()}
              disabled={busy || loading}
            >
              <Lock className="mr-2 h-4 w-4" />
              {isBlockedStatus(loc.locationStatus) ? "Разблокировать" : "Заблокировать"}
            </Button>
          ) : null}
          {loc ? (
            <Button
              variant="outline"
              className="rounded-xl border-destructive/40 text-destructive hover:bg-destructive/5"
              onClick={() => void handleDelete()}
              disabled={busy || loading}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Удалить
            </Button>
          ) : null}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <Card className="rounded-2xl p-6 shadow-sm">
          <div className="text-sm text-muted-foreground">Загрузка...</div>
        </Card>
      ) : !loc ? (
        <Card className="rounded-2xl p-6 shadow-sm">
          <div className="text-sm text-muted-foreground">Ячейка не найдена</div>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-[1.45fr_.9fr]">
            <Card className="overflow-hidden rounded-3xl border-border/70 bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-lg">
                      <Warehouse className="mr-1 h-3 w-3" />
                      {warehouseDisplayLabel(loc.warehouseCode)}
                    </Badge>
                    <Badge variant="secondary" className="rounded-lg">
                      {zoneDisplayLabel(loc.zoneCode)}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "rounded-lg",
                        isBlockedStatus(loc.locationStatus) && "bg-destructive/10 text-destructive"
                      )}
                    >
                      <Shield className="mr-1 h-3 w-3" />
                      {locationStatusLabelRU(loc.locationStatus)}
                    </Badge>
                  </div>
                  <h2 className="mt-4 text-2xl font-bold leading-tight">
                    {loc.displayName || buildSlotTitle(slotProfile)}
                  </h2>
                  <div className="mt-2 break-all font-mono text-sm text-muted-foreground">
                    {locationCode}
                  </div>
                  <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
                    {slotLabel("materialType", slotProfile.materialType)} ·{" "}
                    {slotLabel("processType", slotProfile.processType)} ·{" "}
                    {slotLabel("productGroup", slotProfile.productGroup)} ·{" "}
                    {slotLabel("volume", slotProfile.volume)}
                  </p>
                </div>

                <div className="rounded-2xl border bg-background/70 p-4 lg:min-w-64">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Timer className="h-4 w-4 text-primary" />
                    FEFO подсказка
                  </div>
                  {nearestLot ? (
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="line-clamp-2 font-medium">{nearestLot.itemName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{nearestLot.lotCode}</div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-lg bg-secondary px-2 py-1">
                          срок {formatDateShort(lotExpiryValue(nearestLot))}
                        </span>
                        <span className="rounded-lg bg-secondary px-2 py-1">
                          доступно {formatCellQty(nearestLot.availableQty)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-muted-foreground">Партий с остатком нет</div>
                  )}
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              {[
                ["Доступно", totals.available, "text-lime-900 bg-lime-100/80"],
                ["В цехе", totals.inProduction, "text-emerald-900 bg-emerald-100/70"],
                ["Карантин", totals.quarantine, "text-amber-900 bg-amber-100/70"],
                ["Всего", totalQty, "text-foreground bg-card"],
              ].map(([label, value, className]) => (
                <Card key={String(label)} className={cn("rounded-2xl p-4 shadow-sm", String(className))}>
                  <div className="text-xs font-medium text-muted-foreground">{label}</div>
                  <div className="mt-2 text-2xl font-bold tabular-nums">{formatCellQty(Number(value))}</div>
                </Card>
              ))}
              <Card className="rounded-2xl p-4 shadow-sm">
                <div className="text-xs font-medium text-muted-foreground">Номенклатур</div>
                <div className="mt-2 text-2xl font-bold tabular-nums">{stock.length}</div>
              </Card>
              <Card className="rounded-2xl p-4 shadow-sm">
                <div className="text-xs font-medium text-muted-foreground">Партий</div>
                <div className="mt-2 text-2xl font-bold tabular-nums">{lots.length}</div>
              </Card>
            </div>
          </section>

          <Tabs defaultValue={initialTab} className="space-y-4">
            <TabsList className="flex h-auto flex-wrap gap-1 rounded-xl bg-secondary/50 p-1">
              <TabsTrigger value="overview" className="rounded-lg text-xs sm:text-sm">
                Обзор
              </TabsTrigger>
              <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm">
                Профиль
              </TabsTrigger>
              <TabsTrigger value="stock" className="rounded-lg text-xs sm:text-sm">
                Остатки
              </TabsTrigger>
              <TabsTrigger value="rules" className="rounded-lg text-xs sm:text-sm">
                Подбор
              </TabsTrigger>
              {isProductionCell ? (
                <TabsTrigger value="codes" className="rounded-lg text-xs sm:text-sm">
                  Коды ЧЗ
                </TabsTrigger>
              ) : null}
              {isProductionCell ? (
                <TabsTrigger value="api" className="rounded-lg text-xs sm:text-sm">
                  API линии
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm">
                История
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0 space-y-4">
          <CellLocationBarcode
            locationCode={locationCode}
            title={loc.displayName ? String(loc.displayName) : undefined}
            subtitle={`${warehouseDisplayLabel(loc.warehouseCode)} · ${zoneDisplayLabel(loc.zoneCode)}`}
            warehouseCode={loc.warehouseCode ? String(loc.warehouseCode) : undefined}
            zoneCode={loc.zoneCode ? String(loc.zoneCode) : undefined}
            slotProfile={loc.slotProfile ?? slotProfile}
            displayName={loc.displayName ? String(loc.displayName) : undefined}
          />
          {rack && rack.cells.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-secondary/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Стеллаж {rack.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{rack.code}</p>
                </div>
                <RackBarcode
                  rackCode={rack.code}
                  rackName={rack.name}
                  cellCodes={rack.cells.map((c) => c.locationCode)}
                  triggerOnly
                />
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="rounded-2xl p-5 shadow-sm">
              <div className="text-sm text-muted-foreground">Статусы</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary" className="rounded-lg">
                  <Warehouse className="mr-1 h-3 w-3" />
                  {warehouseDisplayLabel(loc.warehouseCode)}
                </Badge>
                <Badge variant="secondary" className="rounded-lg">
                  {zoneDisplayLabel(loc.zoneCode)}
                </Badge>
                <Badge
                  variant="secondary"
                  className={cn(
                    "rounded-lg",
                    isBlockedStatus(loc.locationStatus) && "bg-destructive/10 text-destructive"
                  )}
                >
                  <Shield className="mr-1 h-3 w-3" />
                  {locationStatusLabelRU(loc.locationStatus)}
                </Badge>
                <Badge variant="secondary" className="rounded-lg">
                  {accuracyStatusLabelRU(loc.accuracyStatus)}
                </Badge>
                {loc.isPickFace ? (
                  <Badge variant="secondary" className="rounded-lg">
                    Зона отбора
                  </Badge>
                ) : null}
              </div>
            </Card>

            <Card className="rounded-2xl p-5 shadow-sm lg:col-span-2">
              <div className="text-sm text-muted-foreground">Смысловое назначение</div>
              <p className="mt-2 text-sm font-medium">{loc.slotTitle || buildSlotTitle(slotProfile)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-md bg-secondary px-2 py-0.5">
                  {slotLabel("materialType", slotProfile.materialType)}
                </span>
                <span className="rounded-md bg-secondary px-2 py-0.5">
                  {slotLabel("processType", slotProfile.processType)}
                </span>
                <span className="rounded-md bg-secondary px-2 py-0.5">
                  {slotLabel("stickerShape", slotProfile.stickerShape)}
                </span>
                <span className="rounded-md bg-secondary px-2 py-0.5">
                  {slotLabel("productGroup", slotProfile.productGroup)}
                </span>
                <span className="rounded-md bg-secondary px-2 py-0.5">
                  {slotLabel("volume", slotProfile.volume)}
                  {" · "}
                  {slotLabel("equipment", slotProfile.equipment)}
                </span>
              </div>
            </Card>

            <Card className="rounded-2xl p-5 shadow-sm lg:col-span-2">
              <div className="text-sm text-muted-foreground">Итого по ячейке</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-lg bg-secondary px-2 py-1">
                  Доступно {formatCellQty(totals.available)}
                </span>
                <span className="rounded-lg bg-secondary px-2 py-1">
                  Резерв {formatCellQty(totals.reserved)}
                </span>
                <span className="rounded-lg bg-secondary px-2 py-1">
                  Карантин {formatCellQty(totals.quarantine)}
                </span>
                <span className="rounded-lg bg-secondary px-2 py-1">
                  Брак {formatCellQty(totals.rejected)}
                </span>
                <span className="rounded-lg bg-secondary px-2 py-1">
                  В цехе {formatCellQty(totals.inProduction)}
                </span>
              </div>
            </Card>
          </div>
            </TabsContent>

            <TabsContent value="profile" className="mt-0">
          <Card className="rounded-2xl p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Назначение ячейки</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Укажите, что сюда можно класть — при приёмке система будет подбирать ячейки по этим
                  полям.
                </p>
              </div>
              <div className="flex gap-2">
                {slotSaved ? (
                  <span className="text-xs text-success">Сохранено</span>
                ) : null}
                <Button
                  size="sm"
                  className="rounded-xl"
                  onClick={() => void saveSlotProfile()}
                  disabled={slotSaving || busy}
                >
                  {slotSaving ? "Сохранение…" : "Сохранить"}
                </Button>
              </div>
            </div>
            <CellsProfileTemplates
              disabled={slotSaving || busy}
              className="mb-4"
              onPick={(profile) => {
                setSlotProfile({ ...EMPTY_SLOT_PROFILE, ...profile })
                setSlotSaved(false)
              }}
            />
            <StorageSlotProfileForm
              value={slotProfile}
              onChange={(next) => {
                setSlotProfile(next)
                setSlotSaved(false)
              }}
              disabled={slotSaving || busy}
              occupancyItems={stock.map((row) => ({
                itemCode: row.itemCode,
                name: row.name,
              }))}
            />
            <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Название в списке: </span>
              <span className="font-medium">{buildSlotTitle(slotProfile)}</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Системный код: <span className="font-mono text-foreground">{semanticPreview}</span>
            </p>
          </Card>
            </TabsContent>

            <TabsContent value="stock" className="mt-0 space-y-4">
          <Card className="rounded-2xl p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Остатки</h2>
              <span className="text-sm text-muted-foreground">{stock.length}</span>
            </div>

            {stock.length === 0 ? (
              <div className="text-sm text-muted-foreground">Пусто</div>
            ) : (
              <div className="overflow-auto rounded-xl border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-secondary/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Артикул</th>
                      <th className="min-w-[12rem] px-3 py-2 text-left">Наименование</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap min-w-[5rem]">Доступно</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap min-w-[4.5rem]">Резерв</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap min-w-[5rem]">Карантин</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap min-w-[4rem]">Брак</th>
                      <th
                        className="px-3 py-2 text-right whitespace-nowrap min-w-[5rem]"
                        title="В производстве (выдано в цех)"
                      >
                        В цехе
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {stock.map((row) => (
                      <tr key={row.itemCode} className="hover:bg-secondary/30">
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                          <Link
                            href={`/nomenclature/${encodeURIComponent(row.itemCode)}?fromLocation=${encodeURIComponent(locationCode)}`}
                            className="hover:underline"
                          >
                            {row.itemCode}
                          </Link>
                        </td>
                        <td className="max-w-[min(100%,20rem)] px-3 py-2">
                          <div className="font-medium truncate">
                            <Link
                              href={`/nomenclature/${encodeURIComponent(row.itemCode)}?fromLocation=${encodeURIComponent(locationCode)}`}
                              className="hover:underline"
                              title={row.name}
                            >
                              {row.name}
                            </Link>
                          </div>
                          <div className="truncate text-xs text-muted-foreground font-mono">
                            {row.barcode || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatCellQty(row.availableQty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatCellQty(row.reservedQty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatCellQty(row.quarantineQty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatCellQty(row.rejectedQty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatCellQty(row.inProductionQty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="rounded-2xl p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Партии в ячейке</h2>
              <span className="text-sm text-muted-foreground">{lots.length}</span>
            </div>
            {lots.length === 0 ? (
              <div className="text-sm text-muted-foreground">Нет строк по партиям</div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {sortedLots.map((row) => {
                  const risk = lotRiskMeta(row)
                  const expiry = lotExpiryValue(row)
                  return (
                    <div
                      key={`${row.lotId}-${row.itemCode}`}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer rounded-2xl border bg-background p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                      onClick={() => openLot(row.lotId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") openLot(row.lotId)
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/nomenclature/${encodeURIComponent(row.itemCode)}?fromLocation=${encodeURIComponent(locationCode)}&lotCode=${encodeURIComponent(row.lotCode)}`}
                              className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.itemCode}
                            </Link>
                            <Badge variant="outline" className={cn("rounded-lg", risk.className)}>
                              {risk.label}
                            </Badge>
                          </div>
                          <div className="mt-2 line-clamp-2 font-medium">{row.itemName}</div>
                          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            партия {row.lotCode}
                          </div>
                        </div>
                        <Package className="mt-1 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-xl bg-lime-100/70 p-2">
                          <div className="text-muted-foreground">Доступно</div>
                          <div className="mt-1 font-semibold tabular-nums">
                            {formatCellQty(row.availableQty ?? 0)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-secondary/60 p-2">
                          <div className="text-muted-foreground">Резерв</div>
                          <div className="mt-1 font-semibold tabular-nums">
                            {formatCellQty(row.reservedQty ?? 0)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-amber-100/70 p-2">
                          <div className="text-muted-foreground">Карантин</div>
                          <div className="mt-1 font-semibold tabular-nums">
                            {formatCellQty(row.quarantineQty ?? 0)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                        <span>эмиссия {formatDateShort(row.manufacturedAt)}</span>
                        <span>срок {formatDateShort(expiry)}</span>
                        <span>приёмка {formatDateShort(row.receivedAt)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
            </TabsContent>

            <TabsContent value="rules" className="mt-0 space-y-4">
              <Card className="rounded-2xl p-4 shadow-sm">
                <CellLocationRules locationCode={loc.locationCode} />
              </Card>
              <Card className="rounded-2xl p-4 shadow-sm">
                <CellsRulesTest />
              </Card>
              <Card className="rounded-2xl p-4 shadow-sm">
                <CellPlacementTest highlightLocationCode={loc.locationCode} />
              </Card>
            </TabsContent>

            {isProductionCell ? (
              <TabsContent value="codes" className="mt-0 space-y-4">
                <Card className="rounded-2xl p-5 shadow-sm">
                  <WorkshopCodesPanel
                    locationCode={locationCode}
                    title="Коды маркировки в ячейке цеха"
                    initialRows={data?.markingCodes}
                    initialTotal={data?.markingCodesTotal}
                    maxRows={200}
                  />
                </Card>
              </TabsContent>
            ) : null}

            {isProductionCell ? (
              <TabsContent value="api" className="mt-0 space-y-4">
                <Card className="rounded-2xl p-5 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-semibold">
                        <PlugZap className="h-4 w-4 text-primary" />
                        Подключение линии к ячейке
                      </h2>
                      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                        Внешняя программа с камеры отправляет сюда DataMatrix или количество. WMS
                        списывает из поля <span className="font-mono">in_production_qty</span> этой
                        ячейки и пишет документ, движение и журнал события.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => void copyText(productionApiUrl)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Копировать URL
                    </Button>
                  </div>

                  <div className="mt-4 rounded-xl border bg-muted/30 p-3">
                    <div className="text-xs font-medium text-muted-foreground">Endpoint</div>
                    <code className="mt-1 block break-all rounded-lg bg-background px-3 py-2 text-xs">
                      POST {productionApiUrl}
                    </code>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-xl border bg-secondary/30 p-3">
                      <div className="text-xs text-muted-foreground">siteCode</div>
                      <div className="mt-1 font-mono text-sm">DEFAULT</div>
                    </div>
                    <div className="rounded-xl border bg-secondary/30 p-3">
                      <div className="text-xs text-muted-foreground">locationCode</div>
                      <div className="mt-1 break-all font-mono text-sm">{locationCode}</div>
                    </div>
                    <div className="rounded-xl border bg-secondary/30 p-3">
                      <div className="text-xs text-muted-foreground">Остаток в цехе</div>
                      <div className="mt-1 font-mono text-sm">{formatCellQty(totals.inProduction)}</div>
                    </div>
                  </div>
                </Card>

                <Card className="rounded-2xl p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">Списание по DataMatrix</h3>
                      <p className="text-sm text-muted-foreground">
                        Лучший вариант: каждый код маркировки списывается один раз. Повтор того же
                        DataMatrix вернёт <span className="font-mono">duplicate</span> и не уменьшит
                        остаток.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => void copyText(apiDmExample)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      JSON
                    </Button>
                  </div>
                  <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
                    <code>{apiDmExample}</code>
                  </pre>
                </Card>

                <Card className="rounded-2xl p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">Списание количеством</h3>
                      <p className="text-sm text-muted-foreground">
                        Для агрегированного отчёта линии: например было выдано 200000, линия
                        прислала 180000, WMS спишет 180000 из этой ячейки.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => void copyText(apiQtyExample)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      JSON
                    </Button>
                  </div>
                  <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
                    <code>{apiQtyExample}</code>
                  </pre>
                </Card>

                <Card className="rounded-2xl p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">curl для проверки</h3>
                      <p className="text-sm text-muted-foreground">
                        Токен подключения позже лучше вынести в настройки интеграции линии. Сейчас
                        endpoint принимает обычную авторизацию WMS.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => void copyText(apiCurlExample)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      curl
                    </Button>
                  </div>
                  <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
                    <code>{apiCurlExample}</code>
                  </pre>
                </Card>
              </TabsContent>
            ) : null}

            <TabsContent value="history" className="mt-0">
          <Card className="rounded-2xl p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                История движений
              </h2>
              <span className="text-sm text-muted-foreground">{history.length}</span>
            </div>
            {history.length === 0 ? (
              <div className="text-sm text-muted-foreground">Нет движений</div>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 40).map((h, idx) => (
                  <div key={`${h.at}-${idx}`} className="rounded-xl border border-border/60 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{String(h.at)}</span>
                      <span className="rounded-md bg-secondary px-2 py-0.5">
                        {movementTypeLabelRU(h.movementType)}
                      </span>
                      <span className="font-mono">{h.itemCode}</span>
                      <span className="ml-auto font-mono">×{h.qty}</span>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground font-mono">
                      {h.fromLocationCode ?? "—"} → {h.toLocationCode ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
            </TabsContent>
          </Tabs>

          <Dialog
            open={lotOpen}
            onOpenChange={(v) => {
              setLotOpen(v)
              if (!v) {
                setActiveLotId(null)
                setLotError(null)
                setLotSaving(false)
              }
            }}
          >
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Партия в ячейке</DialogTitle>
              </DialogHeader>

              {activeLot ? (
                <div className="space-y-4">
                  {lotError ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {lotError}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Код партии</Label>
                      <Input value={String(activeLot.lotCode ?? "")} readOnly className="mt-1 rounded-xl font-mono text-xs" />
                    </div>
                    <div>
                      <Label>Серия / маркировка</Label>
                      <Input value={String(activeLot.batchLabel ?? "")} readOnly className="mt-1 rounded-xl font-mono text-xs" />
                    </div>
                    <div>
                      <Label>QA статус</Label>
                      <Input
                        value={lotQaStatusCode}
                        onChange={(e) => setLotQaStatusCode(e.target.value)}
                        className="mt-1 rounded-xl"
                        placeholder="ok / hold / failed — код QA"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <Button
                        variant={Boolean(activeLot.isBlocked) ? "secondary" : "destructive"}
                        onClick={() => void toggleLotBlocked()}
                        disabled={lotSaving}
                        className="w-full rounded-xl"
                      >
                        {Boolean(activeLot.isBlocked) ? "Разблокировать" : "Заблокировать"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-3">
                    <div className="col-span-5 sm:col-span-3">
                      <Label>Заметка</Label>
                      <Textarea
                        value={lotNote}
                        onChange={(e) => setLotNote(e.target.value)}
                        className="mt-1 min-h-24 rounded-xl"
                        placeholder="QA, карантин…"
                      />
                    </div>
                    <div className="col-span-5 sm:col-span-2">
                      <Label>Количество</Label>
                      <Input
                        value={lotMoveQty}
                        onChange={(e) => setLotMoveQty(e.target.value)}
                        className="mt-1 rounded-xl"
                        inputMode="decimal"
                      />
                      <div className="mt-2 space-y-2">
                        <Button
                          onClick={() => void moveLot("available", "quarantine")}
                          disabled={lotSaving || Number(activeLot.availableQty ?? 0) <= 0}
                          className="w-full rounded-xl"
                        >
                          В карантин
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void moveLot("quarantine", "available")}
                          disabled={lotSaving || Number(activeLot.quarantineQty ?? 0) <= 0}
                          className="w-full rounded-xl"
                        >
                          Снять карантин
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Доступно {formatCellQty(activeLot.availableQty ?? 0)} · карантин{" "}
                        {formatCellQty(activeLot.quarantineQty ?? 0)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Загрузка…
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="secondary" onClick={() => setLotOpen(false)} className="rounded-xl">
                  Закрыть
                </Button>
                <Button onClick={() => void saveLotFields()} disabled={lotSaving || !activeLotId} className="rounded-xl">
                  Сохранить QA / заметку
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
      <CellsWriteoffDialog
        open={writeoffOpen}
        locationCode={locationCode}
        onOpenChange={setWriteoffOpen}
        onDone={() => void load()}
      />
    </div>
  )
}

export default function CellDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-muted-foreground">
          Загрузка карточки ячейки…
        </div>
      }
    >
      <CellDetailPageInner />
    </Suspense>
  )
}
