"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Forklift, ScanLine } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { ForkliftWarehouseMap } from "@/components/wms/forklift-warehouse-map"
import {
  fmtForkliftTime,
  getForkliftCurrentBatch,
  getForkliftMapRows,
  placePalletInRow,
  type ForkliftMapRow,
  type ForkliftPlacement,
} from "@/lib/wms/forklift-pos-mock"

function BatchCard({ batch }: { batch: ReturnType<typeof getForkliftCurrentBatch> }) {
  const pending = batch.palletsTotal - batch.palletsPlaced
  const progress = Math.round((batch.palletsPlaced / batch.palletsTotal) * 100)

  return (
    <div className="rounded-3xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Текущая партия</p>
          <h2 className="mt-1 text-xl font-bold leading-snug md:text-2xl">{batch.productName}</h2>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {batch.batchCode} · {batch.lineName}
          </p>
        </div>
        <Badge variant="secondary" className="rounded-lg text-xs">
          с {fmtForkliftTime(batch.startedAt)}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-background/80 p-2">
          <p className="text-[10px] text-muted-foreground">Всего</p>
          <p className="text-xl font-bold tabular-nums">{batch.palletsTotal}</p>
        </div>
        <div className="rounded-xl bg-emerald-100/80 p-2 dark:bg-emerald-950/40">
          <p className="text-[10px] text-muted-foreground">Поставлено</p>
          <p className="text-xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
            {batch.palletsPlaced}
          </p>
        </div>
        <div className="rounded-xl bg-amber-100/80 p-2 dark:bg-amber-950/40">
          <p className="text-[10px] text-muted-foreground">Осталось</p>
          <p className="text-xl font-bold tabular-nums">{pending}</p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{batch.fifoLabel}</p>
    </div>
  )
}

function SuccessOverlay({
  placement,
  onNext,
}: {
  placement: ForkliftPlacement
  onNext: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border-2 border-emerald-300 bg-emerald-50 p-8 text-center shadow-xl dark:bg-emerald-950/90">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-600" />
        <h2 className="mt-4 text-2xl font-bold">Палета учтена</h2>
        <p className="mt-2 text-lg font-semibold">{placement.rowLabel}</p>
        <p className="mt-1 text-muted-foreground">
          Место {placement.slotIndex} · 1 палет на полу
        </p>
        <p className="mt-3 font-mono text-xs break-all text-muted-foreground">{placement.palletSerial}</p>
        <Button type="button" className="mt-8 h-14 w-full rounded-2xl text-base" onClick={onNext}>
          Следующая палета
        </Button>
      </div>
    </div>
  )
}

export default function ForkliftPosTerminalPage() {
  const { toast } = useToast()
  const [tick, setTick] = useState(0)
  const [zone, setZone] = useState<string | "all">("all")
  const [onlyRecommended, setOnlyRecommended] = useState(false)
  const [palletScan, setPalletScan] = useState("")
  const [busy, setBusy] = useState(false)
  const [lastPlacement, setLastPlacement] = useState<ForkliftPlacement | null>(null)

  const batch = useMemo(() => getForkliftCurrentBatch(), [tick])
  const mapRows = useMemo(
    () => getForkliftMapRows({ zone, onlyRecommended, mapRowsLimit: 8 }),
    [zone, onlyRecommended, tick]
  )

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  async function handleRowSelect(row: ForkliftMapRow) {
    if (busy || row.freePalletSlots < 1) return
    setBusy(true)
    try {
      await new Promise((r) => setTimeout(r, 280))
      const result = placePalletInRow(row.rowId, palletScan)
      setPalletScan("")
      setLastPlacement(result)
      refresh()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Не удалось поставить палету",
        description: e instanceof Error ? e.message : "Ошибка размещения",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {lastPlacement ? (
        <SuccessOverlay placement={lastPlacement} onNext={() => setLastPlacement(null)} />
      ) : null}

      <header className="flex shrink-0 items-center justify-between border-b border-border/60 bg-card/90 px-4 py-3">
        <div className="flex items-center gap-2">
          <Forklift className="h-5 w-5 text-primary" />
          <span className="font-semibold">Пост карщика</span>
        </div>
        <Link
          href="/pos-terminal"
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Другие POS
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 pb-8">
        <BatchCard batch={batch} />

        <div className="rounded-xl border border-border bg-card p-3">
          <label className="mb-2 flex items-center gap-2 text-sm font-medium">
            <ScanLine className="h-4 w-4 text-muted-foreground" />
            Код палеты перед выбором ряда (необязательно)
          </label>
          <Input
            value={palletScan}
            onChange={(e) => setPalletScan(e.target.value)}
            placeholder="Скан SSCC — затем нажмите ряд"
            className="h-12 rounded-xl font-mono"
            autoComplete="off"
            disabled={busy}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {(["all", "A", "B", "C"] as const).map((z) => (
            <Button
              key={z}
              type="button"
              size="sm"
              variant={zone === z ? "default" : "outline"}
              className="h-9 rounded-xl"
              onClick={() => setZone(z)}
            >
              {z === "all" ? "Все зоны" : `Зона ${z}`}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={onlyRecommended ? "default" : "outline"}
            className="h-9 rounded-xl"
            onClick={() => setOnlyRecommended((v) => !v)}
          >
            {onlyRecommended ? "Только FIFO" : "Все ряды"}
          </Button>
        </div>

        <ForkliftWarehouseMap rows={mapRows} onSelectRow={handleRowSelect} disabled={busy} />
      </div>
    </div>
  )
}
