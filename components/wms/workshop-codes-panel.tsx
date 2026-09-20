"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, ScanLine } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getWorkshopCodes, type WorkshopCodeRow } from "@/lib/wms-api"

type WorkshopCodesPanelProps = {
  locationCode?: string
  itemCode?: string
  title?: string
  compact?: boolean
  maxRows?: number
  /** Встроенный список без запроса (например из карточки ячейки). */
  initialRows?: WorkshopCodeRow[]
  initialTotal?: number
}

function fmtQty(n: number) {
  return new Intl.NumberFormat("ru-RU").format(n)
}

export function WorkshopCodesPanel({
  locationCode,
  itemCode,
  title = "Коды маркировки в цеху",
  compact = false,
  maxRows = 50,
  initialRows,
  initialTotal,
}: WorkshopCodesPanelProps) {
  const [rows, setRows] = useState<WorkshopCodeRow[]>(initialRows ?? [])
  const [total, setTotal] = useState(initialTotal ?? initialRows?.length ?? 0)
  const [loading, setLoading] = useState(!initialRows)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    if (initialRows) return
    setLoading(true)
    setError(null)
    try {
      const res = await getWorkshopCodes({
        locationCode,
        itemCode,
        limit: maxRows,
      })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить коды")
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [initialRows, locationCode, itemCode, maxRows])

  useEffect(() => {
    if (!initialRows) void load()
  }, [initialRows, load])

  if (compact) {
    if (total === 0 && !loading) return null
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-lg"
          onClick={() => {
            setDialogOpen(true)
            if (!initialRows && rows.length === 0) void load()
          }}
        >
          <ScanLine className="mr-1.5 h-3.5 w-3.5" />
          {loading ? "…" : `${fmtQty(total)} код.`}
        </Button>
        <WorkshopCodesDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={title}
          rows={rows}
          total={total}
          loading={loading}
          error={error}
          locationCode={locationCode}
          onRetry={() => void load()}
        />
      </>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <ScanLine className="h-4 w-4 text-primary" />
            {title}
          </h3>
          <p className="text-muted-foreground text-sm">
            {total > 0
              ? `${fmtQty(total)} кодов привязано к ячейкам цеха`
              : "Нет кодов в цеху по этому фильтру"}
          </p>
        </div>
        {!initialRows ? (
          <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => void load()}>
            Обновить
          </Button>
        ) : null}
      </div>
      <WorkshopCodesTable rows={rows} loading={loading} error={error} onRetry={() => void load()} />
      {total > rows.length ? (
        <p className="text-muted-foreground text-xs">
          Показано {rows.length} из {fmtQty(total)}.{" "}
          {locationCode ? (
            <Link href={`/cells/${encodeURIComponent(locationCode)}`} className="text-primary underline-offset-2 hover:underline">
              Открыть ячейку
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

function WorkshopCodesDialog({
  open,
  onOpenChange,
  title,
  rows,
  total,
  loading,
  error,
  locationCode,
  onRetry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  rows: WorkshopCodeRow[]
  total: number
  loading: boolean
  error: string | null
  locationCode?: string
  onRetry: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {locationCode ? (
              <span>
                Ячейка <span className="font-mono">{locationCode}</span> · {fmtQty(total)} кодов
              </span>
            ) : (
              <span>Всего {fmtQty(total)} кодов в цеху</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <WorkshopCodesTable rows={rows} loading={loading} error={error} onRetry={onRetry} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WorkshopCodesTable({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: WorkshopCodeRow[]
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загружаю коды…
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-2 py-4 text-sm">
        <p className="text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-sm">
        В цеху нет привязанных кодов маркировки. Выдайте материал со склада — коды переедут вместе с выдачей.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40 border-b text-left text-xs">
            <th className="p-2 font-medium">Номенклатура</th>
            <th className="p-2 font-medium">Серийный</th>
            <th className="p-2 font-medium">Ячейка</th>
            <th className="p-2 font-medium">Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.codeId} className="border-b last:border-b-0">
              <td className="p-2">
                <div className="font-medium">{row.itemName}</div>
                <div className="text-muted-foreground font-mono text-xs">{row.itemCode}</div>
              </td>
              <td className="p-2 font-mono text-xs">{row.serial}</td>
              <td className="p-2">
                <Link
                  href={`/cells/${encodeURIComponent(row.locationCode)}`}
                  className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                >
                  {row.locationCode}
                </Link>
              </td>
              <td className="p-2">
                <Badge variant="secondary" className="rounded-md text-[10px]">
                  {row.statusName}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
