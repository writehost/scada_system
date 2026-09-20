"use client"

import { useEffect, useState } from "react"
import { Sparkles, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  CELLS_AI_MAX_LIMIT,
  pollCellsAiFill,
  startCellsAiFill,
  stopCellsAiFill,
  type CellsAiJobView,
} from "@/lib/wms/cells-ai-fill-client"

export function CellsAiFillDialog({
  open,
  onOpenChange,
  warehouseCode,
  zoneCode,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouseCode?: string
  zoneCode?: string
  onApplied: () => void
}) {
  const [masterCode, setMasterCode] = useState("")
  const [limit, setLimit] = useState(() => (warehouseCode === "FG" ? "650" : "30"))
  const [apply, setApply] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<CellsAiJobView | null>(null)
  const running = job?.status === "running" || job?.status === "stopping"
  const scope = [warehouseCode || "все склады", zoneCode || "все зоны"].join(" · ")

  useEffect(() => {
    if (running) return
    setLimit(warehouseCode === "FG" ? "650" : "30")
  }, [warehouseCode, running])

  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "stopping")) return
    let cancelled = false
    const tick = window.setInterval(() => {
      void pollCellsAiFill(job.id)
        .then((next) => {
          if (cancelled) return
          setJob(next)
          if (next.status === "done" || next.status === "stopped" || next.status === "error") {
            setBusy(false)
            if (next.apply && next.status !== "error") onApplied()
          }
        })
        .catch((e) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : "Не удалось опросить задачу")
          setBusy(false)
        })
    }, 900)
    return () => {
      cancelled = true
      window.clearInterval(tick)
    }
  }, [job?.id, job?.status, job?.apply, onApplied])

  async function start() {
    const n = Number(limit)
    const safeLimit = Number.isFinite(n) ? Math.min(CELLS_AI_MAX_LIMIT, Math.max(1, Math.trunc(n))) : 30
    setBusy(true)
    setError(null)
    try {
      const next = await startCellsAiFill({
        masterCode,
        apply,
        limit: safeLimit,
        warehouseCode,
        zoneCode,
      })
      setJob(next)
      if (next.status !== "running") setBusy(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запустить настройку")
      setBusy(false)
    }
  }

  async function stop() {
    if (!job) return
    try {
      setJob(await stopCellsAiFill(job.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось остановить")
    }
  }

  const progress = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Настроить ячейки ИИ</DialogTitle>
          <DialogDescription>
            Ряды плана ГП уже есть — новые ячейки не создаются. Для них ставится класс F (готовая продукция), процесс
            STORE и правило ряда: A/B/C/D/F/K — FIFO-ряд и FEFO, E и SHIP — LIFO-ряд и FIFO. Цех без профиля по-прежнему
            разбирает модель. Текущий отбор: {scope}. Остатки не двигает. Мастер-ключ тот же, что на заказах кодов.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cells-ai-master">Мастер-ключ</Label>
            <Input
              id="cells-ai-master"
              type="password"
              autoComplete="off"
              value={masterCode}
              onChange={(e) => setMasterCode(e.target.value)}
              disabled={running}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Лимит ячеек</Label>
              <Input value={limit} onChange={(e) => setLimit(e.target.value)} disabled={running} />
            </div>
            <div className="grid gap-1.5">
              <Label>Запись</Label>
              <Button type="button" variant={apply ? "default" : "outline"} className="justify-start" disabled={running} onClick={() => setApply((v) => !v)}>
                {apply ? "Записать в базу" : "Только предпросмотр"}
              </Button>
            </div>
          </div>

          {job ? (
            <div className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {job.status === "running"
                    ? "Настраиваю…"
                    : job.status === "stopping"
                      ? "Останавливаю…"
                      : job.status === "stopped"
                        ? "Остановлено"
                        : job.status === "error"
                          ? "Остановлено из‑за ошибки"
                          : job.apply
                            ? "Готово, записано"
                            : "Предпросмотр готов"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {job.processed}/{job.total || "?"} · {progress}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                настроено {job.filled} · пропуск {job.skipped}
              </div>
              {job.error ? <div className="mt-2 text-sm text-destructive">{job.error}</div> : null}
              {job.log.length > 0 ? (
                <div className="mt-3 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] leading-snug text-muted-foreground">
                  {job.log.slice(-20).map((line, idx) => (
                    <div key={`${line.locationCode}-${idx}`} className="flex flex-wrap gap-x-2">
                      <span className="text-foreground">{line.locationCode}</span>
                      <span>{line.warehouseCode}/{line.zoneCode}</span>
                      <span>{line.materialType || "—"}</span>
                      <span>{line.processType || "—"}</span>
                      {line.lane ? <span>{line.lane}</span> : null}
                      <span>{line.note}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">{error}</div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {running ? (
            <Button type="button" variant="destructive" className="rounded-xl" onClick={() => void stop()}>
              <Square className="mr-2 h-4 w-4" />
              Остановить сейчас
            </Button>
          ) : (
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          )}
          <Button type="button" className="rounded-xl" onClick={() => void start()} disabled={busy || running || !masterCode.trim()}>
            <Sparkles className="mr-2 h-4 w-4" />
            {running ? "Работает…" : apply ? "Запустить запись" : "Предпросмотр"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
