"use client"

import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Прежние «Быстрые действия» занимали шесть иллюстраций во всю ширину колонки
 * и почти половину экрана. Плитки те же, но втрое компактнее и с подписями —
 * раньше подпись была только для скринридера, и что именно нажимаешь, было неочевидно.
 */
const ACTIONS = [
  { href: "/receiving?new=1", label: "Приёмка", src: "/wms/dashboard/quick-new-receiving.png" },
  { href: "/movement", label: "Перемещение", src: "/wms/dashboard/quick-movement.png" },
  { href: "/return", label: "Возврат", src: "/wms/dashboard/quick-issue.png" },
  { href: "/search", label: "Поиск кода", src: "/wms/dashboard/quick-scan.png" },
  { href: "/documents", label: "Документы", src: "/wms/dashboard/quick-document.png" },
  { href: "/nomenclature", label: "Номенклатура", src: "/wms/dashboard/quick-add-product.png" },
] as const

export function DashboardQuickActions({ className }: { className?: string }) {
  return (
    <section className={cn("wms-panel", className)}>
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="wms-panel-title">Быстрые действия</h2>
      </div>
      <div className="grid grid-cols-3 gap-1.5 p-2">
        {ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            prefetch={false}
            className={cn(
              "group flex min-w-0 flex-col items-center gap-1 rounded-xl border border-border/60 p-1.5 transition-colors",
              "hover:border-primary/40 hover:bg-secondary/50",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            )}
          >
            {/* У картинок снизу вшита своя подпись мелким кеглем: на узкой плитке она
                нечитаема, поэтому показываем только верх иллюстрации, а подпись даём текстом. */}
            <span className="relative block aspect-[3/2] w-full overflow-hidden rounded-lg bg-muted/40">
              <Image
                src={action.src}
                alt=""
                fill
                sizes="(max-width: 1280px) 30vw, 120px"
                className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
              />
            </span>
            <span className="w-full truncate text-center text-[11px] font-medium text-foreground">
              {action.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
