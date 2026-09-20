"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  CalendarDays,
  MapPin,
  Package,
  QrCode,
  RefreshCw,
} from "lucide-react"

type BatchView = {
  batch?: {
    batchCode?: string | null
    itemCode?: string | null
    itemName?: string | null
    imageUrl?: string | null
    productGroup?: string | null
    itemClassCode?: string | null
    gtin?: string | null
    qty?: number | null
    cellCode?: string | null
    lotCode?: string | null
    emissionAtIso?: string | null
    expiresAtIso?: string | null
    documentId?: string | null
  } | null
  documentQty?: number | null
  stockAvailableQty?: number | null
  currentLocationCode?: string | null
  source?: string
  error?: string
}

function fmtDate(value: string | null | undefined) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d)
}

function fmtQty(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—"
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

type Props = {
  batchCode: string
  siteCode?: string
  cellHint?: string
  itemHint?: string
  gtinHint?: string
  qtyHint?: string
}

export function BatchScanPage({
  batchCode,
  siteCode,
  cellHint,
  itemHint,
  gtinHint,
  qtyHint,
}: Props) {
  const [data, setData] = useState<BatchView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const apiUrl = useMemo(() => {
    const qp = new URLSearchParams()
    if (siteCode?.trim()) qp.set("siteCode", siteCode.trim())
    if (cellHint?.trim()) qp.set("cell", cellHint.trim())
    if (itemHint?.trim()) qp.set("item", itemHint.trim())
    if (gtinHint?.trim()) qp.set("gtin", gtinHint.trim())
    if (qtyHint?.trim()) qp.set("qty", qtyHint.trim())
    const q = qp.toString()
    return `/api/s/batch/${encodeURIComponent(batchCode)}${q ? `?${q}` : ""}`
  }, [batchCode, siteCode, cellHint, itemHint, gtinHint, qtyHint])

  async function load() {
    if (!batchCode.trim()) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(apiUrl, { cache: "no-store" })
      const json = (await r.json().catch(() => ({}))) as BatchView
      if (!r.ok) {
        setData(null)
        setError(json.error || `HTTP ${r.status}`)
        return
      }
      setData(json)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : "Не удалось загрузить партию")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl])

  const batch = data?.batch
  const cell = batch?.cellCode || data?.currentLocationCode || cellHint || "—"
  const itemName = batch?.itemName || itemHint || "—"
  const itemCode = batch?.itemCode || itemHint || "—"
  const emission = fmtDate(batch?.emissionAtIso)
  const expires = fmtDate(batch?.expiresAtIso)

  return (
    <div className="min-h-dvh bg-[#F7F7F2] text-[#1B5E20]">
      <header className="sticky top-0 z-10 border-b border-black/8 bg-[#F7F7F2]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-[#6B6B6B]">Партия стикеров</p>
            <h1 className="text-lg font-semibold leading-tight text-[#1B5E20] whitespace-normal break-words">{itemName}</h1>
            <p className="mt-0.5 break-all font-mono text-[11px] text-[#2E7D32]">{batchCode}</p>
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
              Номенклатура
            </div>
            {data?.source === "qr_fallback" ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                из QR
              </span>
            ) : null}
          </div>
          <div className="space-y-3 px-4 py-3 text-sm">
            <div className="flex gap-3">
              {batch?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={batch.imageUrl}
                  alt={itemName}
                  className="h-20 w-20 shrink-0 rounded-xl border border-black/5 object-cover bg-[#F0F0EA]"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-black/10 bg-[#F7F7F2] text-[10px] text-[#9E9E9E]">
                  нет фото
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium leading-snug">{itemName}</p>
                <p className="font-mono text-[11px] text-[#757575]">{itemCode}</p>
                {batch?.productGroup ? (
                  <p className="text-[11px] text-[#616161]">{batch.productGroup}</p>
                ) : null}
                {batch?.itemClassCode ? (
                  <p className="text-[11px] text-[#616161]">Класс {batch.itemClassCode}</p>
                ) : null}
                {batch?.gtin ? (
                  <p className="text-[11px] text-[#616161]">
                    GTIN <span className="font-mono">{batch.gtin}</span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <MapPin className="h-4 w-4" />
            Размещение
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">Ячейка</dt>
              <dd>
                {cell !== "—" ? (
                  <Link href={`/s/c/${encodeURIComponent(cell)}`} className="font-mono text-[#2E7D32] underline">
                    {cell}
                  </Link>
                ) : (
                  <span className="font-mono">—</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">Партия</dt>
              <dd className="tabular-nums">{fmtQty(batch?.qty)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">В документе</dt>
              <dd className="tabular-nums">{fmtQty(data?.documentQty)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">Остаток в ячейке</dt>
              <dd className="tabular-nums">{fmtQty(data?.stockAvailableQty)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4" />
            Сроки
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">Эмиссия</dt>
              <dd>{emission || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#757575]">Годен до</dt>
              <dd className={expires ? "font-semibold text-[#2E7D32]" : ""}>{expires || "—"}</dd>
            </div>
            {batch?.lotCode ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[#757575]">Партия склада</dt>
                <dd className="font-mono text-[11px] text-[#616161]">{batch.lotCode}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <QrCode className="h-4 w-4" />
            Код
          </h2>
          <p className="break-all font-mono text-[11px] text-[#2E7D32]">{batchCode}</p>
          {batch?.documentId ? (
            <p className="mt-2 text-[11px] text-[#757575]">Документ {batch.documentId}</p>
          ) : null}
        </section>
      </main>
    </div>
  )
}
