"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  listErpTransferOrders,
  setTransferOrdersContinuous,
  syncTransferOrdersFrom1CErp,
  type TransferSyncResult,
  type TransferSyncSettings,
} from "@/lib/wms/one-c-erp-client"

function fmtWhen(iso: string | null): string {
  if (!iso) return "ещё не было"
  try {
    return new Date(iso).toLocaleString("ru-RU")
  } catch {
    return iso
  }
}

export function OneCTransferSyncPanel() {
  const [settings, setSettings] = useState<TransferSyncSettings | null>(null)
  const [counts, setCounts] = useState({ total: 0, open: 0, withTasks: 0 })
  const [busy, setBusy] = useState<"full" | "incremental" | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const data = await listErpTransferOrders({ limit: 1 })
    setSettings(data.defaults)
    setCounts(data.counts)
  }, [])

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [reload])

  const runSync = async (mode: "full" | "incremental") => {
    setBusy(mode)
    setError(null)
    setProgress(mode === "full" ? "Выгружаю все заказы на перемещение…" : "Забираю новые заказы…")
    try {
      const result = await syncTransferOrdersFrom1CErp(mode, (partial: TransferSyncResult) => {
        const total = partial.totalIn1C || 0
        const seen = partial.mode === "full" && total ? Math.min(total, partial.upserted) : partial.fetched
        setProgress(
          `1С: ${seen}${total ? ` из ${total}` : ""} · в WMS ${partial.upserted} · заданий ${partial.tasksCreated}`
        )
      })
      setProgress(
        `Готово: ${result.upserted} документов, ${result.tasksCreated} заданий, закрытых пропущено ${result.skippedClosed}`
      )
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress(null)
    } finally {
      setBusy(null)
    }
  }

  const toggleContinuous = async (continuous: boolean) => {
    setError(null)
    try {
      const next = await setTransferOrdersContinuous(continuous)
      setSettings(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-background/40 p-3">
      <div className="mb-2 font-medium text-foreground">Заказы на перемещение</div>
      <p className="mb-3 text-xs text-muted-foreground">
        GET <span className="font-mono">Document_ЗаказНаПеремещение</span> — разовая выгрузка всех заполненных
        полей и постоянный забор новых. Открытые заказы становятся заданиями WMS. Из конструктора документ
        создаётся POST-ом и в ERP, и в WMS.
      </p>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-secondary/40 p-2">
          <div className="text-lg font-semibold tabular-nums">{counts.total}</div>
          <div className="text-muted-foreground">в WMS</div>
        </div>
        <div className="rounded-lg bg-secondary/40 p-2">
          <div className="text-lg font-semibold tabular-nums">{counts.open}</div>
          <div className="text-muted-foreground">открытые</div>
        </div>
        <div className="rounded-lg bg-secondary/40 p-2">
          <div className="text-lg font-semibold tabular-nums">{counts.withTasks}</div>
          <div className="text-muted-foreground">с заданиями</div>
        </div>
      </div>
      <div className="mb-3 flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2">
        <div>
          <div className="text-sm font-medium">Постоянно забирать новые</div>
          <div className="text-[11px] text-muted-foreground">
            Каждые 5 минут, только документы после {fmtWhen(settings?.lastWatermarkDate ?? null)}
          </div>
        </div>
        <Switch
          checked={settings?.continuous === true}
          onCheckedChange={(v) => void toggleContinuous(v)}
          disabled={!settings}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          disabled={Boolean(busy)}
          onClick={() => void runSync("full")}
        >
          {busy === "full" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Выгрузить все
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          disabled={Boolean(busy)}
          onClick={() => void runSync("incremental")}
        >
          {busy === "incremental" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Забрать новые
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Полная выгрузка: {fmtWhen(settings?.lastFullSyncAt ?? null)}. Новые: {fmtWhen(settings?.lastIncrementalAt ?? null)}.
      </p>
      {progress ? <p className="mt-1 text-xs text-foreground">{progress}</p> : null}
      {error || settings?.lastError ? (
        <p className="mt-1 text-xs text-destructive">{error || settings?.lastError}</p>
      ) : null}
    </div>
  )
}
