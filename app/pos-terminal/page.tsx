"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, CheckCircle2, Forklift, MapPin, ScanBarcode, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  getPosPickPlan,
  getWmsItemDetail,
  listItems,
  postPosIssue,
  type PosIssueResponse,
  type PosPickPlanResponse,
  type WmsItemListRow,
} from "@/lib/wms-api"
import { useToast } from "@/hooks/use-toast"

type PosCategory = "stickers" | "spares"

type ItemRow = WmsItemListRow & {
  packagingProfile?: string | null
}

const IMG_STICKERS = "/wms/pos-terminal/stickers.png"
const IMG_SPARES = "/wms/pos-terminal/spare-parts.png"

function formatQty(value: number | null | undefined) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(Number(value || 0))
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

function filterByCategory(items: ItemRow[], category: PosCategory): ItemRow[] {
  if (category === "stickers") {
    const stickers = items.filter((i) => i.packagingProfile === "stickers")
    return stickers.length > 0 ? stickers : items
  }
  const nonSticker = items.filter((i) => i.packagingProfile !== "stickers")
  return nonSticker.length > 0 ? nonSticker : items
}

export default function PosTerminalPage() {
  const { toast } = useToast()
  const [category, setCategory] = useState<PosCategory | null>(null)
  const [listQuery, setListQuery] = useState("")
  const [scanInput, setScanInput] = useState("")
  const [items, setItems] = useState<ItemRow[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [pickBusy, setPickBusy] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ItemRow | null>(null)
  const [issueQty, setIssueQty] = useState("1")
  const [pickPlan, setPickPlan] = useState<PosPickPlanResponse | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [issueBusy, setIssueBusy] = useState(false)
  const [recipientName, setRecipientName] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [lineName, setLineName] = useState("")
  const [issueResult, setIssueResult] = useState<PosIssueResponse | null>(null)

  const title = useMemo(() => {
    if (category === "stickers") return "Получить стикеры"
    if (category === "spares") return "Получить запчасти (ЗИП)"
    return ""
  }, [category])

  const loadList = useCallback(async () => {
    if (!category) return
    setListLoading(true)
    try {
      const q = listQuery.trim()
      const r = await listItems({
        query: q || undefined,
        limit: 80,
      })
      const raw = (r.items ?? []) as ItemRow[]
      setItems(filterByCategory(raw, category))
    } catch (e) {
      setItems([])
      toast({
        variant: "destructive",
        title: "Не удалось загрузить номенклатуру",
        description: e instanceof Error ? e.message : "Ошибка запроса",
      })
    } finally {
      setListLoading(false)
    }
  }, [category, listQuery, toast])

  useEffect(() => {
    if (!category) return
    const t = window.setTimeout(() => void loadList(), 320)
    return () => window.clearTimeout(t)
  }, [category, listQuery, loadList])

  useEffect(() => {
    setRecipientName(localStorage.getItem("wms.pos.recipientName") || "")
    setTargetLocationCode(localStorage.getItem("wms.pos.targetLocationCode") || "")
    setLineName(localStorage.getItem("wms.pos.lineName") || "")
  }, [])

  async function resolveScan(raw: string, cat: PosCategory): Promise<ItemRow | null> {
    const code = raw.trim()
    if (!code) return null
    try {
      const detail = await getWmsItemDetail(code)
      const it = detail.item as Record<string, unknown>
      const totals = detail.totals as { availableQty?: number; reservedQty?: number }
      const row: ItemRow = {
        itemCode: String(it.itemCode ?? code),
        sku: it.sku != null ? String(it.sku) : null,
        name: String(it.name ?? code),
        nomenclature: it.nomenclature != null ? String(it.nomenclature) : null,
        productGroup: it.productGroup != null ? String(it.productGroup) : null,
        uomCode: it.uomCode != null ? String(it.uomCode) : null,
        packagingProfile: it.packagingProfile != null ? String(it.packagingProfile) : null,
        availableQty: Number(totals?.availableQty ?? 0),
        reservedQty: Number(totals?.reservedQty ?? 0),
      }
      return row
    } catch {
      const r = await listItems({ query: code, limit: 40 })
      const rows = filterByCategory((r.items ?? []) as ItemRow[], cat)
      const exact =
        rows.find((x) => x.itemCode?.toLowerCase() === code.toLowerCase()) ??
        rows.find((x) => (x.sku || "").toLowerCase() === code.toLowerCase())
      return exact ?? rows[0] ?? null
    }
  }

  async function onScanSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!category) return
    const raw = scanInput.trim()
    if (!raw) return
    setPickBusy(true)
    try {
      const row = await resolveScan(raw, category)
      if (!row) {
        toast({
          variant: "destructive",
          title: "Не найдено",
          description: `По коду «${raw}» позиция не найдена. Проверьте скан или выберите из списка.`,
        })
        return
      }
      confirmPick(row)
    } finally {
      setPickBusy(false)
      setScanInput("")
    }
  }

  async function confirmPick(row: ItemRow, qtyRaw = issueQty) {
    const qty = Math.max(0, Number(String(qtyRaw).replace(",", ".")) || 0)
    setSelectedItem(row)
    setPickBusy(true)
    setPickError(null)
    setIssueResult(null)
    try {
      const plan = await getPosPickPlan({ itemCode: row.itemCode, qty })
      setPickPlan(plan)
      if (plan.plan.length === 0) {
        setPickError("По этой номенклатуре нет доступных ячеек для выдачи.")
      }
    } catch (e) {
      setPickPlan(null)
      setPickError(e instanceof Error ? e.message : "Не удалось построить маршрут отбора")
    } finally {
      setPickBusy(false)
    }
  }

  function resetSelection() {
    setSelectedItem(null)
    setPickPlan(null)
    setPickError(null)
    setIssueResult(null)
    setIssueQty("1")
  }

  async function conductIssue() {
    if (!selectedItem || !pickPlan) return
    const qty = Math.max(0, Number(issueQty.replace(",", ".")) || 0)
    const recipient = recipientName.trim()
    const target = targetLocationCode.trim()
    if (!recipient) {
      setPickError("Укажите получателя: кто пришёл за материалами.")
      return
    }
    if (!target) {
      setPickError("Укажите ячейку линии/цеха, куда выдаём материал.")
      return
    }
    if (!pickPlan.enough || qty <= 0) {
      setPickError("Нельзя провести выдачу: проверьте количество и доступный остаток.")
      return
    }
    setIssueBusy(true)
    setPickError(null)
    setIssueResult(null)
    try {
      localStorage.setItem("wms.pos.recipientName", recipient)
      localStorage.setItem("wms.pos.targetLocationCode", target)
      localStorage.setItem("wms.pos.lineName", lineName.trim())
      const result = await postPosIssue({
        itemCode: selectedItem.itemCode,
        qty,
        recipientName: recipient,
        targetLocationCode: target,
        lineName,
      })
      setIssueResult(result)
      const refreshed = await getPosPickPlan({ itemCode: selectedItem.itemCode, qty })
      setPickPlan(refreshed)
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "Не удалось провести выдачу")
    } finally {
      setIssueBusy(false)
    }
  }

  if (!category) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-border/60 bg-card/80 px-4 py-3 backdrop-blur">
          <span className="text-sm font-medium text-muted-foreground">Склад · выдача расходников</span>
          <Link
            href="/"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            На главную WMS
          </Link>
        </header>

        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-4 p-4 pb-10">
          <p className="text-center text-sm text-muted-foreground">
            Коснитесь раздела — затем выберите позицию в списке или отсканируйте штрихкод / код номенклатуры.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <Link
              href="/pos-terminal/car"
              className={cn(
                "flex min-h-[7rem] items-center gap-4 rounded-3xl border-2 border-primary/25 bg-card p-4 shadow-md transition",
                "hover:border-primary/50 hover:bg-primary/5 active:scale-[0.99]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              )}
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Forklift className="h-8 w-8" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-lg font-bold text-foreground">Пост карщика</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  FIFO · текущая партия · выбор ряда для палеты
                </p>
              </div>
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <button
              type="button"
              className={cn(
                "group relative aspect-[4/3] w-full overflow-hidden rounded-3xl border-2 border-border bg-muted/40 shadow-lg transition",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary",
                "active:scale-[0.99] motion-reduce:transition-none"
              )}
              onClick={() => setCategory("spares")}
              aria-label="Получить запчасти"
            >
              <Image
                src={IMG_SPARES}
                alt=""
                fill
                className="object-contain object-center"
                sizes="(max-width: 768px) 100vw, 50vw"
                priority
              />
              <span className="sr-only">Получить запчасти</span>
            </button>

            <button
              type="button"
              className={cn(
                "group relative aspect-[4/3] w-full overflow-hidden rounded-3xl border-2 border-border bg-muted/40 shadow-lg transition",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary",
                "active:scale-[0.99] motion-reduce:transition-none"
              )}
              onClick={() => setCategory("stickers")}
              aria-label="Получить стикеры"
            >
              <Image
                src={IMG_STICKERS}
                alt=""
                fill
                className="object-contain object-center"
                sizes="(max-width: 768px) 100vw, 50vw"
                priority
              />
              <span className="sr-only">Получить стикеры</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 bg-card/90 px-3 py-2 backdrop-blur md:px-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 rounded-xl text-muted-foreground"
          onClick={() => {
            setCategory(null)
            setListQuery("")
            setScanInput("")
            setItems([])
            resetSelection()
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          Назад
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl">{title}</h1>
        <Link
          href="/"
          className="hidden text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:inline"
        >
          WMS
        </Link>
      </header>

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-3 p-3 md:gap-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_minmax(28rem,34rem)]">
        <div className="flex min-w-0 flex-col gap-3 md:gap-4">
        <form
          className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm md:flex-row md:items-end md:gap-3"
          onSubmit={onScanSubmit}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Скан или ввод кода</label>
            <div className="flex gap-2">
              <ScanBarcode className="mt-2 hidden h-6 w-6 shrink-0 text-primary md:block" />
              <Input
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="Отсканируйте этикетку или введите SKU / код"
                className="h-12 rounded-xl text-base"
                autoComplete="off"
                disabled={pickBusy}
              />
            </div>
          </div>
          <Button type="submit" className="h-12 shrink-0 rounded-xl px-6 text-base" disabled={pickBusy}>
            Найти
          </Button>
        </form>

        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground">
            <Search className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Список номенклатуры</span>
          </div>
          <Input
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="Фильтр по названию или коду…"
            className="mb-3 h-11 rounded-xl"
          />
          <div className="max-h-[min(50vh,480px)] overflow-y-auto rounded-xl border border-border/60">
            {listLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Загрузка…</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Нет позиций. Измените фильтр или отсканируйте код.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {items.map((row) => (
                  <li key={row.itemCode}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-muted/50 active:bg-muted"
                      onClick={() => confirmPick(row)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-snug text-foreground">{row.name}</div>
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {row.itemCode}
                          {row.sku ? ` · ${row.sku}` : ""}
                        </div>
                        {row.productGroup ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">{row.productGroup}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <div className="tabular-nums text-foreground">{row.availableQty ?? 0}</div>
                        <div className="text-[10px] text-muted-foreground">доступно</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Стикеры: приоритет позициям с профилем упаковки «stickers». Запчасти: прочие профили; при отсутствии
            фильтра показывается полный список по запросу.
          </p>
        </div>
        </div>

        <aside className="min-w-0 rounded-3xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Маршрут выдачи
              </div>
              <h2 className="mt-1 text-xl font-semibold">FEFO-подбор ячеек</h2>
            </div>
            {pickPlan?.item ? (
              <span className="rounded-xl bg-lime-100 px-3 py-1 text-xs font-medium text-lime-900">
                {pickPlan.item.rotationPolicy.toUpperCase()}
              </span>
            ) : null}
          </div>

          {selectedItem ? (
            <div className="mt-4 rounded-2xl bg-muted/40 p-3">
              <div className="line-clamp-2 font-medium">{selectedItem.name}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{selectedItem.itemCode}</div>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <Input
                  value={issueQty}
                  onChange={(e) => setIssueQty(e.target.value)}
                  className="h-12 rounded-xl text-lg"
                  inputMode="decimal"
                  placeholder="Количество"
                  disabled={pickBusy}
                />
                <Button
                  type="button"
                  className="h-12 rounded-xl px-5"
                  disabled={pickBusy}
                  onClick={() => void confirmPick(selectedItem)}
                >
                  Рассчитать
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
              Введите или выберите номенклатуру. POS покажет только разрешённые ячейки:
              блок, производство, просрочка и нулевой остаток сюда не попадут.
            </div>
          )}

          <div className="mt-4 grid gap-2 rounded-2xl border border-border bg-background p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Параметры проведения
            </div>
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="h-11 rounded-xl"
              placeholder="Получатель: оператор / ФИО / RFID"
              disabled={issueBusy}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={targetLocationCode}
                onChange={(e) => setTargetLocationCode(e.target.value)}
                className="h-11 rounded-xl font-mono"
                placeholder="Ячейка линии: LINE-SIPA-01"
                disabled={issueBusy}
              />
              <Input
                value={lineName}
                onChange={(e) => setLineName(e.target.value)}
                className="h-11 rounded-xl"
                placeholder="Линия / цех"
                disabled={issueBusy}
              />
            </div>
            <Button
              type="button"
              className="h-12 rounded-xl text-base font-semibold"
              disabled={issueBusy || pickBusy || !selectedItem || !pickPlan?.enough}
              onClick={() => void conductIssue()}
            >
              {issueBusy ? "Провожу выдачу…" : "Провести выдачу"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Перед проводкой сервер заново проверит FEFO, блокировки, срок годности и остаток.
            </p>
          </div>

          {pickBusy ? (
            <div className="mt-4 rounded-2xl border border-border p-4 text-sm text-muted-foreground">
              Строю маршрут отбора…
            </div>
          ) : null}

          {pickError ? (
            <div className="mt-4 flex gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {pickError}
            </div>
          ) : null}

          {issueResult ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                Выдача проведена: {formatQty(issueResult.issuedQty)} шт.
              </div>
              <div className="mt-2 text-xs">
                Получатель: {issueResult.recipientName} · линия: {issueResult.lineName} · в ячейку{" "}
                <span className="font-mono">{issueResult.targetLocationCode}</span>
              </div>
              <div className="mt-3 space-y-1">
                {issueResult.documents.map((doc) => (
                  <div key={doc.documentId} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/70 px-3 py-2">
                    <span className="font-mono">Документ {doc.documentId}</span>
                    <span>из {doc.sourceLocationCode}</span>
                    <span>партия {doc.lotCode}</span>
                    <span className="ml-auto font-semibold">{formatQty(doc.qty)} шт.</span>
                    <Link
                      href={`/documents/${encodeURIComponent(doc.documentId)}`}
                      className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-medium hover:bg-emerald-100"
                    >
                      открыть
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {pickPlan ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-lime-100/80 p-3">
                  <div className="text-xs text-muted-foreground">Доступно</div>
                  <div className="mt-1 text-xl font-bold tabular-nums">
                    {formatQty(pickPlan.totalAvailable)}
                  </div>
                </div>
                <div className="rounded-2xl bg-secondary p-3">
                  <div className="text-xs text-muted-foreground">Запрос</div>
                  <div className="mt-1 text-xl font-bold tabular-nums">
                    {formatQty(pickPlan.requestedQty)}
                  </div>
                </div>
                <div
                  className={cn(
                    "rounded-2xl p-3",
                    pickPlan.enough ? "bg-emerald-100/80" : "bg-amber-100/80"
                  )}
                >
                  <div className="text-xs text-muted-foreground">Статус</div>
                  <div className="mt-1 text-sm font-bold">
                    {pickPlan.enough ? "Хватает" : "Не хватает"}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {pickPlan.plan.map((row) => (
                  <div
                    key={`${row.lotId}-${row.locationCode}`}
                    className={cn(
                      "rounded-2xl border p-3",
                      row.selected ? "border-lime-300 bg-lime-50/80" : "border-border bg-background"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
                            #{row.priority}
                          </span>
                          {row.selected ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-lime-200 px-2 py-0.5 text-xs font-semibold text-lime-950">
                              <CheckCircle2 className="h-3 w-3" />
                              брать
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-xl bg-card p-2">
                            <div className="text-xs text-muted-foreground">Стеллаж</div>
                            <div className="text-2xl font-bold">{row.rack}</div>
                          </div>
                          <div className="rounded-xl bg-card p-2">
                            <div className="text-xs text-muted-foreground">Полка</div>
                            <div className="text-2xl font-bold">{row.shelf}</div>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">взять</div>
                        <div className="text-2xl font-bold tabular-nums">{formatQty(row.takeQty)}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-start gap-2 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <div className="break-all font-mono font-semibold">{row.locationCode}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.address} · {row.warehouseCode || "—"} / {row.zoneCode || "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>партия: <span className="font-mono text-foreground">{row.lotCode}</span></span>
                      <span>остаток: <span className="font-semibold text-foreground">{formatQty(row.availableQty)}</span></span>
                      <span>эмиссия: {formatDate(row.emissionAtIso)}</span>
                      <span>срок: {formatDate(row.expiryAt || row.bestBeforeAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
