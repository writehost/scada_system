"use client"

import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FileInput, FilePlus2, Inbox, PenLine, Send, Undo2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { fmtDate, relTime, useApi, useLiveEvents } from "@/components/api"
import { Bars, HBars, LineChart } from "@/components/charts"
import { can, useMe } from "@/components/shell"
import { Badge, Button, cn, Spinner } from "@/components/ui"
import { docType } from "@/lib/edi/doc-types.ts"

type Dash = {
  counts: Record<string, number>
  attention: Array<{ kind: string; documentId: string; title: string; docType: string; taskId: string | null; dueAt: string | null; note: string; at: string }>
  charts: {
    flow: Array<{ day: string; incoming: number; outgoing: number; internal: number }>
    completed: Array<{ week: string; n: number }>
    byType: Array<{ docType: string; n: number }>
    approvalHours: number | null
    approvalCount: number
    partners: Array<{ id: string; name: string; n: number; amount: number }>
  }
}

const TILES: Array<{ key: string; label: string; folder: string; icon: typeof Inbox; tone?: "danger" | "warning" }> = [
  { key: "newIncoming", label: "Новые входящие", folder: "incoming", icon: Inbox },
  { key: "in_review", label: "На согласовании", folder: "in_review", icon: Clock },
  { key: "signing", label: "Ожидают подписи", folder: "signing", icon: PenLine },
  { key: "rejected", label: "Отклонённые", folder: "rejected", icon: Undo2, tone: "danger" },
  { key: "overdue", label: "Просроченные задачи", folder: "tasks", icon: AlertTriangle, tone: "danger" },
  { key: "outgoing", label: "Исходящие", folder: "outgoing", icon: Send },
  { key: "completed", label: "Завершённые", folder: "completed", icon: CheckCircle2 },
]

const KIND_LABEL: Record<string, string> = { task: "Задача", incoming: "Входящий", rejected: "Возврат", payment: "Оплата" }

export default function Dashboard() {
  const me = useMe()
  const router = useRouter()
  const { data, reload } = useApi<Dash>("/api/edi/dashboard")
  useLiveEvents(() => reload())
  if (!data) return <div className="grid h-64 place-items-center"><Spinner /></div>
  const c = data.counts
  const ch = data.charts
  const flowTotal = ch.flow.reduce((s, d) => s + d.incoming + d.outgoing, 0)
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Добрый день, {me.fio.split(" ").slice(-2).join(" ")}</h1>
        {can(me, "edi.import") && (
          <Button icon={<FileInput className="size-4" />} onClick={() => router.push("/import")}>
            Загрузить
          </Button>
        )}
        {can(me, "edi.doc.create") && (
          <Button variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => router.push("/documents/new")}>
            Создать документ
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {TILES.map((t) => {
          const v = c[t.key] ?? 0
          const Icon = t.icon
          return (
            <Link key={t.key} href={`/documents?folder=${t.folder}`} className="rounded-xl border border-border bg-card px-3 py-2.5 hover:border-ring">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className="size-3.5" />
                {t.label}
              </div>
              <div className={cn("mt-1 text-2xl font-bold tabular-nums", v > 0 && t.tone === "danger" && "text-destructive")}>{v}</div>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">Требуют моего внимания</h2>
            <Link href="/documents?folder=tasks" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Все задачи <ArrowRight className="size-3" />
            </Link>
          </header>
          {data.attention.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">Срочных дел нет — новые задачи появятся здесь автоматически.</p>
          ) : (
            <ul>
              {data.attention.map((a, i) => {
                const overdue = a.dueAt && new Date(a.dueAt) < new Date()
                return (
                  <li key={`${a.kind}-${a.documentId}-${a.taskId ?? i}`}>
                    <Link href={`/documents?id=${a.documentId}&folder=${a.kind === "task" ? "tasks" : "all"}`} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-row-hover">
                      <Badge tone={a.kind === "rejected" ? "danger" : a.kind === "task" ? "primary" : a.kind === "payment" ? "warning" : "info"} className="w-[70px] justify-center">
                        {KIND_LABEL[a.kind] ?? a.kind}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{a.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {docType(a.docType)?.short} · {a.note}
                        </div>
                      </div>
                      {a.dueAt && (
                        <span className={cn("shrink-0 text-xs tabular-nums", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                          {overdue ? "просрочено" : "до"} {a.kind === "payment" ? fmtDate(a.dueAt) : relTime(a.dueAt).replace("через ", "")}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          {flowTotal > 0 && (
            <section className="rounded-xl border border-border bg-card p-3 sm:col-span-2 xl:col-span-1">
              <h2 className="mb-2 text-sm font-semibold">Входящие и исходящие за 30 дней</h2>
              <LineChart
                series={[
                  { name: "Входящие", color: "var(--viz-1)" },
                  { name: "Исходящие", color: "var(--viz-2)" },
                ]}
                points={ch.flow.map((d) => ({ label: fmtDate(d.day).slice(0, 5), values: [d.incoming, d.outgoing] }))}
              />
            </section>
          )}
          {ch.approvalCount > 0 && (
            <section className="rounded-xl border border-border bg-card p-3">
              <h2 className="text-sm font-semibold">Среднее время согласования</h2>
              <div className="mt-1 text-2xl font-bold tabular-nums">{ch.approvalHours != null ? (ch.approvalHours < 48 ? `${ch.approvalHours.toFixed(1)} ч` : `${(ch.approvalHours / 24).toFixed(1)} дн`) : "—"}</div>
              <p className="text-xs text-muted-foreground">по {ch.approvalCount} завершённым маршрутам за 90 дней</p>
            </section>
          )}
          {ch.completed.length > 1 && (
            <section className="rounded-xl border border-border bg-card p-3">
              <h2 className="mb-2 text-sm font-semibold">Завершено по неделям</h2>
              <Bars rows={ch.completed.map((w) => ({ label: fmtDate(w.week).slice(0, 5), value: w.n }))} />
            </section>
          )}
          {ch.byType.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-3">
              <h2 className="mb-2 text-sm font-semibold">Документы по типам · 90 дней</h2>
              <HBars rows={ch.byType.map((t) => ({ key: t.docType, label: docType(t.docType)?.name ?? t.docType, value: t.n }))} onClick={(k) => router.push(`/documents?type=${k}`)} />
            </section>
          )}
          {ch.partners.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-3">
              <h2 className="mb-2 text-sm font-semibold">Активность контрагентов · 90 дней</h2>
              <HBars rows={ch.partners.map((p) => ({ key: p.id, label: p.name, value: p.n, hint: `${p.amount.toLocaleString("ru-RU")} ₽` }))} format={(v) => `${v} док.`} onClick={(id) => router.push(`/counterparties?id=${id}`)} />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
