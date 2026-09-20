"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  getFgKaraDriverStats,
  type FgKaraDriverStats,
  type FgKaraViolation,
} from "@/lib/wms-api"
import { useToast } from "@/hooks/use-toast"

const VIOLATION_LABEL: Record<string, string> = {
  refuse: "Отказ",
  wrong_row: "Не тот ряд",
  wrong_task: "Чужое задание",
  ignored_urgent: "Игнор срочного",
  other: "Прочее",
}

export function FgKaraAnalyticsPanel() {
  const { toast } = useToast()
  const [stats, setStats] = useState<FgKaraDriverStats[]>([])
  const [violations, setViolations] = useState<FgKaraViolation[]>([])
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getFgKaraDriverStats()
      setStats(res.stats || [])
      setViolations(res.violations || [])
      setUpdatedAt(res.updatedAt || null)
    } catch (e) {
      toast({
        title: "Аналитика",
        description: e instanceof Error ? e.message : "ошибка загрузки",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const totals = stats.reduce(
    (acc, s) => {
      acc.done += s.tasksDone
      acc.pallets += s.palletsDone
      acc.refused += s.tasksRefused
      acc.violations += s.violations
      acc.minutes += s.workMinutes
      return acc
    },
    { done: 0, pallets: 0, refused: 0, violations: 0, minutes: 0 }
  )

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Аналитика карщиков</div>
          <p className="text-xs text-muted-foreground">
            Палеты = сдавшие задания (пока без датчика на вилах). Нарушения: отказ, не тот ряд, чужое
            задание, игнор срочного.
            {updatedAt ? ` · обновлено ${new Date(updatedAt).toLocaleString("ru-RU")}` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={"mr-1.5 h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />
          Обновить
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl bg-primary p-3 text-primary-foreground">
          <div className="text-[11px] opacity-80">Сдано заданий</div>
          <div className="text-2xl font-bold tabular-nums">{totals.done}</div>
        </div>
        <div className="rounded-xl bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">Палет в ряд</div>
          <div className="text-2xl font-bold tabular-nums">{totals.pallets}</div>
        </div>
        <div className="rounded-xl bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">Минут в работе</div>
          <div className="text-2xl font-bold tabular-nums">{totals.minutes}</div>
        </div>
        <div className="rounded-xl bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">Отказов</div>
          <div className="text-2xl font-bold tabular-nums">{totals.refused}</div>
        </div>
        <div className="rounded-xl bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">Нарушений</div>
          <div className="text-2xl font-bold tabular-nums text-destructive">{totals.violations}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Карщик</th>
              <th className="p-3 font-medium">Смена</th>
              <th className="p-3 font-medium">Линия</th>
              <th className="p-3 font-medium tabular-nums">Всего</th>
              <th className="p-3 font-medium tabular-nums">Сдано</th>
              <th className="p-3 font-medium tabular-nums">Main</th>
              <th className="p-3 font-medium tabular-nums">Попутно</th>
              <th className="p-3 font-medium tabular-nums">Срочно</th>
              <th className="p-3 font-medium tabular-nums">Палет</th>
              <th className="p-3 font-medium tabular-nums">Мин</th>
              <th className="p-3 font-medium tabular-nums">Отказ</th>
              <th className="p-3 font-medium tabular-nums">Наруш.</th>
            </tr>
          </thead>
          <tbody>
            {loading && stats.length === 0 ? (
              <tr>
                <td colSpan={12} className="p-6 text-center text-muted-foreground">
                  Загрузка…
                </td>
              </tr>
            ) : stats.length === 0 ? (
              <tr>
                <td colSpan={12} className="p-6 text-center text-muted-foreground">
                  Пока нет данных. Создайте карщиков и выполните задания в кабинете.
                </td>
              </tr>
            ) : (
              stats.map((s) => (
                <tr key={s.driverId} className="border-b border-border/60 hover:bg-secondary/30">
                  <td className="p-3 font-medium">{s.fullName}</td>
                  <td className="p-3">{s.shiftCode || "—"}</td>
                  <td className="p-3">{s.lineCode || "—"}</td>
                  <td className="p-3 tabular-nums">{s.tasksTotal}</td>
                  <td className="p-3 tabular-nums font-semibold">{s.tasksDone}</td>
                  <td className="p-3 tabular-nums">{s.tasksMain}</td>
                  <td className="p-3 tabular-nums">{s.tasksInterleave}</td>
                  <td className="p-3 tabular-nums">{s.tasksUrgent}</td>
                  <td className="p-3 tabular-nums">{s.palletsDone}</td>
                  <td className="p-3 tabular-nums">{s.workMinutes}</td>
                  <td className="p-3 tabular-nums">{s.tasksRefused}</td>
                  <td className="p-3 tabular-nums text-destructive">{s.violations}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 text-sm font-medium">Последние нарушения</div>
        {violations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нарушений нет — хорошо.</p>
        ) : (
          <div className="space-y-2">
            {violations.slice(0, 30).map((v) => (
              <div
                key={v.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={v.kind === "ignored_urgent" || v.kind === "wrong_row" ? "destructive" : "secondary"}>
                      {VIOLATION_LABEL[v.kind] || v.kind}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.createdAt).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <p className="mt-1">{v.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
