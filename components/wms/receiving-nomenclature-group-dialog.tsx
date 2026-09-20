"use client"

import { FolderTree } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { OperatorNomenclatureGroup } from "@/lib/nomenclature-group-catalog"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: OperatorNomenclatureGroup[]
  selectedCode: string
  onSelect: (code: string) => void
  description?: string
  title?: string
}

export function ReceivingNomenclatureGroupDialog({
  open,
  onOpenChange,
  groups,
  selectedCode,
  onSelect,
  description = "Выберите товарную группу для фильтрации сессий приёмки, сканов и документов.",
  title = "Номенклатурные группы Честного знака",
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/60 px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-emerald-700" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <button
                key={g.code}
                type="button"
                onClick={() => {
                  onSelect(g.code)
                  onOpenChange(false)
                }}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  selectedCode === g.code
                    ? "border-emerald-600/50 bg-emerald-600/10"
                    : "border-border/60 bg-card hover:bg-secondary/40"
                )}
              >
                <div className="text-sm font-semibold text-foreground">{g.name}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {g.description || (g.itemCount > 0 ? `${g.itemCount} поз.` : g.code)}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end border-t border-border/60 px-6 py-4">
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
