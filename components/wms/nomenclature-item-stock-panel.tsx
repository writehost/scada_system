"use client"

import Link from "next/link"
import { MapPin } from "lucide-react"
import { cn } from "@/lib/utils"

type StockRow = {
  locationCode?: string
  warehouseCode?: string
  zoneCode?: string
  availableQty?: number
  reservedQty?: number
  inProductionQty?: number
  quarantineQty?: number
  rejectedQty?: number
  accuracyStatus?: string
}

function fmtQty(n: unknown): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return "0"
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function accuracyRu(code: string): string {
  const key = code.trim().toLowerCase()
  const map: Record<string, string> = {
    unchecked: "Не проверено",
    checked: "Проверено",
    disputed: "Спорный",
  }
  return map[key] ?? (code || "—")
}

type Props = {
  rows: unknown[]
  highlightLocationCode?: string
  className?: string
}

export function NomenclatureItemStockPanel({ rows, highlightLocationCode, className }: Props) {
  const stock = (rows as StockRow[])
    .map((r) => ({
      ...r,
      availableQty: Number(r.availableQty ?? 0),
      reservedQty: Number(r.reservedQty ?? 0),
      inProductionQty: Number(r.inProductionQty ?? 0),
      quarantineQty: Number(r.quarantineQty ?? 0),
      rejectedQty: Number(r.rejectedQty ?? 0),
      locationCode: String(r.locationCode ?? ""),
      warehouseCode: String(r.warehouseCode ?? ""),
      zoneCode: String(r.zoneCode ?? ""),
    }))
    .sort((a, b) => b.availableQty - a.availableQty || a.locationCode.localeCompare(b.locationCode))

  if (stock.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center",
          className
        )}
      >
        <MapPin className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
        <p className="text-sm font-medium">Остатков нет</p>
        <p className="mt-1 text-xs text-muted-foreground">Ячейки появятся после приёмки или перемещения.</p>
      </div>
    )
  }

  return (
    <div className={cn("overflow-auto", className)}>
      <table className="wms-ag-grid min-w-[720px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="min-w-[8rem]">Склад / зона</th>
            <th className="min-w-[10rem]">Ячейка</th>
            <th className="text-right">Доступно</th>
            <th className="text-right">Резерв</th>
            <th className="text-right">В цеху</th>
            <th className="text-right">Карантин</th>
            <th>Точность</th>
          </tr>
        </thead>
        <tbody>
          {stock.map((r) => {
            const cellsListQs = new URLSearchParams()
            if (r.warehouseCode) cellsListQs.set("warehouseCode", r.warehouseCode)
            if (r.zoneCode) cellsListQs.set("zoneCode", r.zoneCode)
            const fromCells = cellsListQs.toString()
            const href = r.locationCode
              ? `/cells/${encodeURIComponent(r.locationCode)}${
                  fromCells ? `?from=${encodeURIComponent(fromCells)}` : ""
                }`
              : ""
            const highlighted =
              Boolean(highlightLocationCode) &&
              r.locationCode.toLowerCase() === highlightLocationCode!.toLowerCase()

            return (
              <tr
                key={`${r.warehouseCode}-${r.locationCode}`}
                className={cn("wms-ag-row", highlighted && "bg-amber-500/10 hover:bg-amber-500/15")}
              >
                <td className="text-muted-foreground">
                  {[r.warehouseCode, r.zoneCode].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="font-mono text-xs font-medium">
                  {href ? (
                    <Link href={href} className="text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400">
                      {r.locationCode}
                    </Link>
                  ) : (
                    r.locationCode || "—"
                  )}
                </td>
                <td className="wms-ag-cell-num font-semibold text-foreground">{fmtQty(r.availableQty)}</td>
                <td className="wms-ag-cell-num text-muted-foreground">{fmtQty(r.reservedQty)}</td>
                <td className="wms-ag-cell-num text-muted-foreground">{fmtQty(r.inProductionQty)}</td>
                <td className="wms-ag-cell-num text-muted-foreground">{fmtQty(r.quarantineQty)}</td>
                <td className="text-xs text-muted-foreground">{accuracyRu(String(r.accuracyStatus ?? ""))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
