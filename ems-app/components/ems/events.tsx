"use client"

import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { relative } from "@/lib/client/format"
import { cn } from "@/lib/client/cn"
import { Badge, Empty } from "@/components/ui"

export type EventRow = { event_id: string; severity: string; title: string; message: string; status: string; opened_at: string; last_seen_at?: string; category: string; occurrences: number; site_name?: string; meter_name?: string }

export const CATEGORY_LABEL: Record<string, string> = { anomaly: "Аномалия", telemetry_lost: "Нет связи", leak: "Утечка", limit: "Лимит", equipment: "Оборудование", data_quality: "Качество данных", billing: "Подписка" }

export function SeverityIcon({ severity, status }: { severity: string; status?: string }) {
  if (status === "resolved") return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
  if (severity === "critical") return <AlertOctagon className="size-4 shrink-0 text-destructive" />
  if (severity === "warning") return <AlertTriangle className="size-4 shrink-0 text-amber-600" />
  return <Info className="size-4 shrink-0 text-muted-foreground" />
}

export function EventList({ events, compact, onSelect, selected }: { events: EventRow[]; compact?: boolean; onSelect?: (e: EventRow) => void; selected?: string | null }) {
  if (!events.length) return <Empty icon={CheckCircle2} title="Событий нет" text="Здесь появятся предупреждения о перерасходе, потере связи и подозрительных показаниях." />
  return (
    <ul className="divide-y divide-border/60">
      {events.map((e) => (
        <li key={e.event_id}>
          <button type="button" disabled={!onSelect} onClick={() => onSelect?.(e)} className={cn("flex w-full gap-2.5 px-4 py-2.5 text-left", onSelect && "hover:bg-muted/40", selected === e.event_id && "bg-muted/60")}>
            <SeverityIcon severity={e.severity} status={e.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className={cn("text-[13px] font-medium", e.status === "resolved" && "text-muted-foreground")}>{e.title}</p>
                {!compact ? <Badge>{CATEGORY_LABEL[e.category] ?? e.category}</Badge> : null}
                {e.status === "acknowledged" ? <Badge tone="info">подтверждено</Badge> : null}
                {e.status === "resolved" ? <Badge tone="success">закрыто</Badge> : null}
                {e.occurrences > 1 ? <span className="text-[11px] text-muted-foreground">×{e.occurrences}</span> : null}
              </div>
              <p className={cn("text-xs text-muted-foreground", compact && "line-clamp-2")}>{e.message}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {relative(e.opened_at)}
                {e.site_name ? ` · ${e.site_name}` : ""}
                {e.meter_name ? ` · ${e.meter_name}` : ""}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
