"use client"

import { BookOpen } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LABEL_ORDER_DOC_PATH, LABEL_ORDER_HELP } from "@/lib/wms/label-order-help"

/** Подсказка прямо на странице: та же инструкция, что лежит в docs на сервере. */
export function LabelOrderHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-4" />
            Заказы кодов: как это работает
          </DialogTitle>
          <DialogDescription>
            Документ заказа, расчёт погрешности печати и корректировка факта.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
          {LABEL_ORDER_HELP.map((section) => (
            <section key={section.title} className="space-y-1.5">
              <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
              {section.intro ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{section.intro}</p>
              ) : null}
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-2 text-xs leading-relaxed text-foreground/85">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            Полная документация с таблицами базы и эндпоинтами лежит на сервере:{" "}
            <code className="font-mono text-foreground/80">{LABEL_ORDER_DOC_PATH}</code>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
