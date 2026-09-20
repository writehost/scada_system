"use client"

import type { ReactNode } from "react"
import { AlertTriangle, Factory, RefreshCcw } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { FgCrptCirculationStatus, FgItemStatuses } from "@/lib/wms/finished-goods-types"
import { FSN_META, type FsnClass } from "@/lib/wms/fsn"
import {
  ABC_META,
  ABCXYZ_HINT,
  XYZ_META,
  abcxyzCell,
  formatSkuProfile,
  skuProfileHint,
  type AbcClass,
  type XyzClass,
} from "@/lib/wms/sku-demand"
import type { FgNomenclatureRow } from "@/lib/wms/finished-goods-types"

const CRPT_META: Record<
  FgCrptCirculationStatus,
  { label: string; hint: string; className: string }
> = {
  none: {
    label: "ЧЗ",
    hint: "Нет кодов маркировки на складе",
    className: "border-border/80 bg-muted/40 text-muted-foreground",
  },
  introduced: {
    label: "ЧЗ",
    hint: "Все коды введены в оборот",
    className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  partial: {
    label: "ЧЗ",
    hint: "Часть кодов не введена в оборот",
    className: "border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  },
  not_introduced: {
    label: "ЧЗ",
    hint: "Коды не введены в оборот",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
}

function StatusChip({
  className,
  title,
  children,
}: {
  className: string
  title: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold leading-none",
            className
          )}
          aria-label={title}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

export function FgFsnBadge({
  fsn,
  moves,
  days,
}: {
  fsn?: FsnClass | null
  moves?: number
  days?: number
}) {
  if (!fsn) return <span className="text-muted-foreground">—</span>
  const meta = FSN_META[fsn]
  const extra =
    moves != null
      ? ` ${moves} движ. за ${days ?? 90} дн. Ставим ${meta.slot}.`
      : ` Ставим ${meta.slot}.`
  return (
    <TooltipProvider delayDuration={200}>
      <StatusChip className={meta.className} title={`${meta.hint}${extra}`}>
        {fsn}
      </StatusChip>
    </TooltipProvider>
  )
}

export function FgSkuProfileBadge({
  row,
  compact = false,
}: {
  row: Pick<
    FgNomenclatureRow,
    "storageClass" | "abc" | "xyz" | "fsn" | "fsnMoves" | "fsnDays" | "coi" | "skuProfile" | "abcxyz"
  >
  compact?: boolean
}) {
  const abc = row.abc as AbcClass | undefined
  const xyz = row.xyz as XyzClass | undefined
  const label = row.skuProfile || formatSkuProfile(row.storageClass, abc, xyz, row.fsn)
  if (label === "—") return <span className="text-muted-foreground">—</span>
  const cell = abc && xyz ? abcxyzCell(abc, xyz) : row.abcxyz
  const title = skuProfileHint({
    storageClass: row.storageClass,
    abc,
    xyz,
    fsn: row.fsn,
    moves: row.fsnMoves,
    days: row.fsnDays,
    coi: row.coi,
  })
  const chipClass =
    abc === "A"
      ? ABC_META.A.className
      : row.fsn === "F"
        ? FSN_META.F.className
        : "border-border/80 bg-muted/40 text-foreground"
  return (
    <TooltipProvider delayDuration={200}>
      <StatusChip
        className={cn(chipClass, compact ? "min-w-0 px-1.5 font-mono" : "min-w-0 px-1.5 font-mono")}
        title={title}
      >
        {label}
      </StatusChip>
      {cell ? <span className="sr-only">{ABCXYZ_HINT[cell]}</span> : null}
    </TooltipProvider>
  )
}

export function FgAbcBadge({ abc }: { abc?: AbcClass | null }) {
  if (!abc) return <span className="text-muted-foreground">—</span>
  const meta = ABC_META[abc]
  return (
    <TooltipProvider delayDuration={200}>
      <StatusChip className={meta.className} title={meta.hint}>
        {abc}
      </StatusChip>
    </TooltipProvider>
  )
}

export function FgXyzBadge({ xyz }: { xyz?: XyzClass | null }) {
  if (!xyz) return <span className="text-muted-foreground">—</span>
  const meta = XYZ_META[xyz]
  return (
    <TooltipProvider delayDuration={200}>
      <StatusChip className={meta.className} title={meta.hint}>
        {xyz}
      </StatusChip>
    </TooltipProvider>
  )
}

export function FgStatusBadges({ statuses }: { statuses: FgItemStatuses }) {
  const crpt = CRPT_META[statuses.crpt]

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-wrap items-center gap-1">
        <StatusChip className={crpt.className} title={crpt.hint}>
          {crpt.label}
        </StatusChip>
        {statuses.onResort ? (
          <StatusChip
            className="border-violet-500/50 bg-violet-500/15 text-violet-900 dark:text-violet-200"
            title="Палета на переборе — отгрузка заблокирована, пока не пересчитают состав"
          >
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
          </StatusChip>
        ) : null}
        {statuses.quarantine ? (
          <StatusChip
            className="border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-200"
            title="Карантин"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          </StatusChip>
        ) : null}
        {statuses.inProduction ? (
          <StatusChip
            className="border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-200"
            title="Отправлено на производство"
          >
            <Factory className="h-3.5 w-3.5" aria-hidden />
          </StatusChip>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
