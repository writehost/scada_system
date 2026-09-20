"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Loader2, RefreshCcw, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WmsEmptyState, WmsErrorState, WmsTableSkeleton } from "@/components/wms/wms-shared"
import {
  completeFgResortJob,
  listFgResortJobs,
  type FgResortJob,
  type FgResortOutcome,
} from "@/lib/wms-api"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const OUTCOMES: Array<{ id: FgResortOutcome; label: string }> = [
  { id: "found_extra", label: "Нашли лишние" },
  { id: "found_missing", label: "Не досчитались" },
  { id: "confirmed", label: "Совпало с программой" },
]

function fmtWhen(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function statusLabel(status: FgResortJob["status"]) {
  if (status === "done") return "Закрыто"
  if (status === "cancelled") return "Отменено"
  if (status === "in_progress") return "В работе"
  return "Ждёт перебора"
}

export function FgResortPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const { toast } = useToast()
  const [tab, setTab] = useState<"open" | "done">("open")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<FgResortJob[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [outcomeById, setOutcomeById] = useState<Record<string, FgResortOutcome>>({})
  const [noteById, setNoteById] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listFgResortJobs(tab === "open" ? "open" : "done")
      setJobs(data.jobs)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить перебор")
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const openCount = useMemo(() => (tab === "open" ? jobs.length : null), [jobs.length, tab])

  async function finish(job: FgResortJob, action: "complete" | "cancel") {
    setBusyId(job.jobId)
    try {
      await completeFgResortJob({
        jobId: job.jobId,
        action,
        outcome: outcomeById[job.jobId] ?? "confirmed",
        note: noteById[job.jobId]?.trim() || undefined,
      })
      toast({
        title: action === "cancel" ? "Перебор отменён" : "Перебор закрыт",
        description:
          action === "cancel"
            ? `Палета …${job.palletCode.slice(-12)} снова доступна к отгрузке.`
            : `Палета …${job.palletCode.slice(-12)} снята с перебора.`,
      })
      await load()
    } catch (e) {
      toast({
        title: "Не удалось закрыть перебор",
        description: e instanceof Error ? e.message : "Ошибка сервера",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex rounded-lg border border-border/70 p-0.5">
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium",
              tab === "open" ? "bg-secondary text-foreground" : "text-muted-foreground"
            )}
            onClick={() => setTab("open")}
          >
            В работе{openCount != null ? ` · ${openCount}` : ""}
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium",
              tab === "done" ? "bg-secondary text-foreground" : "text-muted-foreground"
            )}
            onClick={() => setTab("done")}
          >
            Закрытые
          </button>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => void load()}>
          <RefreshCcw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
          Обновить
        </Button>
      </div>

      {error ? (
        <div className="p-4">
          <WmsErrorState title="Очередь перебора недоступна" message={error} onRetry={() => void load()} />
        </div>
      ) : loading ? (
        <WmsTableSkeleton rows={5} columns={5} />
      ) : jobs.length === 0 ? (
        <WmsEmptyState
          title={tab === "open" ? "На переборе никого нет" : "Закрытых заявок пока нет"}
          description={
            tab === "open"
              ? "Если на палете физически лежат упаковки, которых нет в программе — откройте коды ЧЗ и отправьте палету на перебор."
              : "Здесь появятся палеты, которые уже перебрали или сняли с перебора."
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="wms-ag-grid min-w-[960px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th>Палета</th>
                <th>Номенклатура</th>
                <th>Ряд</th>
                <th>Причина</th>
                <th>Статус</th>
                {tab === "open" ? <th className="w-[22rem]">Закрыть</th> : <th>Итог</th>}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.jobId} className="wms-ag-row">
                  <td className="font-mono text-xs">
                    <p>…{job.palletCode.slice(-12)}</p>
                    <p className="text-muted-foreground">{fmtWhen(job.createdAt)} · {job.createdBy}</p>
                  </td>
                  <td>
                    <p className="leading-snug">{job.itemName}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.itemCode}
                      {job.bottles > 0 ? ` · ${job.bottles} бут. в программе` : ""}
                    </p>
                  </td>
                  <td className="text-xs">
                    <p>{job.locationCode}</p>
                    <p className="text-muted-foreground">{job.rowLabel}</p>
                  </td>
                  <td className="max-w-[16rem] text-xs">
                    <p>{job.reasonLabel}</p>
                    {job.comment ? <p className="mt-0.5 text-muted-foreground">{job.comment}</p> : null}
                    {job.documentId ? (
                      <Link
                        href={`/documents/${encodeURIComponent(job.documentId)}`}
                        className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground"
                      >
                        Документ #{job.documentId}
                      </Link>
                    ) : null}
                  </td>
                  <td className="text-xs font-medium">{statusLabel(job.status)}</td>
                  {tab === "open" ? (
                    <td>
                      <div className="space-y-1.5">
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                          value={outcomeById[job.jobId] ?? "confirmed"}
                          onChange={(e) =>
                            setOutcomeById((prev) => ({
                              ...prev,
                              [job.jobId]: e.target.value as FgResortOutcome,
                            }))
                          }
                        >
                          {OUTCOMES.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <input
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                          placeholder="Что нашли при переборе"
                          value={noteById[job.jobId] ?? ""}
                          onChange={(e) =>
                            setNoteById((prev) => ({ ...prev, [job.jobId]: e.target.value }))
                          }
                        />
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 rounded-md px-2 text-xs"
                            disabled={busyId === job.jobId}
                            onClick={() => void finish(job, "complete")}
                          >
                            {busyId === job.jobId ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            Перебор выполнен
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 rounded-md px-2 text-xs"
                            disabled={busyId === job.jobId}
                            onClick={() => void finish(job, "cancel")}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" />
                            Снять
                          </Button>
                        </div>
                      </div>
                    </td>
                  ) : (
                    <td className="text-xs text-muted-foreground">
                      <p>
                        {job.status === "cancelled"
                          ? "Снято"
                          : job.outcome === "found_extra"
                            ? "Нашли лишние"
                            : job.outcome === "found_missing"
                              ? "Не досчитались"
                              : "Совпало"}
                      </p>
                      <p>
                        {fmtWhen(job.completedAt)}
                        {job.completedBy ? ` · ${job.completedBy}` : ""}
                      </p>
                      {job.completeNote ? <p>{job.completeNote}</p> : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
