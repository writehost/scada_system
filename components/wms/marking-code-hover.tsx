"use client"

import { QrCode } from "lucide-react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { formatMarkingCodeDisplay } from "@/lib/wms/crpt"
import { cn } from "@/lib/utils"

function datamatrixUrl(code: string): string {
  const qp = new URLSearchParams({ text: code })
  return `/api/wms/marking/datamatrix?${qp.toString()}`
}

export function MarkingCodeHover({
  code,
  className,
  iconClassName,
}: {
  code: string
  className?: string
  iconClassName?: string
}) {
  const trimmed = code.trim()
  if (!trimmed) return <span className="text-muted-foreground">—</span>

  const displayCode = formatMarkingCodeDisplay(trimmed)

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-secondary/40 text-foreground transition-colors hover:bg-secondary",
            className
          )}
          aria-label="Код маркировки"
        >
          <QrCode className={cn("h-4 w-4 text-primary", iconClassName)} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-[min(92vw,320px)] space-y-3 p-3">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Код маркировки</div>
          <div className="break-all font-mono text-[11px] leading-relaxed text-foreground">{displayCode}</div>
        </div>
        <div className="flex justify-center rounded-xl border border-border/60 bg-white p-3 dark:bg-zinc-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={datamatrixUrl(displayCode)}
            alt="Data Matrix"
            width={160}
            height={160}
            className="h-40 w-40 object-contain"
            loading="lazy"
          />
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
