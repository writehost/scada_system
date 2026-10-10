"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { rub } from "@/lib/client/format"
import { cn } from "@/lib/client/cn"
import { Button, Panel, Skeleton, useToast } from "@/components/ui"
import { PageHeader } from "@/components/ems/shell"
import { PayDialog, useObligations, type ObligationRow } from "@/components/ems/obligation-form"

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

export default function CalendarPage() {
  const toast = useToast()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const first = cursor
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
  const q = useObligations({ from: key(new Date(first.getTime() - 7 * 86400000)), to: key(new Date(last.getTime() + 7 * 86400000)) })
  const [pay, setPay] = useState<ObligationRow | null>(null)
  const cells = useMemo(() => {
    const start = new Date(first)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [first])
  const today = key(new Date())
  const byDay = (k: string) => ({
    pay: (q.data?.items ?? []).filter((o) => o.dueDate === k),
    readings: (q.data?.items ?? []).filter((o) => o.readingsDueDate === k && o.status !== "paid"),
  })
  const title = cursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", "")
  return (
    <div className="space-y-4">
      <PageHeader title="Календарь платежей" subtitle="Сроки оплаты и передачи показаний" />
      <Panel
        title={title.charAt(0).toUpperCase() + title.slice(1)}
        actions={
          <>
            <Button variant="outline" size="icon-sm" aria-label="Предыдущий месяц" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
              Сегодня
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Следующий месяц" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
              <ChevronRight />
            </Button>
          </>
        }
        bodyClassName="p-2 sm:p-3"
      >
        {!q.data ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase text-muted-foreground">
              {WD.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((d) => {
                const k = key(d)
                const { pay: p, readings: r } = byDay(k)
                const inMonth = d.getMonth() === cursor.getMonth()
                return (
                  <div key={k} className={cn("min-h-16 rounded-lg border p-1 text-left sm:min-h-24", inMonth ? "border-border/70 bg-card" : "border-transparent bg-muted/30 text-muted-foreground", k === today && "ring-2 ring-primary")}>
                    <p className="text-[11px] font-medium">{d.getDate()}</p>
                    <div className="space-y-0.5">
                      {p.map((o) => (
                        <button
                          key={o.obligationId}
                          type="button"
                          onClick={() => o.status !== "paid" && setPay(o)}
                          title={`${o.title}: ${o.amount != null ? rub(o.amount) : "сумма неизвестна"}`}
                          className={cn("block w-full truncate rounded px-1 text-left text-[10px] sm:text-[11px]", o.status === "paid" ? "bg-emerald-500/15 text-emerald-800 line-through" : o.status === "overdue" ? "bg-destructive/15 text-destructive" : o.status === "due_soon" ? "bg-amber-500/20 text-amber-900" : "bg-muted")}
                        >
                          {o.title}
                          <span className="hidden sm:inline">{o.amount != null ? ` · ${rub(o.amount)}` : ""}</span>
                        </button>
                      ))}
                      {r.map((o) => (
                        <p key={`r${o.obligationId}`} className="truncate rounded border border-dashed border-sky-500/50 px-1 text-[10px] text-sky-800 sm:text-[11px]" title={`Передать показания: ${o.title}`}>
                          показания: {o.title}
                        </p>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Нажмите на платёж, чтобы отметить оплату. Пунктир — срок передачи показаний.</p>
          </>
        )}
      </Panel>
      <PayDialog obligation={pay} onClose={() => setPay(null)} onDone={() => { q.reload(); toast("Оплата отмечена") }} />
    </div>
  )
}
