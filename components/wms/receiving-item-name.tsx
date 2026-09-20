"use client"

import { useMemo } from "react"
import type { ReceivingScanEventRow } from "@/components/wms/receiving-scan-events-table"
import { cn } from "@/lib/utils"

export function uniqueReceivingItemNames(rows: ReceivingScanEventRow[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const name = row.itemName?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function ReceivingItemName({
  name,
  className,
}: {
  name: string | null | undefined
  className?: string
}) {
  const text = name?.trim()
  if (!text) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span className={cn("block whitespace-normal break-words leading-snug", className)} title={text}>
      {text}
    </span>
  )
}

export function ReceivingSessionItemNames({
  scans,
  fallbackName,
  className,
}: {
  scans: ReceivingScanEventRow[]
  fallbackName?: string | null
  className?: string
}) {
  const names = useMemo(() => uniqueReceivingItemNames(scans), [scans])
  const fallback = fallbackName?.trim()

  if (names.length === 0) {
    if (fallback) return <ReceivingItemName name={fallback} className={className} />
    return <span className="text-muted-foreground">—</span>
  }

  if (names.length === 1) {
    return <ReceivingItemName name={names[0]} className={className} />
  }

  return (
    <ul className={cn("space-y-1.5", className)}>
      {names.map((name) => (
        <li key={name}>
          <ReceivingItemName name={name} />
        </li>
      ))}
    </ul>
  )
}
