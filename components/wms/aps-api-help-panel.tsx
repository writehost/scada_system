"use client"

import { BookOpen, ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type Props = {
  className?: string
  defaultOpen?: boolean
}

export function ApsApiHelpPanel({ className, defaultOpen = false }: Props) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("rounded-xl border bg-muted/20", className)}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/30">
        <span className="inline-flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          Справка APS и API плана
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-4 py-3 text-sm text-muted-foreground">
        <div className="space-y-1">
          <p className="font-medium text-foreground">На экране</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Клик по полоске — выбор заказа.</li>
            <li>Двойной клик — MRP и материалы.</li>
            <li>Перетащите полоску или используйте «-1 день» / «+1 день».</li>
            <li>Переключатель «Месяц / День»: в дне сетка по часам, клик по числу в месяце открывает этот день.</li>
            <li>«Сделать предыдущим» → выберите следующий план — появится стрелка зависимости.</li>
            <li>События линии: выберите план → «Мойка после» или «Профилактика после» — маркер встанет на выбранный день между заказами.</li>
          </ul>
        </div>

        <div className="space-y-1">
          <p className="font-medium text-foreground">Партии с линии (Векас)</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Опрос Скит и Славда: партии со статусом «В процессе» (InProccess).</li>
            <li>Если заказа в APS ещё нет — он создаётся с номером партии. Количество пока неизвестно.</li>
            <li>Каждые ~30 минут проверяем статус. Когда партия станет «На складе» — пишем число валидированных кодов и снимаем с опроса.</li>
            <li>Кнопка «С линии (Векас)» на календаре запускает тот же цикл вручную.</li>
            <li>Живой список партий спрятан за «Информация о партиях с линии».</li>
          </ul>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/production/plans/sync-vekas
{ "siteCode": "DEFAULT" }

GET /api/wms/production/plans/sync-vekas?siteCode=DEFAULT&state=watching`}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">API: список планов</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`GET /api/wms/production/plans?siteCode=DEFAULT&from=2026-06-01&to=2026-06-30&includeLinks=1`}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">API: обновить выполнение (внешняя система)</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/production/plans/progress
Content-Type: application/json

{
  "siteCode": "DEFAULT",
  "planCode": "PLN-20260617-001",
  "percent": 75,
  "doneQty": 75,
  "source": "mes-line-2"
}`}
          </pre>
          <p>
            <span className="font-mono text-xs text-foreground">percent</span> — от 0 до 100. При &gt; 0 статус станет{" "}
            <span className="font-mono text-xs">in_progress</span>, при 100 — <span className="font-mono text-xs">done</span>.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">API: сдвинуть даты</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/production/plans/update
{
  "siteCode": "DEFAULT",
  "planCode": "PLN-20260617-001",
  "planDate": "2026-06-20",
  "planDateTo": "2026-06-22",
  "syncCalendar": true
}`}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">API: зависимость «после этого»</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/production/plans/links
{
  "siteCode": "DEFAULT",
  "sourcePlanId": "7",
  "targetPlanId": "12",
  "type": "e2s",
  "lagDays": 0
}`}
          </pre>
        </div>
        <div className="space-y-2">
          <p className="font-medium text-foreground">API: событие линии (мойка / профилактика)</p>
          <pre className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs text-foreground">
{`POST /api/wms/calendar/events
{
  "siteCode": "DEFAULT",
  "typeCode": "aps_line_wash",
  "title": "Мойка линии",
  "startAt": "2026-06-17T06:00:00.000Z",
  "allDay": true,
  "refs": {
    "workshopCode": "LINE",
    "shiftCode": "1",
    "afterPlanId": "7"
  }
}`}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
