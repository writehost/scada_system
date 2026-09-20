"use client"

import {
  SLOT_PROFILE_TEMPLATES,
  ZONE_LABELS,
  type StorageSlotProfile,
} from "@/lib/storage-slot-ui"
import { cn } from "@/lib/utils"

type Props = {
  onPick: (profile: StorageSlotProfile, zoneHint?: string) => void
  disabled?: boolean
  className?: string
}

export function CellsProfileTemplates({ onPick, disabled, className }: Props) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-sm font-medium">Шаблон</p>
      <div className="flex flex-wrap gap-2">
        {SLOT_PROFILE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(t.profile, t.zoneHint)}
            title={t.description}
            className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-left text-xs transition-colors hover:border-emerald-600/40 hover:bg-emerald-600/5 disabled:opacity-50"
          >
            <div className="text-sm font-medium text-foreground">{t.title}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {ZONE_LABELS[t.zoneHint] ?? t.zoneHint}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
