"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type KpiTone = "neutral" | "primary" | "warning" | "danger" | "success"

const toneRing: Record<KpiTone, string> = {
  neutral: "hover:border-border",
  primary: "hover:border-primary/40",
  warning: "border-amber-500/40 bg-amber-500/[0.04] hover:border-amber-500/60",
  danger: "border-destructive/40 bg-destructive/[0.04] hover:border-destructive/60",
  success: "hover:border-emerald-500/40",
}

const toneValue: Record<KpiTone, string> = {
  neutral: "text-foreground",
  primary: "text-foreground",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-destructive",
  success: "text-emerald-700 dark:text-emerald-400",
}

const toneIcon: Record<KpiTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/15 text-primary",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  danger: "bg-destructive/15 text-destructive",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
}

export type KpiTileProps = {
  label: string
  value: number | string | null
  /** Короткая расшифровка под числом: что именно посчитано. */
  hint?: string | null
  /** Строка-предупреждение: показывается только когда есть на что реагировать. */
  alert?: string | null
  icon: React.ComponentType<{ className?: string }>
  href: string
  tone?: KpiTone
  loading?: boolean
  suffix?: string | null
}

export function DashboardKpiTile({
  label,
  value,
  hint,
  alert,
  icon: Icon,
  href,
  tone = "neutral",
  loading,
  suffix,
}: KpiTileProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-3 shadow-sm transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        toneRing[tone]
      )}
    >
      <div className="relative flex items-start gap-2">
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", toneIcon[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
          {label}
        </span>
        <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="relative mt-1.5 flex items-baseline gap-1">
        {loading ? (
          <Skeleton className="h-7 w-14 rounded-md" />
        ) : (
          <>
            <span className={cn("text-2xl font-semibold leading-none tabular-nums", toneValue[tone])}>
              {value ?? "—"}
            </span>
            {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
          </>
        )}
      </div>

      {hint ? (
        <p className="relative mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}

      {alert ? (
        <p
          className={cn(
            "relative mt-1.5 line-clamp-2 rounded-md px-1.5 py-1 text-[11px] font-medium leading-snug",
            tone === "danger"
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/12 text-amber-800 dark:text-amber-300"
          )}
        >
          {alert}
        </p>
      ) : null}
    </Link>
  )
}
