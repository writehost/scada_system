"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Loader2, RefreshCw, Search, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { WmsEmptyState, WmsErrorState, WmsTableSkeleton } from "@/components/wms/wms-shared"
import {
  listVekasAppliedBatches,
  listVekasUtilizationCodes,
  VEKAS_PLANT_SERVERS,
  type VekasBatchRow,
  type VekasPlantServer,
  type VekasUtilizationCodeRow,
} from "@/lib/wms-api"

const BATCH_PAGE = 200
const CODES_PAGE = 500

type CodeSortBy = "printedOn" | "validatedOn"
type SortDir = "asc" | "desc"

function fmtDt(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19)
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function localInputToIsoPrefix(v: string): string | undefined {
  const t = v.trim()
  if (!t) return undefined
  return t.length === 16 ? `${t}:00` : t
}

function productionDayLocalRange(iso: string | null | undefined): { from: string; to: string } | null {
  if (!iso?.trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  return {
    from: `${y}-${m}-${day}T00:00`,
    to: `${y}-${m}-${day}T23:59`,
  }
}

function codesFetchOpts(
  vekasServer: VekasPlantServer,
  sortBy: CodeSortBy,
  sortDir: SortDir,
  timeFrom: string,
  timeTo: string,
  skip: number,
  take: number,
  codeQuery: string,
) {
  return {
    skip,
    take,
    validatedOnly: false as const,
    sortBy,
    sortDir,
    timeField: sortBy,
    timeFrom: localInputToIsoPrefix(timeFrom),
    timeTo: localInputToIsoPrefix(timeTo),
    codeQuery: codeQuery.trim() || undefined,
    server: vekasServer,
  }
}

function shortCode(code: string): string {
  const plain = code.replace(/\u001d/g, " GS ")
  if (plain.length <= 48) return plain
  return `${plain.slice(0, 28)}…${plain.slice(-14)}`
}

export function FinishedGoodsVekasBatchesPage() {
  const [vekasServer, setVekasServer] = useState<VekasPlantServer>("skit")
  const [batches, setBatches] = useState<VekasBatchRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [gtin, setGtin] = useState("")
  const [productName, setProductName] = useState("")

  const [selected, setSelected] = useState<VekasBatchRow | null>(null)
  const [codes, setCodes] = useState<VekasUtilizationCodeRow[]>([])
  const [codesTotal, setCodesTotal] = useState(0)
  const [codesLoading, setCodesLoading] = useState(false)
  const [codesLoadingMore, setCodesLoadingMore] = useState(false)
  const [codesError, setCodesError] = useState<string | null>(null)
  const [codeFilter, setCodeFilter] = useState("")
  const [codeQuery, setCodeQuery] = useState("")
  const [sortBy, setSortBy] = useState<CodeSortBy>("printedOn")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [timeFrom, setTimeFrom] = useState("")
  const [timeTo, setTimeTo] = useState("")

  const loadBatches = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listVekasAppliedBatches({
        skip: 0,
        take: BATCH_PAGE,
        batchNumber: q.trim() || undefined,
        gtin: gtin.trim() || undefined,
        productName: productName.trim() || undefined,
        server: vekasServer,
      })
      setTotal(res.total)
      setBatches(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBatches([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [q, gtin, productName, vekasServer])

  const loadMoreBatches = useCallback(async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listVekasAppliedBatches({
        skip: batches.length,
        take: BATCH_PAGE,
        batchNumber: q.trim() || undefined,
        gtin: gtin.trim() || undefined,
        productName: productName.trim() || undefined,
        server: vekasServer,
      })
      setTotal(res.total)
      setBatches((prev) => {
        const seen = new Set(prev.map((b) => b.id))
        return [...prev, ...res.items.filter((b) => !seen.has(b.id))]
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, batches.length, q, gtin, productName, vekasServer])

  useEffect(() => {
    setSelected(null)
    void loadBatches()
  }, [vekasServer, loadBatches])

  const openBatch = useCallback((row: VekasBatchRow) => {
    setSelected(row)
    setCodes([])
    setCodesTotal(0)
    setCodesError(null)
    setCodeFilter("")
    setCodeQuery("")
    const day = productionDayLocalRange(row.productionDate)
    setTimeFrom(day?.from ?? "")
    setTimeTo(day?.to ?? "")
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setCodeQuery(codeFilter.trim()), 400)
    return () => clearTimeout(timer)
  }, [codeFilter])

  const reloadCodes = useCallback(async () => {
    if (!selected) return
    setCodesLoading(true)
    setCodesError(null)
    try {
      const res = await listVekasUtilizationCodes(
        selected.id,
        codesFetchOpts(vekasServer, sortBy, sortDir, timeFrom, timeTo, 0, CODES_PAGE, codeQuery),
      )
      setCodes(res.items)
      setCodesTotal(res.total)
    } catch (e) {
      setCodesError(e instanceof Error ? e.message : String(e))
    } finally {
      setCodesLoading(false)
    }
  }, [selected, vekasServer, sortBy, sortDir, timeFrom, timeTo, codeQuery])

  useEffect(() => {
    if (!selected) return
    void reloadCodes()
  }, [selected, reloadCodes])

  const loadMoreCodes = useCallback(async () => {
    if (!selected || codesLoadingMore) return
    setCodesLoadingMore(true)
    try {
      const res = await listVekasUtilizationCodes(
        selected.id,
        codesFetchOpts(vekasServer, sortBy, sortDir, timeFrom, timeTo, codes.length, CODES_PAGE, codeQuery),
      )
      setCodesTotal(res.total)
      setCodes((prev) => {
        const seen = new Set(prev.map((c) => c.code))
        return [...prev, ...res.items.filter((c) => !seen.has(c.code))]
      })
    } catch (e) {
      setCodesError(e instanceof Error ? e.message : String(e))
    } finally {
      setCodesLoadingMore(false)
    }
  }, [selected, codes.length, codesLoadingMore, vekasServer, sortBy, sortDir, timeFrom, timeTo, codeQuery])

  const toggleSort = (field: CodeSortBy) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(field)
      setSortDir("asc")
    }
  }

  const SortIcon = ({ field }: { field: CodeSortBy }) => {
    if (sortBy !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    )
  }

  const hasMoreBatches = batches.length < total
  const hasMoreCodes = codes.length < codesTotal
  const codesCountLabel = codesLoading
    ? "…"
    : codeQuery
      ? codes.length < codesTotal
        ? `${codes.length.toLocaleString("ru-RU")} / ${codesTotal.toLocaleString("ru-RU")} найдено`
        : `${codesTotal.toLocaleString("ru-RU")} найдено`
      : codes.length < codesTotal
        ? `${codes.length.toLocaleString("ru-RU")} / ${codesTotal.toLocaleString("ru-RU")} кодов`
        : `${codesTotal.toLocaleString("ru-RU")} кодов`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="rounded-lg" asChild>
          <Link href="/warehouse-stock/finished-goods" aria-label="Назад к складу ГП">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Склад ГП
          </Link>
        </Button>
        <h1 className="text-base font-semibold tracking-tight">Партии Vekas · нанесение</h1>
        <Badge variant="secondary" className="tabular-nums">
          {loading
            ? "…"
            : batches.length < total
              ? `${batches.length.toLocaleString("ru-RU")} из ${total.toLocaleString("ru-RU")}`
              : `${total.toLocaleString("ru-RU")} партий`}
        </Badge>
        <div className="ml-auto flex rounded-lg border border-border bg-card p-0.5 shadow-sm">
          {VEKAS_PLANT_SERVERS.map((s) => (
            <Button
              key={s.key}
              type="button"
              variant={vekasServer === s.key ? "default" : "ghost"}
              size="sm"
              className="h-8 rounded-md px-3 text-xs"
              onClick={() => setVekasServer(s.key)}
            >
              {s.label}
              <span className="ml-1 font-mono text-[10px] opacity-70">{s.host}</span>
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <WmsErrorState title="Не удалось загрузить партии" message={error} onRetry={() => void loadBatches()} />
      ) : null}

      <section className="wms-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-3 lg:flex-row lg:items-center">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Номер партии…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadBatches()
              }}
              className="h-9 rounded-lg bg-card pl-9 shadow-sm"
            />
          </div>
          <Input
            placeholder="GTIN…"
            value={gtin}
            onChange={(e) => setGtin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadBatches()
            }}
            className="h-9 w-full rounded-lg bg-card shadow-sm lg:w-40"
          />
          <Input
            placeholder="Номенклатура / продукт…"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadBatches()
            }}
            className="h-9 w-full rounded-lg bg-card shadow-sm lg:min-w-[12rem] lg:flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => void loadBatches()}
            disabled={loading}
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Обновить
          </Button>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-h-[20rem] border-b border-border lg:border-b-0 lg:border-r">
            {loading ? (
              <div className="p-4">
                <WmsTableSkeleton rows={8} />
              </div>
            ) : batches.length === 0 ? (
              <WmsEmptyState
                className="m-4"
                title="Нет партий"
                description="Нет партий со статусом нанесения (InStorage / Completed…)."
              />
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 font-medium">Партия</th>
                      <th className="px-3 py-2 font-medium">Статус</th>
                      <th className="min-w-[18rem] px-3 py-2 font-medium">GTIN / продукт</th>
                      <th className="px-3 py-2 font-medium">Производство</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => {
                      const active = selected?.id === b.id
                      return (
                        <tr
                          key={b.id}
                          className={cn(
                            "cursor-pointer border-b border-border/70 hover:bg-muted/40",
                            active && "bg-muted/60"
                          )}
                          onClick={() => openBatch(b)}
                        >
                          <td className="px-3 py-2 font-medium tabular-nums">{b.batchNumber || "—"}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="font-normal">
                              {b.status || "—"}
                            </Badge>
                          </td>
                          <td className="min-w-[18rem] max-w-[32rem] px-3 py-2 align-top">
                            <div className="font-mono text-xs tabular-nums">{b.gtin || "—"}</div>
                            <div className="whitespace-normal break-words text-xs leading-snug text-muted-foreground">
                              {b.productName || "—"}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDt(b.productionDate)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {hasMoreBatches ? (
                  <div className="flex items-center justify-center gap-2 border-t border-border p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={loadingMore}
                      onClick={() => void loadMoreBatches()}
                    >
                      {loadingMore ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      Ещё партии ({batches.length} / {total})
                    </Button>
                  </div>
                ) : (
                  <div className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">
                    Все {total.toLocaleString("ru-RU")} партий
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="min-h-[20rem]">
            {!selected ? (
              <WmsEmptyState
                className="m-4"
                title="Выберите партию"
                description="Слева отфильтруй по GTIN или номенклатуре, выбери партию — справа коды по времени нанесения."
              />
            ) : (
              <div className="flex h-full flex-col">
                <div className="space-y-2 border-b border-border px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium tabular-nums">{selected.batchNumber}</span>
                    <Badge variant="secondary" className="tabular-nums">
                      {codesCountLabel}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selected.productName || "—"} · GTIN {selected.gtin || "—"}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="relative min-w-[10rem] flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Поиск по всей партии (код / серийник)…"
                        value={codeFilter}
                        onChange={(e) => setCodeFilter(e.target.value)}
                        className="h-8 rounded-lg bg-card pl-8 text-xs shadow-sm"
                      />
                    </div>
                    <label className="text-[10px] text-muted-foreground">
                      с
                      <Input
                        key={`${selected.id}-from`}
                        type="datetime-local"
                        step={60}
                        value={timeFrom}
                        onChange={(e) => setTimeFrom(e.target.value)}
                        className="mt-0.5 h-8 w-[11.5rem] rounded-lg bg-card text-xs shadow-sm"
                      />
                    </label>
                    <label className="text-[10px] text-muted-foreground">
                      по
                      <Input
                        key={`${selected.id}-to`}
                        type="datetime-local"
                        step={60}
                        value={timeTo}
                        onChange={(e) => setTimeTo(e.target.value)}
                        className="mt-0.5 h-8 w-[11.5rem] rounded-lg bg-card text-xs shadow-sm"
                      />
                    </label>
                    {(timeFrom || timeTo) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg text-xs"
                        onClick={() => {
                          setTimeFrom("")
                          setTimeTo("")
                        }}
                      >
                        Сброс времени
                      </Button>
                    )}
                  </div>
                </div>

                {codesError ? (
                  <WmsErrorState
                    className="m-4"
                    title="Не удалось загрузить коды"
                    message={codesError}
                    onRetry={() => void reloadCodes()}
                  />
                ) : null}

                {codesLoading ? (
                  <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Загрузка кодов нанесения…
                  </div>
                ) : codes.length === 0 && !codesError ? (
                  <WmsEmptyState
                    className="m-4"
                    title={codeQuery ? "Ничего не найдено" : "Нет кодов"}
                    description={
                      codeQuery
                        ? "По запросу нет кодов в партии / выбранном диапазоне времени."
                        : "Нет кодов в выбранном диапазоне / фильтре."
                    }
                  />
                ) : (
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 font-medium">Код</th>
                          <th className="px-3 py-2 font-medium">Статус</th>
                          <th className="px-3 py-2 font-medium">
                            <button
                              type="button"
                              className="inline-flex items-center hover:text-foreground"
                              onClick={() => toggleSort("printedOn")}
                            >
                              Печать
                              <SortIcon field="printedOn" />
                            </button>
                          </th>
                          <th className="px-3 py-2 font-medium">
                            <button
                              type="button"
                              className="inline-flex items-center hover:text-foreground"
                              onClick={() => toggleSort("validatedOn")}
                            >
                              Валидация
                              <SortIcon field="validatedOn" />
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {codes.map((c) => (
                          <tr key={c.code} className="border-b border-border/60">
                            <td className="px-3 py-1.5 font-mono tabular-nums" title={c.code}>
                              {shortCode(c.code)}
                            </td>
                            <td className="px-3 py-1.5">{c.status || "—"}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{fmtDt(c.printedOn)}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{fmtDt(c.validatedOn)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {hasMoreCodes ? (
                      <div className="flex justify-center border-t border-border p-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-lg"
                          disabled={codesLoadingMore}
                          onClick={() => void loadMoreCodes()}
                        >
                          {codesLoadingMore ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Ещё коды ({codes.length} / {codesTotal})
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
