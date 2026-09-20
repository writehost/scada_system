"use client"

import { BookOpen, ChevronDown } from "lucide-react"
import Link from "next/link"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type Props = {
  className?: string
  defaultOpen?: boolean
}

export function FgWarehouseApiHelpPanel({ className, defaultOpen = false }: Props) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("rounded-xl border bg-muted/20", className)}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/30">
        <span className="inline-flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          API склада готовой продукции
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-4 py-3 text-sm text-muted-foreground">
        <p>
          Внешняя система (линия, MES, 1С) может оприходовать готовую продукцию на склад ГП и привязать коды
          маркировки к ячейке. Номенклатура должна иметь тип{" "}
          <span className="font-mono text-xs text-foreground">finished_goods</span>.
        </p>

        <div className="space-y-2">
          <p className="font-medium text-foreground">POST — оприходование ГП</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/warehouse/finished-goods/receipt
Content-Type: application/json

{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "siteCode": "DEFAULT",
  "externalId": "LINE2-PALLET-20260617-001",
  "sourceSystem": "mes-line-2",
  "itemCode": "VODKA-05",
  "locationCode": "A-1",
  "qty": 1200,
  "lotCode": "20260617-A",
  "manufacturedAt": "2026-06-17T08:00:00.000Z",
  "expiryAt": "2027-06-17T00:00:00.000Z",
  "markingCodes": [
    "01XXXXXXXXXXXXXX21YYYYYYYYYYYY"
  ]
}`}
          </pre>
          <p>
            <span className="font-mono text-xs text-foreground">requestId</span> — UUID для идемпотентности (повтор
            запроса вернёт тот же результат).{" "}
            <span className="font-mono text-xs text-foreground">markingCodes</span> — необязательный список DataMatrix /
            КМ; коды должны уже существовать в реестре маркировки.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">POST — несколько строк (batch)</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/warehouse/finished-goods/receipt

{
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "siteCode": "DEFAULT",
  "sourceSystem": "mes-line-2",
  "lines": [
    {
      "itemCode": "VODKA-05",
      "locationCode": "A-1",
      "qty": 1200,
      "markingCodes": ["01...21..."]
    },
    {
      "itemCode": "WATER-05",
      "locationCode": "B-12",
      "qty": 800
    }
  ]
}`}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">GET — чтение остатков (без изменений)</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`GET /api/wms/warehouse/finished-goods/summary?siteCode=DEFAULT
GET /api/wms/warehouse/finished-goods/nomenclature?siteCode=DEFAULT
GET /api/wms/warehouse/finished-goods/rows?siteCode=DEFAULT
GET /api/wms/warehouse/finished-goods/lookup?siteCode=DEFAULT&q=01...21...`}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">Ответ (успех)</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`{
  "disposition": "applied",
  "lines": [
    {
      "itemCode": "VODKA-05",
      "itemName": "Водка 0,5",
      "locationCode": "A-1",
      "qty": 1200,
      "balanceId": "12345",
      "lotId": "678",
      "linkedMarkingCodes": 1,
      "unknownMarkingCodes": []
    }
  ]
}`}
          </pre>
          <p>
            Если код маркировки не найден в БД, он попадёт в{" "}
            <span className="font-mono text-xs text-foreground">unknownMarkingCodes</span>, остаток всё равно
            оприходуется по <span className="font-mono text-xs text-foreground">qty</span>.
          </p>
        </div>

        <p>
          Полная OpenAPI-спецификация:{" "}
          <Link href="/api/wms/openapi" className="text-primary underline-offset-2 hover:underline">
            /api/wms/openapi
          </Link>
          . Идентификация ряда с телефона:{" "}
          <Link href="/help/row-identify-api" className="text-primary underline-offset-2 hover:underline">
            Swagger
          </Link>
          {" / "}
          <Link href="/api/wms/row-identify/openapi" className="text-primary underline-offset-2 hover:underline">
            JSON
          </Link>
          . Страница склада:{" "}
          <Link
            href="/warehouse-stock/finished-goods"
            className="text-primary underline-offset-2 hover:underline"
          >
            Склад ГП
          </Link>
          .
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
