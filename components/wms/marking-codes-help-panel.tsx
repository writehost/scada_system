"use client"

import Link from "next/link"
import { ChevronDown, Database, QrCode, ScanLine, Search } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type Props = {
  /** full — карточка номенклатуры; compact — диалог создания */
  variant?: "full" | "compact"
  defaultOpen?: boolean
  className?: string
}

export function MarkingCodesHelpPanel({
  variant = "full",
  defaultOpen = variant === "compact",
  className,
}: Props) {
  const compact = variant === "compact"

  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("rounded-xl border border-sky-500/25 bg-sky-500/5", className)}>
      <CollapsibleTrigger className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-600/10">
          <Database className="h-4 w-4 text-sky-700" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            База кодов маркировки
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {compact
              ? "Как связаны номенклатура, ЧЗ и внутренние DataMatrix-коды WMS"
              : "PostgreSQL: codes · code_state · wms_item_codes — где хранятся сканы и их статус"}
          </p>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-sky-500/15 px-4 pb-4 pt-3 text-sm text-muted-foreground">
        <section>
          <p className="mb-1.5 font-medium text-foreground">Что хранится</p>
          <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed">
            <li>
              <span className="font-mono text-foreground/80">codes</span> — GTIN, серийный номер, полный скан GS1
              (Data Matrix)
            </li>
            <li>
              <span className="font-mono text-foreground/80">code_state</span> — статус (эмитирован, на складе, в
              ячейке), площадка, признаки
            </li>
            <li>
              <span className="font-mono text-foreground/80">wms_item_codes</span> — связь кода с номенклатурой и
              текущей ячейкой
            </li>
          </ul>
        </section>

        <section>
          <p className="mb-1.5 font-medium text-foreground">Два типа маркировки</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-background/60 p-2.5 text-xs leading-relaxed">
              <p className="font-medium text-foreground">Честный знак</p>
              <p className="mt-1">
                GTIN из карточки и группа ЧЗ. При приёмке скан проверяется через ЧЗ. Коды попадают в базу при
                сканировании на ТСД или в веб-приёмке.
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 p-2.5 text-xs leading-relaxed">
              <p className="font-medium text-foreground">Внутренняя WMS</p>
              <p className="mt-1">
                Для материалов без ЧЗ: GTIN с префиксом <span className="font-mono">90…</span>, DataMatrix генерируется
                в карточке номенклатуры. ТСД ищет код во внутренней базе, не в ЧЗ.
              </p>
            </div>
          </div>
        </section>

        <section>
          <p className="mb-1.5 font-medium text-foreground">Как пользоваться</p>
          <ol className="space-y-2 text-xs leading-relaxed">
            <li className="flex gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">1</span>
              <span>
                В номенклатуре включите <strong className="font-medium text-foreground">«Требуется маркировка»</strong>,
                укажите систему (<strong className="font-medium text-foreground">Честный знак</strong> или{" "}
                <strong className="font-medium text-foreground">Внутренняя</strong>), GTIN и при необходимости ТН ВЭД.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">2</span>
              <span>
                <strong className="font-medium text-foreground">ЧЗ:</strong> принимайте со сканом на{" "}
                <Link href="/receiving" className="text-primary underline-offset-2 hover:underline">
                  Приёмке
                </Link>
                . <strong className="font-medium text-foreground">Внутренние:</strong> после сохранения карточки нажмите
                «Сгенерировать» в блоке DataMatrix.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">3</span>
              <span className="inline-flex flex-wrap items-center gap-1">
                Ищите код на{" "}
                <Link
                  href="/warehouse-stock/finished-goods"
                  className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                >
                  <Search className="h-3 w-3" />
                  Склад ГП
                </Link>
                , в{" "}
                <Link href="/search" className="text-primary underline-offset-2 hover:underline">
                  Поиске
                </Link>{" "}
                (артикул/GTIN) или через{" "}
                <span className="inline-flex items-center gap-1">
                  <ScanLine className="h-3 w-3" />
                  мобильный скан
                </span>
                . В операциях — иконка{" "}
                <QrCode className="inline h-3.5 w-3.5 text-primary" aria-hidden /> при наведении показывает Data Matrix.
              </span>
            </li>
          </ol>
        </section>

        {!compact ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Иерархия палета → блок → бутылка и история событий кода — на{" "}
            <Link href="/warehouse-stock/finished-goods" className="text-primary underline-offset-2 hover:underline">
              Складе ГП
            </Link>
            . Масштаб хранения (сотни миллионов кодов) описан в документации проекта{" "}
            <span className="font-mono">docs/scale-storage.md</span>.
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
