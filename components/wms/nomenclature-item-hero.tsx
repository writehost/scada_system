"use client"

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronDown, ExternalLink, FileText, ImageOff, ZoomIn } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type HeroBadge = {
  text: string
  tone?: "code" | "outline" | "info" | "warn"
  title?: string
}

export type HeroStat = {
  label: string
  value: string
  tone?: "ok" | "warn" | "hold" | "muted"
  onClick?: () => void
}

export type HeroFact = {
  label: string
  value: string
  mono?: boolean
}

export type HeroBlock = {
  label?: string
  text: string
}

export type HeroAttachment = {
  label: string
  href: string
}

const FACTS_PREVIEW = 6

const statToneClass: Record<NonNullable<HeroStat["tone"]>, string> = {
  ok: "text-emerald-800 dark:text-emerald-400",
  warn: "text-amber-800 dark:text-amber-400",
  hold: "text-orange-800 dark:text-orange-400",
  muted: "text-foreground",
}

function badgeProps(tone: HeroBadge["tone"]) {
  switch (tone) {
    case "code":
      return { variant: "secondary" as const, className: "font-mono" }
    case "info":
      return {
        variant: "outline" as const,
        className: "border-sky-600/30 bg-sky-600/10 text-sky-900 dark:text-sky-300",
      }
    case "warn":
      return {
        variant: "outline" as const,
        className: "border-amber-600/30 bg-amber-600/10 text-amber-900 dark:text-amber-300",
      }
    default:
      return { variant: "outline" as const, className: "" }
  }
}

function ItemPhoto({
  url,
  alt,
  onZoom,
}: {
  url: string
  alt: string
  onZoom: () => void
}) {
  const [broken, setBroken] = useState(false)
  const size = "h-24 w-24 sm:h-28 sm:w-28"

  if (!url || broken) {
    return (
      <div
        className={cn(
          size,
          "flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-background/60 text-center text-muted-foreground"
        )}
        title="Фото добавляется в «Реквизиты» → ссылка на изображение"
      >
        <ImageOff className="h-5 w-5" />
        <span className="px-1 text-[10px] leading-tight">Нет фото</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onZoom}
      title="Увеличить фото"
      className={cn(
        size,
        "group relative shrink-0 overflow-hidden rounded-xl border border-border/70 bg-white outline-none transition hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="h-full w-full object-contain"
        onError={() => setBroken(true)}
      />
      <span className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/55 p-1 text-white opacity-0 transition group-hover:opacity-100">
        <ZoomIn className="h-3 w-3" />
      </span>
    </button>
  )
}

export function NomenclatureItemHero({
  title,
  itemCode,
  badges,
  stats,
  description,
  facts,
  attachments,
  imageUrl,
  emptyDescriptionHint,
  onShowAllFacts,
  aside,
}: {
  title: string
  itemCode: string
  badges: HeroBadge[]
  stats: HeroStat[]
  description: HeroBlock[]
  facts: HeroFact[]
  attachments: HeroAttachment[]
  imageUrl: string
  emptyDescriptionHint: string
  onShowAllFacts?: () => void
  aside?: ReactNode
}) {
  const [zoomOpen, setZoomOpen] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [factsExpanded, setFactsExpanded] = useState(false)

  const visibleFacts = useMemo(
    () => (factsExpanded ? facts : facts.slice(0, FACTS_PREVIEW)),
    [facts, factsExpanded]
  )
  const hiddenFactsCount = Math.max(0, facts.length - visibleFacts.length)
  const descRef = useRef<HTMLDivElement | null>(null)
  const [descClipped, setDescClipped] = useState(false)

  useEffect(() => {
    const el = descRef.current
    if (!el) {
      setDescClipped(false)
      return
    }
    const check = () => setDescClipped(el.scrollHeight - el.clientHeight > 2)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [description, descExpanded])

  const showDescToggle = descExpanded || descClipped

  return (
    <div className="@container/hero border-b border-border bg-muted/20 px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-3 @3xl/hero:flex-row @3xl/hero:items-start @3xl/hero:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ItemPhoto url={imageUrl} alt={title} onZoom={() => setZoomOpen(true)} />
          <div className="min-w-0 @3xl/hero:hidden">
            <HeroTitle title={title} itemCode={itemCode} />
          </div>
        </div>

        <div className="@container/main min-w-0 flex-1 space-y-2.5">
          <div className="hidden @3xl/hero:block">
            <HeroTitle title={title} itemCode={itemCode} />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {badges.map((badge) => {
              const props = badgeProps(badge.tone)
              return (
                <Badge
                  key={`${badge.tone ?? "b"}-${badge.text}`}
                  variant={props.variant}
                  title={badge.title ?? badge.text}
                  className={cn(
                    "max-w-[16rem] truncate rounded-md text-[11px] font-normal",
                    props.className
                  )}
                >
                  {badge.text}
                </Badge>
              )
            })}
            {stats.length > 0 ? (
              <span className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block" />
            ) : null}
            {stats.map((stat) =>
              stat.onClick ? (
                <button
                  key={stat.label}
                  type="button"
                  onClick={stat.onClick}
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-foreground/25 hover:text-foreground"
                >
                  {stat.label}
                  <span className={cn("font-semibold tabular-nums", statToneClass[stat.tone ?? "muted"])}>
                    {stat.value}
                  </span>
                </button>
              ) : (
                <span
                  key={stat.label}
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {stat.label}
                  <span className={cn("font-semibold tabular-nums", statToneClass[stat.tone ?? "muted"])}>
                    {stat.value}
                  </span>
                </span>
              )
            )}
          </div>

          <div className="grid gap-2.5 @md/main:grid-cols-2">
            <section className="min-w-0 rounded-xl border border-border/60 bg-background/70 px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Описание
              </div>
              {description.length === 0 ? (
                <p className="text-sm text-muted-foreground">{emptyDescriptionHint}</p>
              ) : (
                <div
                  ref={descRef}
                  className={cn(
                    "space-y-1.5 text-sm leading-snug text-foreground",
                    descExpanded ? "max-h-64 overflow-auto pr-1" : "max-h-[4.5rem] overflow-hidden"
                  )}
                >
                  {description.map((block, index) => (
                    <div key={`${block.label ?? "main"}-${index}`} className="min-w-0">
                      {block.label ? (
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {block.label}
                        </div>
                      ) : null}
                      <p className="whitespace-pre-wrap break-words">{block.text}</p>
                    </div>
                  ))}
                </div>
              )}
              {showDescToggle ? (
                <button
                  type="button"
                  onClick={() => setDescExpanded((v) => !v)}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {descExpanded ? "Свернуть" : "Показать всё"}
                  <ChevronDown className={cn("h-3 w-3 transition", descExpanded && "rotate-180")} />
                </button>
              ) : null}
              {attachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
                  {attachments.map((file) => (
                    <a
                      key={file.href}
                      href={file.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-[12rem] items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-0.5 text-[11px] text-foreground/80 hover:border-foreground/30 hover:text-foreground"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{file.label}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="min-w-0 rounded-xl border border-border/60 bg-background/70 px-3 py-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Реквизиты
                </div>
                {onShowAllFacts ? (
                  <button
                    type="button"
                    onClick={onShowAllFacts}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Все поля
                  </button>
                ) : null}
              </div>
              {facts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Реквизиты не заполнены — откройте вкладку «Реквизиты».
                </p>
              ) : (
                <dl className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
                  {visibleFacts.map((fact) => (
                    <Fragment key={fact.label}>
                      <dt className="truncate text-[11px] leading-5 text-muted-foreground" title={fact.label}>
                        {fact.label}
                      </dt>
                      <dd
                        className={cn(
                          "line-clamp-2 min-w-0 break-words leading-5 text-foreground",
                          fact.mono && "font-mono text-[11px]"
                        )}
                        title={fact.value}
                      >
                        {fact.value}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              )}
              {hiddenFactsCount > 0 || factsExpanded ? (
                <button
                  type="button"
                  onClick={() => setFactsExpanded((v) => !v)}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {factsExpanded ? "Свернуть" : `Ещё ${hiddenFactsCount}`}
                  <ChevronDown className={cn("h-3 w-3 transition", factsExpanded && "rotate-180")} />
                </button>
              ) : null}
            </section>
          </div>
        </div>

        {aside ? (
          <div className="max-w-sm @3xl/hero:w-60 @3xl/hero:max-w-none @3xl/hero:shrink-0">{aside}</div>
        ) : null}
      </div>

      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent
          className="max-h-[94vh] w-[min(92vw,880px)] max-w-[min(92vw,880px)] overflow-hidden p-3 sm:max-w-[min(92vw,880px)]"
          overlayClassName="bg-black/70"
        >
          <DialogHeader>
            <DialogTitle className="pr-8 text-base leading-snug">{title}</DialogTitle>
          </DialogHeader>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={title}
              className="max-h-[78vh] w-full rounded-lg bg-white object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function HeroTitle({ title, itemCode }: { title: string; itemCode: string }) {
  return (
    <>
      <Link
        href="/nomenclature"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Номенклатура
      </Link>
      <h1
        className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg"
        title={`${title} · ${itemCode}`}
      >
        {title}
      </h1>
    </>
  )
}

export function ItemLoadErrorPanel({
  message,
  status,
  onRetry,
  retrying,
}: {
  message: string
  status?: number
  onRetry: () => void
  retrying?: boolean
}) {
  const hint =
    status && status >= 500
      ? "Сервис данных WMS не ответил. Обычно помогает повтор запроса; если ошибка держится — проверьте службу API и сообщите в поддержку."
      : status === 403
        ? "Недостаточно прав на просмотр карточки. Запросите доступ у администратора."
        : null

  return (
    <div className="m-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:m-4">
      <div className="text-sm font-medium text-destructive">
        {message}
        {status ? <span className="ml-1.5 font-mono text-xs opacity-70">HTTP {status}</span> : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <Button
        size="sm"
        variant="outline"
        className="mt-3 h-8 rounded-lg"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Повтор…" : "Повторить"}
      </Button>
    </div>
  )
}
