"use client"

import { BookOpen, ChevronDown } from "lucide-react"
import Link from "next/link"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type Props = {
  className?: string
  defaultOpen?: boolean
}

export function RowIdentifyApiHelpPanel({ className, defaultOpen = false }: Props) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("rounded-xl border bg-muted/20", className)}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/30">
        <span className="inline-flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          API идентификации ряда (телефон и ТСД)
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-4 py-3 text-sm text-muted-foreground">
        <p>
          Сканируете SSCC паллеты или единичный КМ бутылки (у паллеты и блока времени печати нет).
          WMS раскрывает паллету до продукта, берёт интервал печати в Vekas,
          отбирает паллеты и пишет их в выбранный ряд на 2D-карте. На ТСД тот же сценарий: плитка
          «Ряд ГП» или Склад → «Идентификация ряда ГП».
        </p>

        <div className="space-y-2">
          <p className="font-medium text-foreground">1. Токен</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/row-identify/token
Content-Type: application/json

{
  "siteCode": "DEFAULT",
  "rowId": "A-33",
  "login": "admin",
  "password": "secret"
}`}
          </pre>
          <p>
            В ответе: <span className="font-mono text-xs text-foreground">token</span>,{" "}
            <span className="font-mono text-xs text-foreground">mapUrl</span> (открыть карту),{" "}
            <span className="font-mono text-xs text-foreground">openapiUrl</span>. Дальше во все методы:
          </p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`Authorization: Bearer <token>`}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">2. Сессия и два скана</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/row-identify/sessions
{ "siteCode": "DEFAULT", "rowId": "A-33" }

POST /api/wms/row-identify/sessions/{id}/scan
{ "role": "start", "code": "01...21..." }

POST /api/wms/row-identify/sessions/{id}/scan
{ "role": "end", "code": "01...21..." }`}
          </pre>
          <p>
            После второго скана в сессии уже есть <span className="font-mono text-xs text-foreground">rangeFrom</span> /{" "}
            <span className="font-mono text-xs text-foreground">rangeTo</span>, список кодов и паллет. Криптохвост и
            запятые в коде не вырезать.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">3. Запись паллет в ряд</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/row-identify/sessions/{id}/apply
{ "rowId": "A-33" }`}
          </pre>
        </div>

        <p>
          Swagger:{" "}
          <Link href="/help/row-identify-api" className="text-primary underline-offset-2 hover:underline">
            /help/row-identify-api
          </Link>
          . JSON:{" "}
          <Link href="/api/wms/row-identify/openapi" className="text-primary underline-offset-2 hover:underline">
            /api/wms/row-identify/openapi
          </Link>
          .
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
