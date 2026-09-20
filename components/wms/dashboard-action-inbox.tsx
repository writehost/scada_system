"use client"

import Link from "next/link"
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  HelpCircle,
  Layers,
  PackageCheck,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type InboxSeverity = "critical" | "warning" | "info"

export type InboxItem = {
  id: string
  severity: InboxSeverity
  /** Группа задачи: по ней оператор понимает, куда идти разбираться. */
  group: "receiving" | "expiry" | "tasks" | "zones" | "nomenclature"
  title: string
  description: string
  href: string
  actionLabel: string
}

const groupIcon = {
  receiving: PackageCheck,
  expiry: CalendarClock,
  tasks: ClipboardList,
  zones: Layers,
  nomenclature: HelpCircle,
}

const severityStyles: Record<InboxSeverity, { row: string; badge: string; label: string }> = {
  critical: {
    row: "border-destructive/30 bg-destructive/[0.04] hover:border-destructive/50",
    badge: "bg-destructive/15 text-destructive",
    label: "Срочно",
  },
  warning: {
    row: "border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/50",
    badge: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    label: "Проверить",
  },
  info: {
    row: "border-border/70 bg-card hover:border-border",
    badge: "bg-muted text-muted-foreground",
    label: "К сведению",
  },
}

export function DashboardActionInbox({
  items,
  loading,
  className,
}: {
  items: InboxItem[]
  loading?: boolean
  className?: string
}) {
  const critical = items.filter((i) => i.severity === "critical").length
  const warning = items.filter((i) => i.severity === "warning").length

  return (
    <section className={cn("wms-panel", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="wms-panel-title">Требует действий</h2>
          {items.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
              {items.length}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {loading
            ? "Считаем…"
            : items.length === 0
              ? "Открытых вопросов нет"
              : [critical > 0 ? `${critical} срочно` : null, warning > 0 ? `${warning} проверить` : null]
                  .filter(Boolean)
                  .join(" · ")}
        </p>
      </div>

      <div className="space-y-1.5 p-2">
        {loading && items.length === 0 ? (
          <>
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Разбирать нечего</p>
              <p className="text-xs text-muted-foreground">
                Все приёмки проведены на остаток, сроки стикеров в норме, зависших заданий нет.
              </p>
            </div>
          </div>
        ) : (
          items.map((item) => {
            const Icon = groupIcon[item.group]
            const style = severityStyles[item.severity]
            return (
              <Link
                key={item.id}
                href={item.href}
                prefetch={false}
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  style.row
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                    style.badge
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">{item.title}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        style.badge
                      )}
                    >
                      {style.label}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1 self-center text-xs font-medium text-muted-foreground sm:flex">
                  {item.actionLabel}
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
                <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
              </Link>
            )
          })
        )}
      </div>
    </section>
  )
}

export function inboxSeverityWeight(severity: InboxSeverity): number {
  if (severity === "critical") return 0
  if (severity === "warning") return 1
  return 2
}
