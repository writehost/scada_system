"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, Boxes, CalendarClock, ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  getWarehouseOccupancy,
  listExpiryStickerAlerts,
  listTasks,
} from "@/lib/wms-api"
import {
  attentionKindLabel,
  buildAttentionItems,
  summarizeAttentionItems,
  type AttentionItem,
} from "@/lib/wms/attention-items"

function kindIcon(kind: AttentionItem["kind"]) {
  if (kind === "zone_full") return Boxes
  if (kind === "task_exception") return ClipboardList
  return CalendarClock
}

function kindBadgeClass(kind: AttentionItem["kind"]) {
  if (kind === "expiry_critical" || kind === "task_exception") {
    return "bg-destructive/10 text-destructive"
  }
  if (kind === "expiry_warning") return "bg-sky-500/10 text-sky-700 dark:text-sky-300"
  return "bg-chart-3/10 text-chart-3"
}

export default function AttentionPage() {
  const [items, setItems] = useState<AttentionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [tasksRes, occupancy, expiryRes] = await Promise.all([
          listTasks({ limit: 100 }),
          getWarehouseOccupancy(),
          listExpiryStickerAlerts(),
        ])
        if (ignore) return
        setItems(
          buildAttentionItems({
            tasks: tasksRes.tasks || [],
            zones: occupancy.zones || [],
            expiryAlerts: expiryRes.alerts || [],
          })
        )
      } catch (e) {
        if (!ignore) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить список")
          setItems([])
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [])

  const summary = useMemo(() => summarizeAttentionItems(items), [items])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 rounded-xl" asChild>
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Дашборд
            </Link>
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Требует внимания</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "Загрузка…" : summary}
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-lg font-medium text-foreground">Сейчас всё в порядке</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Нет переполненных зон, проблемных заданий и партий со сроком стикера в зоне риска.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const Icon = kindIcon(item.kind)
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "block rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
                  item.kind === "expiry_critical" && "border-destructive/30 bg-destructive/[0.03]",
                  item.kind === "expiry_warning" && "border-sky-500/25 bg-sky-500/[0.04]"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", kindBadgeClass(item.kind))}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className={cn("rounded-lg font-normal", kindBadgeClass(item.kind))}>
                        {attentionKindLabel(item.kind)}
                      </Badge>
                    </div>
                    <p className="font-medium leading-snug text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
