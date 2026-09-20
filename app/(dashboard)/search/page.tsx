"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Calendar, MapPin, Package, PlusCircle, Search, ScanBarcode } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { listItems, lookupWms, type WmsItemListRow, type WmsLookupItem } from "@/lib/wms-api"
import { MarkingCodesHelpPanel } from "@/components/wms/marking-codes-help-panel"

function SearchPageContent() {
  const searchParams = useSearchParams()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<WmsLookupItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLookupQuery, setLastLookupQuery] = useState<string | null>(null)
  const [suggestRows, setSuggestRows] = useState<WmsItemListRow[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)

  const handleSearch = useCallback(async (queryOverride?: string) => {
    const q = (queryOverride ?? query).trim()
    if (!q) {
      setResults([])
      setLastLookupQuery(null)
      return
    }
    if (queryOverride != null) setQuery(q)
    setIsSearching(true)
    setError(null)
    try {
      const data = await lookupWms(q)
      setResults(data.items || [])
      setLastLookupQuery(q)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Поиск WMS недоступен")
      setResults([])
      setLastLookupQuery(q)
    } finally {
      setIsSearching(false)
    }
  }, [query])

  useEffect(() => {
    const q = searchParams.get("query")?.trim()
    if (q) setQuery(q)
  }, [searchParams])

  useEffect(() => {
    void handleSearch()
  }, [handleSearch])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setSuggestRows([])
      setSuggestOpen(false)
      return
    }
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await listItems({ query: q, limit: 12 })
          const rows = res.items ?? []
          setSuggestRows(rows)
          setSuggestOpen(rows.length > 0)
        } catch {
          setSuggestRows([])
          setSuggestOpen(false)
        }
      })()
    }, 240)
    return () => window.clearTimeout(id)
  }, [query])

  const trimmed = query.trim()
  const noHits =
    Boolean(lastLookupQuery && trimmed === lastLookupQuery && results.length === 0 && !isSearching)
  const lookupStale = Boolean(trimmed && lastLookupQuery !== trimmed)

  const createNomenclatureHref =
    `/nomenclature?new=1` +
    (trimmed ? `&prefillCode=${encodeURIComponent(trimmed)}` : "")

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Поиск</h1>
          <p className="text-sm text-muted-foreground">
            Живой поиск по товарам и ячейкам. Подсказки под строкой по мере ввода (код, имя, номенклатура). Для поиска
            по <strong className="font-medium text-foreground">коду маркировки Data Matrix / ЧЗ</strong> используйте{" "}
            <Link href="/warehouse-stock/finished-goods" className="text-primary underline-offset-2 hover:underline">
              Склад ГП
            </Link>
            . Если позиции нет в справочнике — создайте её в номенклатуре.
          </p>
        </div>
        <Button variant="outline" className="shrink-0 rounded-xl" asChild>
          <Link href="/nomenclature?new=1">
            <PlusCircle className="mr-2 h-4 w-4" />
            Новая номенклатура
          </Link>
        </Button>
      </div>

      <MarkingCodesHelpPanel variant="full" defaultOpen={false} className="mb-6" />

      <div className="mb-6 flex gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Введите код, название или штрихкод..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => suggestRows.length > 0 && setSuggestOpen(true)}
            onBlur={() => window.setTimeout(() => setSuggestOpen(false), 180)}
            onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            className="h-12 rounded-xl bg-card pl-12 text-base shadow-sm"
            autoComplete="off"
          />
          {suggestOpen && suggestRows.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-border bg-popover py-1 shadow-lg">
              <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Номенклатура (подсказки)
              </div>
              {suggestRows.map((row) => (
                <button
                  key={row.itemCode}
                  type="button"
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    void handleSearch(row.itemCode)
                    setSuggestOpen(false)
                  }}
                >
                  <span className="font-mono text-xs text-foreground">{row.itemCode}</span>
                  <span className="line-clamp-2 text-muted-foreground">{row.name}</span>
                  {(row.nomenclature || row.sku) && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {[row.sku && `SKU ${row.sku}`, row.nomenclature].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          onClick={() => void handleSearch(undefined)}
          className="h-12 rounded-xl bg-primary px-6 text-primary-foreground"
        >
          Найти
        </Button>
        <Button variant="outline" className="h-12 rounded-xl px-4" type="button" title="Сканер (скоро)">
          <ScanBarcode className="h-5 w-5" />
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {results.length > 0 ? (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">Найдено: {results.length}</div>
          {results.map((result, index) => (
            <div
              key={`${result.itemCode}-${result.locationCode}-${index}`}
              className="flex items-center justify-between rounded-2xl bg-card p-4 shadow-sm hover:shadow-md"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Package className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-lg font-mono text-xs">
                      {result.itemCode}
                    </Badge>
                    <Badge variant="secondary" className="rounded-lg">
                      {result.accuracyStatus}
                    </Badge>
                  </div>
                  <div className="mt-1 font-medium">{result.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {result.locationCode}
                    </span>
                    <span>Доступно: {result.availableQty}</span>
                    <span>Резерв: {result.reservedQty}</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      live WMS
                    </span>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" className="rounded-xl shrink-0" asChild>
                <Link href={`/nomenclature/${encodeURIComponent(result.itemCode)}`}>Карточка</Link>
              </Button>
            </div>
          ))}
        </div>
      ) : isSearching ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Поиск...</div>
      ) : noHits ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h3 className="mb-2 text-lg font-semibold">Ничего не найдено</h3>
          <p className="mb-6 text-sm text-muted-foreground">
            По запросу «<span className="font-mono text-foreground">{trimmed}</span>» нет совпадений в остатках и
            справочнике. Если нужен новый SKU — добавьте номенклатуру.
          </p>
          <Button className="rounded-xl" asChild>
            <Link href={createNomenclatureHref}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Создать позицию с этим кодом
            </Link>
          </Button>
        </div>
      ) : !trimmed ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-secondary">
            <Search className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">Начните поиск</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Введите код товара, название или отсканируйте штрихкод. Для новой позиции воспользуйтесь кнопкой выше или
            разделом «Номенклатура».
          </p>
        </div>
      ) : lookupStale ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Поиск...</div>
      ) : null}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm text-muted-foreground">Загрузка...</div>}>
      <SearchPageContent />
    </Suspense>
  )
}
