"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Box,
  MapPin,
  Package,
  QrCode,
  RefreshCw,
} from "lucide-react"
import { explainLocationCode } from "@/lib/location-code-help"
import {
  formatCellQty,
  slotLabel,
  warehouseDisplayLabel,
  zoneDisplayLabel,
} from "@/lib/storage-slot-ui"
import { locationStatusLabelRU } from "@/lib/wms-labels"
import type { CellScanView } from "@/lib/wms/cell-scan-view"

function fmtDate(value: string | null | undefined) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d)
}

export function CellScanPage({ locationCode }: { locationCode: string }) {
  const [data, setData] = useState<CellScanView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!locationCode.trim()) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/s/cell/${encodeURIComponent(locationCode)}`, { cache: "no-store" })
      const json = (await r.json().catch(() => ({}))) as CellScanView & { error?: string }
      if (!r.ok) {
        setData(null)
        setError(json.error || `HTTP ${r.status}`)
        return
      }
      setData(json)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : "Не удалось загрузить ячейку")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationCode])

  const explanation = useMemo(
    () =>
      data
        ? explainLocationCode(data.locationCode, {
            slotProfile: data.slotProfile,
            warehouseCode: data.warehouseCode,
            zoneCode: data.zoneCode,
          })
        : null,
    [data]
  )

  const stockTotal = data?.stock.reduce((s, row) => s + Number(row.availableQty || 0), 0) ?? 0

  return (
    <div className="min-h-dvh bg-[#F7F7F2] text-[#1B5E20]">
      <header className="sticky top-0 z-10 border-b border-black/8 bg-[#F7F7F2]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-[#6B6B6B]">Ячейка склада</p>
            <h1 className="truncate text-lg font-semibold leading-tight text-[#1B5E20]">
              {data?.displayName || data?.slotTitle || locationCode || "Ячейка"}
            </h1>
            <p className="mt-0.5 break-all font-mono text-[11px] text-[#2E7D32]">{locationCode}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-[#1B5E20]/20 bg-white p-2 text-[#1B5E20]"
            aria-label="Обновить"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-4 pb-10">
        {error ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-[#757575] shadow-sm">Загрузка…</div>
        ) : null}

        <section className="rounded-2xl bg-white text-[#1B5E20] shadow-sm">
          <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
            <div className="flex items-center gap-2 font-semibold">
              <Package className="h-4 w-4" />
              Содержимое
            </div>
            <span className="rounded-full bg-[#E8F5E9] px-2 py-0.5 text-xs font-semibold text-[#1B5E20]">
              {data?.stock.length ?? 0} поз. · {formatCellQty(stockTotal)}
            </span>
          </div>
          {!data?.stock.length ? (
            <p className="px-4 py-6 text-sm text-[#757575]">Ячейка пустая</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {data.stock.map((row) => (
                <li key={row.itemCode} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">{row.name}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-[#757575]">
                        {row.itemCode}
                        {row.barcode ? ` · ${row.barcode}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-semibold tabular-nums">{formatCellQty(row.availableQty)}</p>
                      <p className="text-[10px] uppercase text-[#9E9E9E]">доступно</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[#616161]">
                    {Number(row.quarantineQty) > 0 ? (
                      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-800">
                        карантин {formatCellQty(row.quarantineQty)}
                      </span>
                    ) : null}
                    {Number(row.inProductionQty) > 0 ? (
                      <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                        в цеху {formatCellQty(row.inProductionQty)}
                      </span>
                    ) : null}
                    {row.nearestExpiryAt ? (
                      <span className="rounded-md bg-black/5 px-1.5 py-0.5">срок {fmtDate(row.nearestExpiryAt)}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {data?.lots.length ? (
          <section className="rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Box className="h-4 w-4" />
              Партии
            </h2>
            <ul className="space-y-2">
              {data.lots.map((lot) => (
                <li key={`${lot.itemCode}-${lot.lotCode}`} className="rounded-xl bg-[#F5F7F5] px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{lot.itemName}</p>
                      <p className="font-mono text-[11px] text-[#757575]">{lot.lotCode}</p>
                    </div>
                    <span className="tabular-nums text-sm font-semibold">{formatCellQty(lot.availableQty)}</span>
                  </div>
                  {lot.expiryAt ? <p className="mt-1 text-[11px] text-[#757575]">до {fmtDate(lot.expiryAt)}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <QrCode className="h-4 w-4" />
            Коды в ячейке
          </h2>
          {!data?.codes.length ? (
            <p className="text-sm text-[#757575]">Маркировочных кодов нет</p>
          ) : (
            <ul className="space-y-2">
              {data.codes.map((row) => (
                <li key={row.codeId} className="rounded-xl bg-[#F5F7F5] px-3 py-2">
                  <p className="text-sm">{row.itemName}</p>
                  <p className="mt-0.5 font-mono text-[11px] break-all text-[#2E7D32]">{row.display}</p>
                  <p className="mt-1 text-[11px] text-[#757575]">
                    {row.statusName} · {row.itemCode}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <MapPin className="h-4 w-4" />
            О ячейке
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">Склад</dt>
              <dd>{data ? warehouseDisplayLabel(data.warehouseCode) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">Зона</dt>
              <dd>{data ? zoneDisplayLabel(data.zoneCode) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">Статус</dt>
              <dd>{data ? locationStatusLabelRU(data.locationStatus) : "—"}</dd>
            </div>
            {data?.slotProfile?.materialType ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[#757575]">Материал</dt>
                <dd>{slotLabel("materialType", data.slotProfile.materialType)}</dd>
              </div>
            ) : null}
            {data?.slotProfile?.processType ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[#757575]">Назначение</dt>
                <dd>{slotLabel("processType", data.slotProfile.processType)}</dd>
              </div>
            ) : null}
            {data?.slotTitle ? (
              <div>
                <dt className="text-[#757575]">Профиль</dt>
                <dd className="mt-1">{data.slotTitle}</dd>
              </div>
            ) : null}
          </dl>
          {explanation ? (
            <div className="mt-3 rounded-xl bg-[#E8F5E9] px-3 py-2 text-[12px] leading-relaxed text-[#424242]">
              <p className="font-medium text-[#1B5E20]">{explanation.title}</p>
              <p className="mt-1">{explanation.summary}</p>
              {explanation.segments.length ? (
                <ul className="mt-2 space-y-1">
                  {explanation.segments.map((seg) => (
                    <li key={`${seg.code}-${seg.label}`}>
                      <span className="font-mono text-[#2E7D32]">{seg.code}</span>
                      {" — "}
                      {seg.label}
                      {seg.meaning ? <span className="text-[#757575]"> ({seg.meaning})</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}
