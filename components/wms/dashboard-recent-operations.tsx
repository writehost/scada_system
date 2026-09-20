"use client"

import Link from "next/link"
import { ArrowRightLeft, ClipboardCheck, Factory, PackageMinus, Truck } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  documentStatusLabel,
  operationKind,
  operationLabel,
  plural,
  relativeTime,
  type DashboardLastOp,
  type OperationKind,
} from "@/lib/wms/dashboard-data"

const kindIcon: Record<OperationKind, React.ComponentType<{ className?: string }>> = {
  receiving: Truck,
  movement: ArrowRightLeft,
  issue: PackageMinus,
  production: Factory,
  other: ClipboardCheck,
}

const kindColor: Record<OperationKind, string> = {
  receiving: "bg-primary/12 text-primary",
  movement: "bg-chart-2/12 text-chart-2",
  issue: "bg-chart-3/12 text-chart-3",
  production: "bg-chart-4/15 text-chart-4",
  other: "bg-muted text-muted-foreground",
}

function statusTone(code: string): string {
  const v = (code || "").toLowerCase()
  if (v.includes("cancel")) return "bg-destructive/10 text-destructive"
  if (v.includes("applied") || v.includes("complete")) return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
  if (v.includes("progress") || v.includes("released")) return "bg-chart-3/12 text-chart-3"
  return "bg-muted text-muted-foreground"
}

export function DashboardRecentOperations({
  operations,
  loading,
  className,
}: {
  operations: DashboardLastOp[]
  loading?: boolean
  className?: string
}) {
  return (
    <section className={cn("wms-panel", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h2 className="wms-panel-title">Последние операции</h2>
        <Link
          href="/documents"
          prefetch={false}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Все документы
        </Link>
      </div>

      <div className="p-2">
        {loading && operations.length === 0 ? (
          <div className="space-y-1.5 p-1">
            <Skeleton className="h-11 rounded-lg" />
            <Skeleton className="h-11 rounded-lg" />
            <Skeleton className="h-11 rounded-lg" />
          </div>
        ) : operations.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Документов пока нет — операции появятся после первой приёмки или перемещения.
          </p>
        ) : (
          <ul>
            {operations.map((op) => {
              const kind = operationKind(op.documentType)
              const Icon = kindIcon[kind]
              return (
                <li key={op.documentId}>
                  <Link
                    href={`/documents/${encodeURIComponent(op.documentId)}`}
                    prefetch={false}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/60"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        kindColor[kind]
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {operationLabel(op.documentType)}{" "}
                        <span className="font-normal text-muted-foreground">
                          {op.documentNo || `#${op.documentId}`}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {op.comment ||
                          `${op.lineCount} ${plural(op.lineCount, "позиция", "позиции", "позиций")}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={cn(
                          "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
                          statusTone(op.documentStatus)
                        )}
                      >
                        {documentStatusLabel(op.documentStatus)}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {relativeTime(op.createdAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
