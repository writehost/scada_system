"use client"

import { useEffect, useMemo, useState, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ArrowLeft,
  Package,
  MapPin,
  Boxes,
  ChevronRight,
  ScanLine,
  AlertTriangle,
  Tag,
} from "lucide-react"
import {
  lookupWms,
  resolveInternalMarkingCode,
  resolveReceivingMarkingCode,
  type InternalMarkingResolveResult,
  type ResolveReceivingScanResponse,
  type WmsLookupItem,
} from "@/lib/wms-api"
import {
  parseSkitMarking,
  skitMarkingHumanLines,
  skitMarkingKindLabelRu,
} from "@/lib/wms-skit-marking"

function ScanResultContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const code = searchParams.get("code") || ""
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<WmsLookupItem[]>([])
  const [receivingResolve, setReceivingResolve] = useState<ResolveReceivingScanResponse | null>(null)
  const [internalResolve, setInternalResolve] = useState<InternalMarkingResolveResult | null>(null)

  const marking = useMemo(() => parseSkitMarking(code), [code])
  const humanLines = useMemo(() => skitMarkingHumanLines(marking), [marking])
  const searchQuery = marking.lookupQuery ?? ""

  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [data, receiving, internal] = await Promise.all([
          searchQuery.trim() ? lookupWms(searchQuery) : Promise.resolve({ items: [] as WmsLookupItem[] }),
          code.trim() ? resolveReceivingMarkingCode(code).catch(() => null) : Promise.resolve(null),
          code.trim() ? resolveInternalMarkingCode(code).catch(() => null) : Promise.resolve(null),
        ])
        if (!ignore) setItems(data.items || [])
        if (!ignore) setReceivingResolve(receiving)
        if (!ignore) setInternalResolve(internal)
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : "Не удалось выполнить поиск")
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [code, searchQuery])

  const summary = useMemo(() => {
    const totalAvailable = items.reduce((s, it) => s + (it.availableQty || 0), 0)
    const totalReserved = items.reduce((s, it) => s + (it.reservedQty || 0), 0)
    return { count: items.length, totalAvailable, totalReserved }
  }, [items])

  const hasSearch = searchQuery.trim().length > 0

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="sticky top-0 z-40 bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-xl"
            onClick={() => router.push("/mobile")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-foreground">Результат сканирования</h1>
            <p className="truncate text-xs font-mono text-muted-foreground">
              {code.length > 0 ? code : "—"}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl"
            onClick={() => router.push("/mobile/scan")}
          >
            <ScanLine className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error && (
          <Card className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div className="text-sm">{error}</div>
            </div>
          </Card>
        )}

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
              <Tag className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-foreground">Метка</h2>
                <Badge variant="secondary" className="rounded-lg">
                  {skitMarkingKindLabelRu(marking.kind)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Строку можно прочитать без сканера: поля разделены символом «$», внутри поля «ключ=значение».
              </p>
              <ul className="mt-3 space-y-1 font-mono text-xs text-foreground">
                {humanLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {marking.locationCode ? (
                <Button
                  className="mt-4 w-full rounded-xl bg-primary text-primary-foreground"
                  asChild
                >
                  <Link href={`/mobile/location/${encodeURIComponent(marking.locationCode)}`}>
                    <MapPin className="mr-2 h-4 w-4" />
                    Открыть ячейку {marking.locationCode}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        {receivingResolve || internalResolve?.found ? (
          <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold">Распознавание WMS</h3>
              <Badge variant="secondary" className="rounded-lg">
                {internalResolve?.found ? "внутренний DataMatrix" : "ЧЗ/GS1"}
              </Badge>
            </div>
            {receivingResolve ? (
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">{receivingResolve.primaryItem.name}</div>
                <div>Группа: {receivingResolve.primaryItem.productGroupLabel || receivingResolve.primaryItem.productGroup || "—"}</div>
                <div>GTIN/артикул: {receivingResolve.primaryItem.gtin || receivingResolve.primaryItem.itemCode}</div>
                <div>Эмиссия: {receivingResolve.expiry.emissionAt ? new Date(receivingResolve.expiry.emissionAt).toLocaleString("ru-RU") : "—"}</div>
                <div>{receivingResolve.expiry.message}</div>
              </div>
            ) : null}
            {internalResolve?.found ? (
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">{internalResolve.itemName || internalResolve.itemCode}</div>
                <div>GTIN: {internalResolve.gtin || "—"}</div>
                <div>Серия: {internalResolve.serial || "—"}</div>
                <div>Статус: {internalResolve.statusName || internalResolve.statusId || "—"}</div>
                <div>Ячейка: {internalResolve.locationCode || "—"}</div>
              </div>
            ) : null}
          </Card>
        ) : null}

        {hasSearch ? (
          <>
            <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                    <Boxes className="h-7 w-7 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      Остатки по запросу
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Позиций: {summary.count}. Доступно: {summary.totalAvailable}, в резерве:{" "}
                      {summary.totalReserved}
                    </p>
                    {searchQuery && searchQuery !== code ? (
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        Запрос: {searchQuery}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Package className="h-4 w-4 text-primary" />
                  Строки остатков
                </h3>
                <span className="text-sm text-muted-foreground">{items.length}</span>
              </div>

              {loading ? (
                <div className="text-sm text-muted-foreground">Поиск…</div>
              ) : items.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  По этому запросу ничего не найдено. Для ячейки откройте карточку ячейки выше.
                </div>
              ) : (
                <div className="space-y-2">
                  {items.slice(0, 20).map((it) => (
                    <div
                      key={`${it.itemCode}-${it.locationCode}`}
                      className="rounded-xl bg-secondary/50 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{it.name}</div>
                          <div className="mt-1 font-mono text-xs text-muted-foreground">
                            {it.itemCode}
                            {it.barcode ? ` · ${it.barcode}` : ""}
                          </div>
                        </div>
                        <Badge variant="secondary" className="shrink-0 rounded-lg">
                          {it.availableQty} / {it.reservedQty}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-background/40"
                          onClick={() =>
                            router.push(`/mobile/location/${encodeURIComponent(it.locationCode)}`)
                          }
                        >
                          <MapPin className="h-3 w-3" />
                          {it.locationCode}
                          <ChevronRight className="h-3 w-3" />
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/nomenclature/${encodeURIComponent(it.itemCode)}`}
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Номенклатура
                          </Link>
                          <span>{it.locationStatus || it.accuracyStatus}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        ) : null}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card p-4">
        <Button
          className="h-12 w-full rounded-xl bg-primary text-primary-foreground"
          onClick={() => router.push("/mobile/scan")}
        >
          <ScanLine className="mr-2 h-5 w-5" />
          Сканировать снова
        </Button>
      </div>
    </div>
  )
}

export default function ScanResultPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-muted-foreground">Загрузка…</p>
          </div>
        </div>
      }
    >
      <ScanResultContent />
    </Suspense>
  )
}
