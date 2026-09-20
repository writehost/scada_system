"use client"

import Link from "next/link"
import { ChevronDown, ClipboardList, ExternalLink } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type Props = {
  variant?: "full" | "compact"
  defaultOpen?: boolean
  itemCode?: string | null
  className?: string
}

export const PRODUCTION_SPEC_MISSING_TITLE =
  "Нельзя создать заказ: у продукта не указан состав (рецептура)"

export const PRODUCTION_SPEC_MISSING_SUMMARY =
  "WMS не знает, из каких материалов собирать эту готовую продукцию и сколько их нужно на плановый выпуск."

export function nomenclatureItemHref(itemCode: string) {
  return `/nomenclature/${encodeURIComponent(itemCode.trim())}`
}

export function isMissingActiveSpecMessage(message: string): boolean {
  const t = message.toLowerCase()
  return t.includes("спецификац") || t.includes("bom") || t.includes("no_active_spec") || t.includes("состав")
}

export function formatApsUserError(message: string): { title: string; detail?: string; isSpec: boolean } {
  if (isMissingActiveSpecMessage(message)) {
    return { title: PRODUCTION_SPEC_MISSING_TITLE, detail: PRODUCTION_SPEC_MISSING_SUMMARY, isSpec: true }
  }
  return { title: message, isSpec: false }
}

export function ProductionSpecMissingHint({
  itemCode,
  itemName,
  className,
}: {
  itemCode: string
  itemName?: string | null
  className?: string
}) {
  const code = itemCode.trim()
  if (!code) return null

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-950 dark:text-amber-100",
        className
      )}
    >
      <p className="text-sm font-semibold">{PRODUCTION_SPEC_MISSING_TITLE}</p>
      <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
        {itemName ? (
          <>
            Позиция: <span className="font-medium">{itemName}</span> ({code})
          </>
        ) : (
          <>Позиция: {code}</>
        )}
      </p>
      <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">{PRODUCTION_SPEC_MISSING_SUMMARY}</p>
      <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
        Пример: если планируете выпустить 10&nbsp;000 бутылок, система должна заранее посчитать — сколько нужно
        пробок, этикеток, сиропа и т.д. Эти нормы хранятся в <span className="font-medium">составе продукта</span>{" "}
        (спецификации / рецептуре). Сейчас для этой номенклатуры состав в WMS не заведён или не активен.
      </p>
      <div className="mt-3 space-y-1.5">
        <p className="font-medium text-amber-950 dark:text-amber-50">Что сделать</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Проверьте, что выбрана именно готовая продукция, а не сырьё или полуфабрикат.</li>
          <li>Заведите или обновите состав в 1С ERP — при обмене он попадёт в WMS.</li>
          <li>Если обмена с 1С нет — попросите администратора WMS добавить состав в базе.</li>
        </ol>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Link
          href={nomenclatureItemHref(code)}
          className="inline-flex items-center gap-1 font-medium text-amber-950 underline underline-offset-2 hover:text-amber-900 dark:text-amber-50"
        >
          Открыть карточку номенклатуры
          <ExternalLink className="size-3" />
        </Link>
        <Link
          href="/nomenclature"
          className="inline-flex items-center gap-1 font-medium text-amber-950 underline underline-offset-2 hover:text-amber-900 dark:text-amber-50"
        >
          Справочник номенклатуры
          <ExternalLink className="size-3" />
        </Link>
      </div>
    </div>
  )
}

export function ProductionSpecHelpPanel({
  variant = "full",
  defaultOpen,
  itemCode,
  className,
}: Props) {
  const compact = variant === "compact"
  const openByDefault = defaultOpen ?? false
  const code = itemCode?.trim() || ""

  return (
    <Collapsible
      defaultOpen={openByDefault}
      className={cn("rounded-xl border border-sky-500/25 bg-sky-500/5", className)}
    >
      <CollapsibleTrigger className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-600/10">
          <ClipboardList className="size-4 text-sky-700 dark:text-sky-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            Справка: состав продукта и расчёт материалов
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {compact
              ? "Нажмите, если видите ошибку про отсутствие состава или спецификации"
              : "Как WMS считает потребность в материалах для производственного заказа"}
          </p>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-sky-500/15 px-4 pb-4 pt-3 text-sm text-muted-foreground">
        <section className="space-y-2 text-xs leading-relaxed">
          <p>
            <span className="font-medium text-foreground">Состав продукта</span> (спецификация, рецептура, BOM) — это
            таблица «что и сколько нужно на 1 единицу готовой продукции»: сырьё, упаковка, этикетки, полуфабрикаты.
          </p>
          <p>
            При создании заказа WMS берёт плановый объём (например, 5&nbsp;000 шт.) и умножает на нормы из состава.
            Получается список материалов к заказу/резерву на складе OS.
          </p>
          <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-amber-950 dark:text-amber-100">
            Ошибка «нет активной спецификации» означает: для выбранной номенклатуры в WMS нет рабочего состава — заказ
            создать нельзя, пока состав не заведут.
          </p>
        </section>

        <section className="space-y-1.5 text-xs">
          <p className="font-medium text-foreground">Куда обращаться</p>
          <ul className="list-inside list-disc space-y-1 leading-relaxed">
            <li>Технолог / планово-экономический отдел — состав в 1С ERP.</li>
            <li>Администратор WMS — ручная загрузка, если обмена с 1С нет.</li>
          </ul>
        </section>

        <div className="flex flex-wrap gap-3 text-xs">
          {code ? (
            <Link
              href={nomenclatureItemHref(code)}
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              Карточка {code}
              <ExternalLink className="size-3" />
            </Link>
          ) : null}
          <Link
            href="/nomenclature"
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            Справочник номенклатуры
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
