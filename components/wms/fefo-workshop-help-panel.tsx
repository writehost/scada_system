"use client"

import Link from "next/link"
import { BookOpen, ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type Props = {
  className?: string
  defaultOpen?: boolean
}

export function FefoWorkshopHelpPanel({ className, defaultOpen = false }: Props) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("rounded-xl border bg-muted/20", className)}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/30">
        <span className="inline-flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          FEFO, выдача в цех и ячейки
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-4 py-3 text-sm text-muted-foreground">
        <div className="space-y-1">
          <p className="font-medium text-foreground">Как это работает</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground">Склад OS</span> — откуда берётся товар (FEFO выбирает партию с
              ближайшим сроком годности).
            </li>
            <li>
              <span className="text-foreground">Ячейка цеха</span> (A-1 … A-140) — куда попадает стикер после выдачи;
              остаток учитывается как «в цеху» (<span className="font-mono text-xs">in_production</span>).
            </li>
            <li>
              Ошибка «FEFO: сначала выдайте партию …» означает: на складе OS есть более ранняя партия этой же
              номенклатуры — её нужно выдать первой. Это правило действует на <strong>товар</strong>, а не блокирует
              другие пустые ячейки для другой номенклатуры.
            </li>
            <li>
              <span className="text-foreground">Точки ожидания</span> (профиль ячейки WAITING) — в одной ячейке только
              одна номенклатура, пока не освободите ячейку или не положите ту же позицию.
            </li>
          </ul>
        </div>

        <div className="space-y-1">
          <p className="font-medium text-foreground">Расход стикеров из ячейки цеха</p>
          <p>
            Чтобы «списать» то, что уже лежит в ячейке (перед новой выдачей или по факту линии), используйте расход в
            производство — API <span className="font-mono text-xs">POST /api/wms/production/consume</span> или экран
            производства в WMS. После расхода в ячейке уменьшается остаток «в цеху».
          </p>
        </div>

        <div className="space-y-1">
          <p className="font-medium text-foreground">Настройка FEFO (номенклатура)</p>
          <p>
            Откройте карточку товара → вкладка <span className="text-foreground">«Учёт»</span>:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground">FEFO</span> — строгий порядок по сроку годности при выдаче со склада OS.
            </li>
            <li>
              <span className="text-foreground">FIFO</span> — по дате поступления, без привязки к сроку.
            </li>
            <li>
              <span className="text-foreground">Контроль срока годности</span> — включает проверки срока при приёмке и
              выдаче.
            </li>
          </ul>
          <p>
            Чтобы <strong>отключить жёсткий FEFO</strong> для позиции: снимите галочку FEFO, включите FIFO, отключите
            «Скоропорт» при создании номенклатуры (<span className="font-mono text-xs">rotation_policy</span> станет{" "}
            <span className="font-mono text-xs">fifo</span> или <span className="font-mono text-xs">manual</span>).
          </p>
        </div>

        <div className="space-y-1">
          <p className="font-medium text-foreground">Настройка склада</p>
          <p>
            <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
              Настройки → Справочники → Склады
            </Link>
            : в карточке склада OS — блок «FEFO и сроки» (пороги предупреждений, блокировка просрочки).
          </p>
        </div>

        <div className="space-y-1">
          <p className="font-medium text-foreground">Профиль ячейки цеха</p>
          <p>
            <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
              Настройки → Справочники → Профиль ячейки
            </Link>
            : назначение <span className="font-mono text-xs">WAITING</span> для точек ожидания, группы товаров для
            стикеров. Обычные ячейки A-* в зоне LINE не ограничивают смешение номенклатуры на уровне FEFO.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">API: маршрут FEFO (склад OS)</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`GET /api/wms/stock/pos-pick?siteCode=DEFAULT&itemCode=SKU-001&qty=1`}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">API: выдача в ячейку цеха</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/issues
{
  "siteCode": "DEFAULT",
  "itemCode": "SKU-001",
  "sourceLocationCode": "OS-A-01-01",
  "targetLocationCode": "A-12",
  "qty": 1,
  "lotCode": "LOT-2026-04-01",
  "emissionAtIso": "2026-04-01T00:00:00.000Z",
  "recipientName": "Оператор",
  "codeValues": ["01..."]
}`}
          </pre>
          <p>
            Поля <span className="font-mono text-xs">lotCode</span> и{" "}
            <span className="font-mono text-xs">emissionAtIso</span> обязательны для номенклатуры с FEFO — их возвращает
            маршрут pos-pick.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">API: расход из ячейки цеха</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/production/consume
{
  "siteCode": "DEFAULT",
  "locationCode": "A-12",
  "itemCode": "SKU-001",
  "qty": 1
}`}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
