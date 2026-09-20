"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MapPin,
  Package,
  Play,
  ScanBarcode,
  AlertTriangle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  completeWmsTaskByDevice,
  getWmsTaskDetail,
  resolveReceivingMarkingCode,
  scanWmsTaskByDevice,
  startWmsTaskByDevice,
  type ResolveReceivingScanResponse,
  type WmsTaskDetailResponse,
  type WmsTaskShipScan,
} from "@/lib/wms-api"
import { addNativeBarcodeListener } from "@/lib/wms-native-barcode"

function formatQty(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—"
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n)
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("ru-RU")
}

function normalizeScan(raw: string) {
  return raw.trim().replace(/\s+/g, "")
}

function readShipScans(payload: unknown): WmsTaskShipScan[] {
  if (!payload || typeof payload !== "object") return []
  const raw = (payload as { shipScans?: unknown }).shipScans
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null
      const rec = row as Record<string, unknown>
      const code = String(rec.code || "").trim()
      const qty = Number(rec.qty)
      if (!code || !Number.isFinite(qty) || qty <= 0) return null
      return {
        code,
        qty,
        itemCode: typeof rec.itemCode === "string" ? rec.itemCode : null,
        itemName: typeof rec.itemName === "string" ? rec.itemName : null,
        expiresAt: typeof rec.expiresAt === "string" ? rec.expiresAt : null,
        manufacturedAt: typeof rec.manufacturedAt === "string" ? rec.manufacturedAt : null,
        at: typeof rec.at === "string" ? rec.at : new Date().toISOString(),
      } satisfies WmsTaskShipScan
    })
    .filter((row): row is WmsTaskShipScan => Boolean(row))
}

function itemMatchesTask(resolved: ResolveReceivingScanResponse, itemCode: string | null) {
  const want = (itemCode || "").trim().toLowerCase()
  if (!want) return true
  const codes = [resolved.primaryItem, resolved.nestedItem]
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => (row.itemCode || "").trim().toLowerCase())
  return codes.includes(want)
}

function scanQtyForCode(resolved: ResolveReceivingScanResponse, remainingQty: number) {
  const per = resolved.specQtyPer
  if (typeof per === "number" && Number.isFinite(per) && per > 1) {
    return remainingQty > 0 ? Math.min(per, remainingQty) : per
  }
  if (resolved.primaryItem.packageRole === "block" && typeof per === "number" && per > 0) {
    return remainingQty > 0 ? Math.min(per, remainingQty) : per
  }
  return 1
}

export default function MobileTaskDetailPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = typeof params.taskId === "string" ? params.taskId : ""

  const [data, setData] = useState<WmsTaskDetailResponse | null>(null)
  const [scans, setScans] = useState<WmsTaskShipScan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanInput, setScanInput] = useState("")
  const [lastOk, setLastOk] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const scanRef = useRef<HTMLInputElement | null>(null)
  const lastScanAt = useRef(0)

  const load = useCallback(async () => {
    if (!taskId.trim()) {
      setLoading(false)
      setError("Не указано задание")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const d = await getWmsTaskDetail(taskId)
      setData(d)
      setScans(readShipScans(d.task.taskPayload))
      if ((d.task.taskStatus || "").toLowerCase() === "completed") setDone(true)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : "Не удалось загрузить задачу")
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load])

  const t = data?.task
  const status = (t?.taskStatus || "").toLowerCase()
  const needsStart = status === "open" || status === "claimed" || status === "on_hold"
  const canWork = !done && (needsStart || status === "in_progress" || status === "exception")
  const plannedQty = Number(t?.plannedQty) || 0
  const scannedQty = scans.reduce((sum, row) => sum + row.qty, 0)
  const remainingQty = Math.max(0, plannedQty - scannedQty)
  const codesLeft = remainingQty
  const progress = plannedQty > 0 ? Math.min(100, Math.round((scannedQty / plannedQty) * 100)) : 0
  const readyToComplete = canWork && plannedQty > 0 && remainingQty <= 0

  async function onStart() {
    const uid = localStorage.getItem("tsd_device_id") || ""
    if (!uid) {
      setError("Терминал не настроен. Пройдите синхронизацию.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await startWmsTaskByDevice(taskId, uid)
      await load()
      window.setTimeout(() => scanRef.current?.focus(), 120)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать задание")
    } finally {
      setBusy(false)
    }
  }

  async function applyScan(raw: string) {
    const code = normalizeScan(raw)
    if (!code || !t || !canWork || done) return
    const now = Date.now()
    if (now - lastScanAt.current < 700) return
    lastScanAt.current = now
    setError(null)
    setLastOk(null)

    if (needsStart) {
      setError("Сначала нажмите «Выполнить задание»")
      return
    }
    if (remainingQty <= 0) {
      setError("Все коды уже отсканированы. Нажмите «Завершить отгрузку».")
      return
    }

    const uid = localStorage.getItem("tsd_device_id") || ""
    if (!uid) {
      setError("Терминал не настроен. Пройдите синхронизацию.")
      return
    }

    setScanBusy(true)
    try {
      let resolved: ResolveReceivingScanResponse
      try {
        resolved = await resolveReceivingMarkingCode(code)
      } catch (e) {
        throw new Error(
          e instanceof Error
            ? `Код не распознан как маркировка: ${e.message}`
            : "Отсканируйте код маркировки с номенклатурой и сроком годности"
        )
      }

      if (resolved.expiry.state === "expired") {
        throw new Error(
          resolved.expiry.message ||
            `Срок годности истёк${resolved.expiry.expiresAt ? ` (${formatDate(resolved.expiry.expiresAt)})` : ""} — код не принимается`
        )
      }
      if (!itemMatchesTask(resolved, t.itemCode)) {
        throw new Error(
          `Это ${resolved.primaryItem.name || resolved.primaryItem.itemCode}, а в задании ${t.itemName || t.itemCode}`
        )
      }

      const qty = scanQtyForCode(resolved, remainingQty)
      const saved = await scanWmsTaskByDevice(taskId, uid, {
        code: resolved.normalizedCode || code,
        qty,
        itemCode: resolved.primaryItem.itemCode,
        itemName: resolved.primaryItem.name,
        expiresAt: resolved.expiry.expiresAt,
        manufacturedAt: resolved.expiry.emissionAt,
      })
      setScans(saved.scans)
      setLastOk(
        `+${formatQty(qty)} · ${resolved.primaryItem.name} · годен до ${formatDate(resolved.expiry.expiresAt)}`
      )
      if (resolved.expiry.state === "warning") {
        setError(resolved.expiry.message)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось принять код")
    } finally {
      setScanBusy(false)
      window.setTimeout(() => scanRef.current?.focus(), 80)
    }
  }

  useEffect(() => {
    let remove: (() => Promise<void>) | null = null
    void addNativeBarcodeListener((code) => {
      void applyScan(code)
    }).then((handle) => {
      if (handle) remove = handle.remove
    })
    return () => {
      void remove?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.taskId, needsStart, remainingQty, canWork, done])

  useEffect(() => {
    if (!needsStart && canWork) {
      const id = window.setTimeout(() => scanRef.current?.focus(), 200)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [needsStart, canWork, remainingQty])

  async function onComplete() {
    const uid = localStorage.getItem("tsd_device_id") || ""
    if (!uid) {
      setError("Терминал не настроен. Пройдите синхронизацию.")
      return
    }
    if (remainingQty > 0) {
      setError(`Ещё нужно отсканировать ${formatQty(remainingQty)} кодов`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await completeWmsTaskByDevice(taskId, uid, {
        confirmedQty: scannedQty || plannedQty,
        sourceLocationCode: t?.sourceLocationCode || undefined,
        targetLocationCode: t?.targetLocationCode || undefined,
      })
      setDone(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить задание")
    } finally {
      setBusy(false)
    }
  }

  if (!taskId) {
    return <p className="p-4 text-destructive">Некорректный id задания</p>
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загрузка задания…
      </div>
    )
  }

  if (!t) {
    return (
      <div className="space-y-3 p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="outline" onClick={() => router.push("/mobile/tasks")}>
          К списку
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-28">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-xl"
          onClick={() => router.push("/mobile/tasks")}
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-foreground">{t.taskCode}</h1>
          <p className="text-xs text-muted-foreground">Отгрузка по кодам маркировки</p>
        </div>
        <Badge variant="secondary" className="rounded-lg">
          {status === "claimed" ? "назначено" : status === "in_progress" ? "в работе" : t.taskStatus}
        </Badge>
      </div>

      <section className="rounded-2xl bg-primary p-4 text-primary-foreground shadow-sm">
        <div className="text-xs uppercase tracking-wide opacity-80">Номенклатура</div>
        <div className="mt-1 text-lg font-bold leading-snug">{t.itemName || t.itemCode || "Без номенклатуры"}</div>
        {t.itemCode ? <p className="mt-1 text-sm opacity-90">{t.itemCode}</p> : null}
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs opacity-80">Маршрут</div>
            <div className="font-medium">
              {t.sourceWarehouseName || t.sourceWarehouseCode || t.sourceLocationCode || "откуда"} →{" "}
              {t.targetWarehouseName || t.targetWarehouseCode || t.targetLocationCode || "куда"}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-80">Документ</div>
            <div className="font-medium">{t.documentNo || "—"}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-card p-4 shadow-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Нужно отсканировать
        </div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <div className="text-4xl font-black tabular-nums leading-none">{formatQty(codesLeft)}</div>
            <div className="mt-1 text-sm text-muted-foreground">кодов осталось</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold tabular-nums">
              {formatQty(scannedQty)} из {formatQty(plannedQty)}
            </div>
            <div className="text-muted-foreground">уже отсканировано</div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Сканируйте DataMatrix: номенклатура и срок годности. Просроченные коды не принимаются.
        </p>
      </section>

      {needsStart && canWork ? (
        <Button className="h-14 rounded-xl text-base" disabled={busy} onClick={() => void onStart()}>
          {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Play className="mr-2 h-5 w-5" />}
          Выполнить задание
        </Button>
      ) : null}

      {canWork && !needsStart ? (
        <section className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ScanBarcode className="h-4 w-4" />
            Сканер
          </div>
          <p className="text-base font-medium text-foreground">
            {readyToComplete
              ? "Все коды собраны. Завершите отгрузку."
              : `Отсканируйте следующий код · осталось ${formatQty(remainingQty)}`}
          </p>
          {!readyToComplete ? (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                const value = scanInput
                setScanInput("")
                void applyScan(value)
              }}
            >
              <Input
                ref={scanRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="Наведите сканер на код"
                className="h-12 rounded-xl text-base"
                autoComplete="off"
                inputMode="text"
                disabled={scanBusy || busy}
              />
              <Button type="submit" variant="outline" className="w-full rounded-xl" disabled={scanBusy || busy}>
                {scanBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Принять код
              </Button>
            </form>
          ) : null}
          {lastOk ? <p className="mt-3 text-sm font-medium text-emerald-700">{lastOk}</p> : null}
        </section>
      ) : null}

      {scans.length > 0 ? (
        <section className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Package className="h-4 w-4" />
            Последние коды
          </div>
          <ul className="space-y-2 text-sm">
            {[...scans].reverse().slice(0, 8).map((row) => (
              <li key={`${row.code}-${row.at}`} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs">{row.code}</div>
                  <div className="text-muted-foreground">
                    {row.itemName || row.itemCode || "товар"}
                    {row.expiresAt ? ` · до ${formatDate(row.expiresAt)}` : ""}
                  </div>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{formatQty(row.qty)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {t.sourceLocationCode || t.targetLocationCode || t.sourceWarehouseCode ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          {t.sourceLocationCode || t.sourceWarehouseCode || "—"} → {t.targetLocationCode || t.targetWarehouseCode || "—"}
        </p>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {done ? (
        <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
          Отгрузка проведена. Можно брать следующее задание.
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {canWork && !needsStart ? (
          <Button className="h-12 rounded-xl" disabled={busy || remainingQty > 0} onClick={() => void onComplete()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Завершить отгрузку
          </Button>
        ) : null}
        <Button variant="outline" className="h-11 rounded-xl" asChild>
          <Link href="/mobile/tasks">К списку задач</Link>
        </Button>
      </div>
    </div>
  )
}
