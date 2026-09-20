"use client"

import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

interface StatsCardProps {
  title: string
  value?: string | number
  change?: number
  changeLabel?: string
  icon: React.ComponentType<{ className?: string }>
  iconColor?: string
  className?: string
  href?: string
  /** Если задано — вместо крупного счётчика показывается иллюстрация; value/changeLabel — подпись под блоком (если не отключено). */
  imageSrc?: string
  /** Для иллюстраций без обрезки (по умолчанию true при imageSrc). */
  imageContain?: boolean
  /** Только картинка: без заголовка, иконки и подписи под ней (для скринридеров остаётся title / aria-label). */
  imageNoFooter?: boolean
  /** Подсказка при наведении (только вместе с href). */
  tooltip?: string
  /**
   * Размер исходного файла (px). Для imageNoFooter задаёт пропорции: блок подстраивается под картинку, без фикс. высоты.
   * По умолчанию — текущий `public/wms/dashboard/nomenclature.png`.
   */
  imageNaturalWidth?: number
  imageNaturalHeight?: number
  /** Приоритет загрузки для LCP (обычно только первая иллюстрация на странице). */
  imagePriority?: boolean
}

export function StatsCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  iconColor = "bg-primary/10 text-primary",
  className,
  href,
  imageSrc,
  imageContain = true,
  imageNoFooter = false,
  tooltip,
  imageNaturalWidth = 508,
  imageNaturalHeight = 352,
  imagePriority,
}: StatsCardProps) {
  const caption =
    [value !== undefined && value !== "" ? String(value) : null, changeLabel].filter(Boolean).join(" · ") || null

  const hasHeroVisual = Boolean(imageNoFooter) && Boolean(imageSrc?.trim())

  const inner = hasHeroVisual ? (
    <>
      <span className="sr-only">{title}</span>
      <div className="transition-transform duration-500 ease-out motion-reduce:transition-none group-hover:scale-[1.012] motion-reduce:group-hover:scale-100">
        <Image
          src={imageSrc as string}
          alt=""
          width={imageNaturalWidth}
          height={imageNaturalHeight}
          sizes="(max-width: 640px) 50vw, (max-width: 1280px) 20vw, 12vw"
          className="block h-auto w-full align-middle"
          priority={imagePriority ?? false}
        />
      </div>
    </>
  ) : imageSrc && !imageNoFooter ? (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "relative w-full min-h-[11.5rem] overflow-hidden rounded-2xl sm:min-h-[13.5rem]",
          "bg-gradient-to-br from-[#faf8f5] via-[#f3efe8] to-[#e8e4dc] ring-1 ring-black/5"
        )}
      >
        <Image
          src={imageSrc}
          alt=""
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 28vw"
          className={cn(
            "p-3 sm:p-4",
            imageContain ? "object-contain object-center" : "object-cover object-center"
          )}
          priority
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold leading-tight text-foreground">{title}</p>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", iconColor)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {caption ? <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{caption}</p> : null}
    </div>
  ) : (
    <>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-card-foreground">{value ?? "—"}</p>
          {changeLabel && typeof change === "undefined" ? (
            <p className="mt-2 text-xs leading-snug text-muted-foreground">{changeLabel}</p>
          ) : null}
          {typeof change !== "undefined" && (
            <div className="mt-2 flex items-center gap-1.5">
              {change > 0 ? (
                <TrendingUp className="h-4 w-4 text-chart-1" />
              ) : change < 0 ? (
                <TrendingDown className="h-4 w-4 text-destructive" />
              ) : (
                <Minus className="h-4 w-4 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  change > 0 ? "text-chart-1" : change < 0 ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {change > 0 ? "+" : ""}
                {change}%
              </span>
              {changeLabel && <span className="text-sm text-muted-foreground">{changeLabel}</span>}
            </div>
          )}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", iconColor)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </>
  )
  if (href) {
    const link = (
      <Link
        href={href}
        aria-label={hasHeroVisual ? title : undefined}
        className={cn(
          "block w-full rounded-2xl shadow-sm",
          hasHeroVisual
            ? "group relative self-start overflow-hidden bg-transparent p-0 ring-1 ring-transparent transition-[box-shadow,ring-color] duration-500 ease-out hover:shadow-[0_12px_36px_-16px_rgba(0,0,0,0.12)] hover:ring-primary/25 motion-reduce:transition-none dark:hover:shadow-black/20 dark:hover:ring-primary/30"
            : "h-full bg-card p-4 transition-shadow duration-500 ease-out hover:shadow-md motion-reduce:transition-none sm:p-5",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          Boolean(imageSrc) && !imageNoFooter && "hover:ring-1 hover:ring-primary/15",
          className
        )}
      >
        {inner}
      </Link>
    )
    if (tooltip?.trim()) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className="max-w-xs">
            {tooltip.trim()}
          </TooltipContent>
        </Tooltip>
      )
    }
    return link
  }
  return (
    <div className={cn("h-full rounded-2xl bg-card p-4 shadow-sm sm:p-5", className)}>{inner}</div>
  )
}
