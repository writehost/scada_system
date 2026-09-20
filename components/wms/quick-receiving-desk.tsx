"use client"

import { useEffect, useMemo, useState } from "react"
import { Ban, Loader2, Plus, Printer, RotateCcw, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  actQuickReceiving,
  createQuickReceiving,
  createQuickReceivingItem,
  getWmsClientErrorDetails,
  getWmsClientErrorMeta,
  listItems,
  listQuickReceivings,
  type QuickLpnRow,
  type QuickReceivingRow,
  type WmsItemListRow,
} from "@/lib/wms-api"
import { openLpnLabels } from "@/lib/quick-receiving-label"
import { cn } from "@/lib/utils"

function fmtQty(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n)
}

function statusLabel(status: string) {
  if (status === "WAITING_PRINT" || status === "CREATED") return "Ожидает печати"
  if (status === "PRINTING") return "Печатается"
  if (status === "PRINTED" || status === "WAITING_VERIFICATION") return "Ожидает скана"
  if (status === "VERIFIED" || status === "READY_FOR_PUTAWAY") return "Подтверждён"
  if (status === "STORED") return "Размещён"
  if (status === "CANCELLED") return "Аннулирован"
  if (status === "PRINT_ERROR") return "Ошибка печати"
  if (status === "VERIFICATION_ERROR") return "Ошибка скана"
  return status
}

function statusClass(status: string) {
  if (status === "VERIFIED" || status === "READY_FOR_PUTAWAY" || status === "STORED") return "text-emerald-800"
  if (status === "WAITING_VERIFICATION" || status === "PRINTED") return "text-amber-800"
  if (status === "PRINTING") return "text-sky-800"
  if (status === "PRINT_ERROR" || status === "VERIFICATION_ERROR") return "text-red-800"
  if (status === "CANCELLED") return "text-muted-foreground"
  return "text-foreground"
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ""
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

type QueueFilter = "all" | "print" | "scan" | "verified" | "error"

function matchesFilter(lpn: QuickLpnRow, filter: QueueFilter) {
  if (filter === "all") return true
  if (filter === "print") return ["CREATED", "WAITING_PRINT", "PRINTING", "PRINT_ERROR"].includes(lpn.status)
  if (filter === "scan") return ["PRINTED", "WAITING_VERIFICATION", "VERIFICATION_ERROR"].includes(lpn.status)
  if (filter === "verified") return ["VERIFIED", "READY_FOR_PUTAWAY", "STORED"].includes(lpn.status)
  return lpn.status === "PRINT_ERROR" || lpn.status === "VERIFICATION_ERROR"
}

function pendingFromError(e: unknown): string[] {
  const details = getWmsClientErrorDetails(e)
  if (details && typeof details === "object" && Array.isArray((details as { pending?: unknown }).pending)) {
    return (details as { pending: unknown[] }).pending.map((x) => String(x))
  }
  return []
}

export function QuickReceivingDesk() {
  const [rows, setRows] = useState<QuickReceivingRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [itemQuery, setItemQuery] = useState("")
  const [hits, setHits] = useState<WmsItemListRow[]>([])
  const [item, setItem] = useState<WmsItemListRow | null>(null)
  const [lot, setLot] = useState("")
  const [prod, setProd] = useState("")
  const [exp, setExp] = useState("")
  const [pallets, setPallets] = useState("10")
  const [perPallet, setPerPallet] = useState("48000")
  const [supplier, setSupplier] = useState("")
  const [docNo, setDocNo] = useState("")
  const [mode, setMode] = useState<"sequential" | "batch">("sequential")
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newSku, setNewSku] = useState("")
  const [newCat, setNewCat] = useState("Преформа")
  const [newUom, setNewUom] = useState("pcs")
  const [newMfr, setNewMfr] = useState("")
  const [newBarcode, setNewBarcode] = useState("")
  const [newShelfMonths, setNewShelfMonths] = useState("24")
  const [reprintLpn, setReprintLpn] = useState<string | null>(null)
  const [reprintReason, setReprintReason] = useState("повреждена этикетка")
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all")
  const [completePending, setCompletePending] = useState<string[] | null>(null)

  const active = rows.find((r) => r.receivingId === activeId) ?? rows[0] ?? null

  async function reload() {
    setLoading(true)
    try {
      const data = await listQuickReceivings()
      setRows(data.rows ?? [])
      setActiveId((prev) => prev ?? data.rows?.[0]?.receivingId ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить быстрые приёмки")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    const id = window.setInterval(() => {
      void listQuickReceivings()
        .then((data) => {
          setRows(data.rows ?? [])
        })
        .catch(() => undefined)
    }, 4000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const q = itemQuery.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const t = window.setTimeout(() => {
      void listItems({ query: q, limit: 12, isActive: true })
        .then((res) => setHits(res.items ?? []))
        .catch(() => setHits([]))
    }, 220)
    return () => window.clearTimeout(t)
  }, [itemQuery])

  useEffect(() => {
    if (!item || !prod) return
    const days = Number(item.shelfLifeDays || 0)
    if (days > 0) setExp(addDays(prod, days))
  }, [item, prod])

  const total = useMemo(() => {
    const a = Number(pallets)
    const b = Number(perPallet)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
    return a * b
  }, [pallets, perPallet])

  const visibleLpns = useMemo(
    () => (active ? active.lpns.filter((lpn) => matchesFilter(lpn, queueFilter)) : []),
    [active, queueFilter]
  )

  async function create() {
    if (!item) {
      setError("Выберите номенклатуру")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await createQuickReceiving({
        itemCode: item.itemCode,
        lotCode: lot,
        productionDate: prod || undefined,
        expiryDate: exp || undefined,
        palletCount: Number(pallets),
        qtyPerLpn: Number(perPallet),
        supplier,
        documentNumber: docNo,
        mode,
      })
      setRows((prev) => [res.receiving, ...prev.filter((r) => r.receivingId !== res.receiving.receivingId)])
      setActiveId(res.receiving.receivingId)
      setQueueFilter("print")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать приёмку")
    } finally {
      setBusy(false)
    }
  }

  async function act(
    action: "print" | "reprint" | "print_all" | "cancel" | "complete",
    extra?: { lpnCode?: string; reason?: string; cancelRemaining?: boolean }
  ) {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      if (action === "print" && extra?.lpnCode) {
        const lpn = active.lpns.find((row) => row.lpnCode === extra.lpnCode)
        if (lpn) openLpnLabels([lpn])
      }
      if (action === "reprint" && extra?.lpnCode) {
        const lpn = active.lpns.find((row) => row.lpnCode === extra.lpnCode)
        if (lpn) openLpnLabels([lpn])
      }
      if (action === "print_all") {
        const waiting = active.lpns.filter((l) =>
          ["CREATED", "WAITING_PRINT", "PRINT_ERROR"].includes(l.status)
        )
        openLpnLabels(waiting)
      }
      const res = await actQuickReceiving(active.receivingId, action, extra)
      setRows((prev) => prev.map((r) => (r.receivingId === res.receiving.receivingId ? res.receiving : r)))
      setReprintLpn(null)
      setCompletePending(null)
    } catch (e) {
      if (action === "complete" && getWmsClientErrorMeta(e).code === "pending_lpns") {
        setCompletePending(pendingFromError(e))
      } else {
        setError(e instanceof Error ? e.message : "Операция не выполнена")
      }
    } finally {
      setBusy(false)
    }
  }

  async function createItem() {
    setBusy(true)
    setError(null)
    try {
      const months = Number(newShelfMonths)
      const res = await createQuickReceivingItem({
        name: newName,
        sku: newSku || undefined,
        category: newCat,
        uom: newUom || undefined,
        manufacturer: newMfr || undefined,
        barcode: newBarcode || undefined,
        shelfLifeDays: Number.isFinite(months) && months > 0 ? Math.round(months * 30.4375) : undefined,
        temp: true,
      })
      setItem({
        itemCode: res.item.itemCode,
        name: res.item.itemName,
        sku: res.item.itemCode,
        availableQty: 0,
        shelfLifeDays: res.item.shelfLifeDays,
      })
      setItemQuery(res.item.itemName)
      setCreateOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать номенклатуру")
    } finally {
      setBusy(false)
    }
  }

  function repeatLast() {
    const last = rows[0]
    if (!last) return
    setItem({
      itemCode: last.itemCode,
      name: last.itemName,
      sku: last.itemCode,
      availableQty: 0,
    })
    setItemQuery(last.itemName)
    setPerPallet(String(last.qtyPerLpn))
    setPallets(String(last.palletCount))
    setSupplier(last.supplier)
    setLot("")
    setProd("")
    setExp("")
  }

  async function fillDemo() {
    setLot("A250911")
    setProd("2026-09-11")
    setExp("2028-09-11")
    setPallets("10")
    setPerPallet("48000")
    try {
      const res = await listItems({ query: "PCO1881", limit: 8, isActive: true })
      const hit = (res.items ?? []).find((row) => /PCO1881|преформа/i.test(`${row.name} ${row.itemCode}`))
      if (hit) {
        setItem(hit)
        setItemQuery(hit.name)
        return
      }
    } catch {
      /* keep manual create */
    }
    setNewName("Преформа PCO1881 24г")
    setNewSku("PCO1881")
    setNewCat("materials")
    setNewShelfMonths("24")
    setCreateOpen(true)
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[16px] font-semibold">Быстрая приёмка</h2>
            <p className="text-[12px] text-muted-foreground">
              Палеты → печать внутреннего LPN → наклейка → обязательный повторный скан.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => void fillDemo()}>
              Демо PCO1881
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={repeatLast} disabled={!rows[0]}>
              Повторить прошлую
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-600/20 bg-red-50/80 px-3 py-2 text-[13px] text-red-900">{error}</div>
        ) : null}

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label className="text-[12px] text-muted-foreground">Номенклатура</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  className="h-9 rounded-lg"
                  value={itemQuery}
                  onChange={(e) => {
                    setItemQuery(e.target.value)
                    setItem(null)
                  }}
                  placeholder="Название, артикул, GTIN, внутренний код"
                />
                <Button variant="outline" className="h-9 shrink-0 rounded-lg" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Быстро создать
                </Button>
              </div>
              {item ? (
                <div className="mt-1 text-[13px] font-medium leading-snug">{item.name}</div>
              ) : hits.length > 0 ? (
                <div className="mt-1 max-h-40 overflow-auto rounded-md border border-border">
                  {hits.map((hit) => (
                    <button
                      key={hit.itemCode}
                      type="button"
                      className="block w-full px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                      onClick={() => {
                        setItem(hit)
                        setItemQuery(hit.name)
                        setHits([])
                      }}
                    >
                      <span className="whitespace-normal">{hit.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">{hit.itemCode}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <Field label="Клиент / поставщик" value={supplier} onChange={setSupplier} />
            <Field label="Документ" value={docNo} onChange={setDocNo} />
            <Field label="Партия / LOT" value={lot} onChange={setLot} />
            <Field label="Дата производства" value={prod} onChange={setProd} type="date" />
            <Field label="Годен до" value={exp} onChange={setExp} type="date" />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Палет" value={pallets} onChange={setPallets} />
              <Field label="Шт / палета" value={perPallet} onChange={setPerPallet} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={mode === "batch"}
                onChange={(e) => setMode(e.target.checked ? "batch" : "sequential")}
              />
              Пакетная печать — скан в любом порядке
            </label>
            <div className="text-[13px] font-semibold">
              {pallets || 0} палет · {fmtQty(total)} шт
            </div>
            <Button className="h-9 rounded-lg" disabled={busy || !item || !lot.trim()} onClick={() => void create()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Создать и отправить в печать
            </Button>
          </div>
        </div>

        {active ? (
          <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">{active.number}</div>
                <div className="whitespace-normal text-[12px] text-muted-foreground">
                  {active.itemName} · LOT {active.lotCode}
                  {active.mode === "batch" ? " · пакет" : " · по одному"}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {active.progress.waitingPrint > 0 ? (
                  <Button
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={busy || active.status !== "open"}
                    onClick={() => void act("print_all")}
                  >
                    <Printer className="mr-1 h-3.5 w-3.5" />
                    Печать всех ({active.progress.waitingPrint})
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  disabled={busy || active.status !== "open"}
                  onClick={() => void act("complete")}
                >
                  Завершить приёмку
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 border-b border-border px-3 py-2 text-[11px] sm:grid-cols-5">
              <Stat label="Всего" value={active.progress.total} />
              <Stat label="Напечатано" value={active.progress.printed} />
              <Stat label="Подтверждено" value={active.progress.verified} tone="ok" />
              <Stat label="Ждёт печати" value={active.progress.waitingPrint} />
              <Stat label="Ждёт скана" value={active.progress.waitingScan} tone="wait" />
            </div>
            <div className="h-1.5 bg-muted">
              <div
                className="h-full bg-emerald-600"
                style={{
                  width: `${active.progress.total ? (active.progress.verified / active.progress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5">
              {(
                [
                  ["all", "Все"],
                  ["print", "К печати"],
                  ["scan", "К скану"],
                  ["verified", "Готово"],
                  ["error", "Ошибки"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setQueueFilter(key)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px]",
                    queueFilter === key ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="divide-y divide-border">
              {visibleLpns.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-muted-foreground">Нет строк в этом фильтре</div>
              ) : (
                visibleLpns.map((lpn) => (
                  <div key={lpn.lpnId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="min-w-[148px] font-mono text-[13px] font-semibold">{lpn.lpnCode}</div>
                    <div className={cn("min-w-[140px] text-[12px] font-medium", statusClass(lpn.status))}>
                      {statusLabel(lpn.status)}
                    </div>
                    <div className="text-[12px] text-muted-foreground">{fmtQty(lpn.qty)} шт</div>
                    {lpn.reprintCount > 0 ? (
                      <div className="text-[11px] text-muted-foreground">перепечаток {lpn.reprintCount}</div>
                    ) : null}
                    {lpn.lastError ? <div className="text-[11px] text-red-800">{lpn.lastError}</div> : null}
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      {lpn.status === "WAITING_PRINT" || lpn.status === "PRINT_ERROR" || lpn.status === "CREATED" ? (
                        <Button size="sm" className="h-8 rounded-lg" disabled={busy} onClick={() => void act("print", { lpnCode: lpn.lpnCode })}>
                          <Printer className="mr-1 h-3.5 w-3.5" />
                          Печать
                        </Button>
                      ) : null}
                      {lpn.status === "WAITING_VERIFICATION" || lpn.status === "PRINTED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg"
                          disabled={busy}
                          onClick={() => setReprintLpn(lpn.lpnCode)}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          Перепечатать
                        </Button>
                      ) : null}
                      {lpn.status !== "VERIFIED" &&
                      lpn.status !== "CANCELLED" &&
                      lpn.status !== "READY_FOR_PUTAWAY" &&
                      lpn.status !== "STORED" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 rounded-lg"
                          disabled={busy}
                          onClick={() => void act("cancel", { lpnCode: lpn.lpnCode, reason: "ошибочная печать" })}
                        >
                          <Ban className="mr-1 h-3.5 w-3.5" />
                          Аннулировать
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаю…
          </div>
        ) : null}
      </div>

      <aside className="space-y-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Приёмки</div>
          <div className="mt-2 space-y-1">
            {rows.length === 0 ? (
              <div className="text-[12px] text-muted-foreground">Пока нет быстрых приёмок</div>
            ) : (
              rows.map((row) => (
                <button
                  key={row.receivingId}
                  type="button"
                  onClick={() => setActiveId(row.receivingId)}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left text-[13px]",
                    row.receivingId === active?.receivingId ? "bg-muted" : "hover:bg-muted/60"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{row.number}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {row.progress.verified}/{row.progress.total}
                    </span>
                  </div>
                  <div className="whitespace-normal text-[12px] leading-snug text-muted-foreground">{row.itemName}</div>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="rounded-lg border border-dashed border-border p-3 text-[12px] leading-5 text-muted-foreground">
          <ScanLine className="mb-1 h-4 w-4" />
          ТСД: <span className="font-medium text-foreground">/mobile/receiving/mark</span>
          <br />
          Печать → наклейка → скан того же LPN. Печать ≠ наклейка.
        </div>
      </aside>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-[10px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Быстро создать номенклатуру</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Field label="Название" value={newName} onChange={setNewName} />
            <Field label="Категория" value={newCat} onChange={setNewCat} />
            <Field label="Единица" value={newUom} onChange={setNewUom} />
            <Field label="Производитель" value={newMfr} onChange={setNewMfr} />
            <Field label="Артикул" value={newSku} onChange={setNewSku} />
            <Field label="Штрихкод поставщика" value={newBarcode} onChange={setNewBarcode} />
            <Field label="Срок хранения, мес" value={newShelfMonths} onChange={setNewShelfMonths} />
            <p className="text-[12px] text-amber-800">Будет помечена «Требует классификации» — разгрузку не останавливаем.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={() => void createItem()} disabled={busy || !newName.trim()}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reprintLpn)} onOpenChange={(open) => !open && setReprintLpn(null)}>
        <DialogContent className="rounded-[10px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Перепечатать {reprintLpn}</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground">Тот же LPN. Новый идентификатор не создаётся.</p>
          <div className="space-y-2">
            {["повреждена этикетка", "не пропечатался код", "потеряна", "другая причина"].map((reason) => (
              <label key={reason} className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  checked={reprintReason === reason}
                  onChange={() => setReprintReason(reason)}
                />
                {reason}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReprintLpn(null)}>Отмена</Button>
            <Button
              disabled={!reprintLpn}
              onClick={() => reprintLpn && void act("reprint", { lpnCode: reprintLpn, reason: reprintReason })}
            >
              Печать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={completePending !== null} onOpenChange={(open) => !open && setCompletePending(null)}>
        <DialogContent className="rounded-[10px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Нельзя завершить приёмку</DialogTitle>
          </DialogHeader>
          <p className="text-[13px]">Не подтверждены:</p>
          <div className="font-mono text-[13px]">{(completePending ?? []).join(", ") || "—"}</div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setCompletePending(null)}>
              Продолжить маркировку
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void act("complete", { cancelRemaining: true })}
            >
              Аннулировать оставшиеся
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "wait" }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-[15px] font-semibold tabular-nums",
          tone === "ok" && "text-emerald-800",
          tone === "wait" && "text-amber-800"
        )}
      >
        {value}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div>
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <Input className="mt-1 h-9 rounded-lg" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
