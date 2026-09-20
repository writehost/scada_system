"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  Download,
  FileText,
  KeyRound,
  Layers,
  Library,
  Map,
  Package,
  ScanLine,
  Search,
  Smartphone,
  Truck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { QrCodeSvg } from "@/components/wms/qr-code-svg"
import { cn } from "@/lib/utils"
import {
  WAREHOUSE_OPS_CATALOG,
  warehouseOpsStatusLabel,
  type WarehouseOpsStatus,
} from "@/lib/wms/warehouse-ops"

const TSD_APK_DOWNLOAD_URL = "https://wms.scada25.ru/packages/app-release.apk"

type HelpCategory = "all" | "warehouse" | "terms" | "tsd" | "production" | "marking" | "dev"

const CATEGORIES: Array<{ id: HelpCategory; label: string }> = [
  { id: "all", label: "Все" },
  { id: "warehouse", label: "Склад" },
  { id: "terms", label: "Термины" },
  { id: "tsd", label: "ТСД" },
  { id: "production", label: "Производство" },
  { id: "marking", label: "Маркировка" },
  { id: "dev", label: "Разработчикам" },
]

type HelpTopic = {
  id: string
  category: Exclude<HelpCategory, "all">
  title: string
  summary: string
  icon: typeof Package
  keywords: string
  body: ReactNode
}

function Topic({
  topic,
  open,
  onOpenChange,
}: {
  topic: HelpTopic
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const Icon = topic.icon
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        id={topic.id}
        className={cn(
          "scroll-mt-24 rounded-2xl border bg-card shadow-sm",
          open ? "border-primary/30" : "border-border/70"
        )}
      >
        <CollapsibleTrigger className="flex w-full items-start gap-3 px-4 py-3.5 text-left">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">{topic.title}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{topic.summary}</div>
          </div>
          <ChevronDown
            className={cn(
              "mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
          <div className="space-y-3 pl-0 sm:pl-[3.25rem]">{topic.body}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function WarehouseOpsCatalog() {
  const [status, setStatus] = useState<"all" | WarehouseOpsStatus>("all")
  const rows =
    status === "all" ? WAREHOUSE_OPS_CATALOG : WAREHOUSE_OPS_CATALOG.filter((row) => row.status === status)
  const counts = {
    live: WAREHOUSE_OPS_CATALOG.filter((row) => row.status === "live").length,
    partial: WAREHOUSE_OPS_CATALOG.filter((row) => row.status === "partial").length,
    planned: WAREHOUSE_OPS_CATALOG.filter((row) => row.status === "planned").length,
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", `Все ${WAREHOUSE_OPS_CATALOG.length}`],
            ["live", `Работает ${counts.live}`],
            ["partial", `Частично ${counts.partial}`],
            ["planned", `План ${counts.planned}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStatus(id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              status === id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[36rem] text-left text-xs">
          <thead className="bg-muted/50 text-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Метод</th>
              <th className="px-2 py-1.5 font-medium">Где</th>
              <th className="px-2 py-1.5 font-medium">Смысл</th>
              <th className="px-2 py-1.5 font-medium">В этой WMS</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {rows.map((row) => (
              <tr key={row.id} className="border-t" id={row.id}>
                <td className="px-2 py-1.5 text-foreground">
                  {row.title}
                  <div className="text-[10px] text-muted-foreground">{warehouseOpsStatusLabel(row.status)}</div>
                </td>
                <td className="px-2 py-1.5">
                  {row.applies === "both" ? "ГП + мат." : row.applies === "fg" ? "ГП" : "Материалы"}
                </td>
                <td className="px-2 py-1.5">{row.meaning}</td>
                <td className="px-2 py-1.5">{row.inWms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const TOPICS: HelpTopic[] = [
  {
    id: "tsd-connect",
    category: "tsd",
    title: "Подключить терминал по коду",
    summary: "Логин и пароль на ТСД больше не нужны — кладовщик выпускает код, терминал его вводит.",
    icon: KeyRound,
    keywords: "тсд терминал токен код qr подключение enroll android",
    body: (
      <>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            В веб-интерфейсе откройте{" "}
            <Link href="/terminals" className="text-primary underline-offset-2 hover:underline">
              Терминалы
            </Link>{" "}
            → «Подключить терминал».
          </li>
          <li>Выпустите код. Он живёт минуты и обычно на одно устройство. Можно показать QR.</li>
          <li>
            На ТСД: «Настройки» → «Сервер» → «Подключить по коду». Отсканируйте QR или введите код руками —
            регистр и дефисы не важны. Можно вставить уже выданный токен <span className="font-mono">wmsd_…</span>.
          </li>
          <li>Терминал получит свой токен. Если токен отозвать в карточке устройства — ТСД попросит новый код.</li>
        </ol>
        <p>
          Режим проверки: мягкий (старые ТСД ещё работают) или строгий (без токена не пускает). Переключается в том
          же диалоге, вкладка «Безопасность».
        </p>
      </>
    ),
  },
  {
    id: "tsd-apk",
    category: "tsd",
    title: "Приложение ТСД на Android",
    summary: "Скачать APK по кнопке или QR с телефона.",
    icon: Smartphone,
    keywords: "apk android приложение скачать ota обновление qr",
    body: (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="rounded-xl border border-border bg-white p-2">
          <QrCodeSvg value={TSD_APK_DOWNLOAD_URL} size={168} label="QR для скачивания APK ТСД" />
        </div>
        <div className="space-y-3">
          <p>
            Наведите камеру на QR — откроется файл установки. Если Android пишет «приложение не
            установлено», удалите старый WMS с телефона и поставьте этот файл снова.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="rounded-xl">
              <a href={TSD_APK_DOWNLOAD_URL} download target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Скачать APK
              </a>
            </Button>
            <Button asChild variant="outline" className="rounded-xl">
              <Link href="/mobile/sync">Открыть настройку терминала</Link>
            </Button>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "scan",
    category: "warehouse",
    title: "Сканирование",
    summary: "Камера, ручной ввод и маркировка СКИТ на телефоне.",
    icon: ScanLine,
    keywords: "скан штрихкод qr datamatrix скит камера",
    body: (
      <>
        <p>
          Раздел «Скан» на телефоне читает QR, Data Matrix и линейные штрихкоды. Строку можно ввести руками — так
          же подходит маркировка СКИТ: поля через <span className="font-mono text-xs">$</span>, внутри поля{" "}
          <span className="font-mono text-xs">ключ=значение</span>. Первое поле часто{" "}
          <span className="font-mono text-xs">type=item|loc|pallet|lot</span>.
        </p>
        <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] text-foreground">
          type=item$org=SK$wh=WHM1$loc=A03-S02-B04$gtin=04607138960662$qty=24$lot=L240430
        </pre>
      </>
    ),
  },
  {
    id: "fefo",
    category: "warehouse",
    title: "FEFO и выдача в цех",
    summary: "Почему блокируется выдача и как расходовать стикеры из ячейки.",
    icon: Layers,
    keywords: "fefo fifo срок годности выдача цех ячейка os waiting lot batch serial партия",
    body: (
      <>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">Склад OS</span> — откуда берётся товар. FEFO выбирает партию с
            ближайшим сроком.
          </li>
          <li>
            <span className="text-foreground">Ячейка цеха</span> (A-1 … A-140) — куда попадает стикер после выдачи.
            Остаток учитывается как «в цеху».
          </li>
          <li>
            Сообщение «FEFO: сначала выдайте партию …» значит: на OS есть более ранняя партия этой же номенклатуры.
            Правило про товар, а не про чужие пустые ячейки.
          </li>
          <li>
            Точки ожидания (профиль WAITING): в одной ячейке одна номенклатура, пока не освободите её или не
            положите ту же позицию.
          </li>
        </ul>
        <p>
          Чтобы списать то, что уже в ячейке цеха, используйте расход в производство на экране производства. FEFO
          для конкретной позиции: карточка товара → вкладка «Учёт». Склад OS: Настройки → Справочники → Склады.
        </p>
        <p>
          На{" "}
          <Link href="/warehouse-stock/materials?view=issue" className="text-primary underline-offset-2 hover:underline">
            складе материалов
          </Link>{" "}
          те же истекающие стикеры видны фильтром «В производство»: не держать их на полке, пока в цех уходит свежая
          партия.
        </p>
      </>
    ),
  },
  {
    id: "material-warehouse",
    category: "warehouse",
    title: "Склад материалов: что уже считает WMS",
    summary: "Совместимость, партии, FEFO/FIFO, качество, выдача в цех. Не путать со слоттингом ГП.",
    icon: Package,
    keywords:
      "склад материалов compatibility fefo fifo quality lot vendor batch kanban milk run kitting backflush line-side uom return to stock partial hu",
    body: (
      <>
        <p>
          Склад ГП отвечает, куда поставить палету воды. Склад материалов — что можно класть рядом, какую партию
          выдавать в цех и не просрочить этикетку. Методы из учебника WMS здесь не все сразу: живые только те, для
          которых на заводе уже есть данные.
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className="bg-muted/50 text-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Метод</th>
                <th className="px-2 py-1.5 font-medium">Зачем на материалах</th>
                <th className="px-2 py-1.5 font-medium">В этой WMS</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Compatibility</td>
                <td className="px-2 py-1.5">Химия / пищевые / этикетки / пыль не в одной ячейке</td>
                <td className="px-2 py-1.5">Работает: семейство в профиле (ХИМ, ЭТК, УПК…). Матрица запретов есть.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Lot / batch</td>
                <td className="px-2 py-1.5">Откуда партия, где лежит, куда выдана</td>
                <td className="px-2 py-1.5">Работает: внутренняя партия + ячейка FEFO на складе материалов.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Vendor / internal batch</td>
                <td className="px-2 py-1.5">Партия поставщика и наша</td>
                <td className="px-2 py-1.5">Работает: lot_code и партия поставщика (supplier_lot / batch_label).</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">FEFO</td>
                <td className="px-2 py-1.5">Клей, этикетка, химия — сначала истекающее</td>
                <td className="px-2 py-1.5">Работает: выдача в цех + фильтр «В производство».</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">FIFO</td>
                <td className="px-2 py-1.5">Без срока — старый приход раньше нового</td>
                <td className="px-2 py-1.5">Работает: профиль FIFO, если срока нет.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Quality status</td>
                <td className="px-2 py-1.5">RELEASED / QUARANTINE / HOLD / REJECTED</td>
                <td className="px-2 py-1.5">Работает. Брак и карантин в производство не предлагаем.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Consumption by order</td>
                <td className="px-2 py-1.5">Выдача под производственный заказ</td>
                <td className="px-2 py-1.5">Живое в цехе: расход с ячейки и план линии. Не «просто со склада».</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Line-side</td>
                <td className="px-2 py-1.5">Ячейки у линии, не ездить на OS за мелочью</td>
                <td className="px-2 py-1.5">Работает: ячейки цеха A-1…A-140 и точки ожидания.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Return to stock</td>
                <td className="px-2 py-1.5">Остаток с линии назад с партией и статусом</td>
                <td className="px-2 py-1.5">Работает: возврат из ячейки цеха.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">UOM</td>
                <td className="px-2 py-1.5">Штуки / короба / кг / рулоны / палеты</td>
                <td className="px-2 py-1.5">Базовая ЕИ на остатке. Пересчёт уровней — на карточке.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Backflush</td>
                <td className="px-2 py-1.5">10 000 бутылок → списать преформы и этикетки</td>
                <td className="px-2 py-1.5">Планируется. Сейчас расход руками или с линии по факту.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Kanban / min-max</td>
                <td className="px-2 py-1.5">Мало у линии → сигнал пополнить с OS</td>
                <td className="px-2 py-1.5">
                  Работает фильтр и колонка «Политика». Задание на пополнение — следующий шаг.{" "}
                  <a href="#kanban-supermarket" className="text-primary underline-offset-2 hover:underline">
                    Как читать
                  </a>
                  .
                </td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Milk run</td>
                <td className="px-2 py-1.5">Регулярный подвоз к линиям</td>
                <td className="px-2 py-1.5">Планируется — нет расписания маршрута.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Kitting</td>
                <td className="px-2 py-1.5">Комплект под смену / заказ</td>
                <td className="px-2 py-1.5">Планируется.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Partial HU</td>
                <td className="px-2 py-1.5">Неполная коробка, рулон, мешок</td>
                <td className="px-2 py-1.5">Планируется как отдельный тип ЕИ. Сейчас остаток в базовой ЕИ.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Главный заводской кейс: этикетка со сроком на исходе. Фильтр{" "}
          <Link href="/warehouse-stock/materials?view=issue" className="text-primary underline-offset-2 hover:underline">
            В производство
          </Link>{" "}
          и кнопка «В цех». Подробнее:{" "}
          <a href="#material-fefo" className="text-primary underline-offset-2 hover:underline">
            FEFO материалов
          </a>
          ,{" "}
          <a href="#quality-status" className="text-primary underline-offset-2 hover:underline">
            качество
          </a>
          ,{" "}
          <a href="#compatibility" className="text-primary underline-offset-2 hover:underline">
            совместимость
          </a>
          ,{" "}
          <a href="#material-lot" className="text-primary underline-offset-2 hover:underline">
            партии
          </a>
          ,{" "}
          <a href="#stock-policy" className="text-primary underline-offset-2 hover:underline">
            min/max
          </a>
          ,{" "}
          <a href="#dead-aging" className="text-primary underline-offset-2 hover:underline">
            dead stock
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "material-fefo",
    category: "warehouse",
    title: "FEFO материалов: этикетку со сроком — в линию",
    summary: "Не держать старый рулон на OS, пока в цех уходит свежая партия.",
    icon: CalendarRange,
    keywords: "material fefo fifo стикер этикетка клей химия срок годности производство очередь",
    body: (
      <>
        <p>
          У готовой воды FEFO нужен, чтобы в магазин не уехала почти просроченная палета. У материалов — чтобы клей и
          этикетка не умерли на полке, пока линия крутит новую поставку.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">Есть срок</span> (стикер, клей, химия) — политика FEFO. Сначала партия с
            ближайшим expiry / эмиссией.
          </li>
          <li>
            <span className="text-foreground">Нет срока</span> (преформа, картон) — FIFO: старый приход раньше нового.
          </li>
          <li>
            Красная зона стикера: 350 дней с эмиссии. Такие строки на складе материалов подсвечиваются и попадают в
            «В производство».
          </li>
        </ul>
        <p>
          Выдача с OS в ячейку цеха уже блокируется, если на OS лежит более ранняя партия. Склад материалов теперь
          показывает ту же очередь до того, как кладовщик взял ТСД.
        </p>
      </>
    ),
  },
  {
    id: "quality-status",
    category: "terms",
    title: "Quality status: допущен, карантин, удержан, брак",
    summary: "RELEASED можно в цех. QUARANTINE / HOLD / REJECTED — нет.",
    icon: Layers,
    keywords: "quality status released quarantine hold rejected карантин брак отк партия",
    body: (
      <>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">RELEASED</span> — допущен. Можно выдавать и класть в обычную ячейку.
          </li>
          <li>
            <span className="text-foreground">QUARANTINE</span> — карантин или заблокированная партия. Не в линию.
          </li>
          <li>
            <span className="text-foreground">HOLD</span> — ОТК ещё не закрыл проверку.
          </li>
          <li>
            <span className="text-foreground">REJECTED</span> — брак. Списание или возврат поставщику.
          </li>
        </ul>
        <p>
          Статус считается по остаткам карантина/брака и по <span className="font-mono text-xs">qa_status</span> партии.
          На складе материалов колонка «Статус». Кнопка «В цех» только у допущенного.
        </p>
      </>
    ),
  },
  {
    id: "compatibility",
    category: "terms",
    title: "Совместимость материалов",
    summary: "Химия отдельно, пищевые отдельно, этикетки отдельно, пыль не к электронике.",
    icon: Layers,
    keywords: "compatibility совместимость химия пищевые электроника пахучие пылящие этикетки",
    body: (
      <>
        <p>
          Семейство считается по названию и типу. Профиль на складе материалов выглядит как{" "}
          <span className="font-mono text-foreground">S1 · FEFO · ЭТК</span>.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Химия не рядом с пищевыми, этикетками и электроникой.</li>
          <li>Пахучие не рядом с пищевыми и этикетками.</li>
          <li>Пылящие не рядом с электроникой и открытыми этикетками.</li>
        </ul>
        <p>
          Это не класс S1–S5. S1 говорит «мелкоштучный», семейство — «не класть клей на ту же полку, что сахар».
          Жёсткая блокировка putaway по матрице — следующий шаг; сейчас семейство видно оператору.
        </p>
      </>
    ),
  },
  {
    id: "material-lot",
    category: "terms",
    title: "Внутренняя партия и партия поставщика",
    summary: "lot_code — наша. batch_label — то, что написал поставщик на коробе.",
    icon: Layers,
    keywords: "vendor batch internal batch lot_code batch_label партия поставщика прослеживаемость",
    body: (
      <>
        <p>
          Одна поставка клея может иметь номер завода-изготовителя и наш номер после приёмки. Оба нужны: претензия
          поставщику идёт по его партии, движение по складу — по нашей.
        </p>
        <p>
          На складе материалов колонка «Партия»: внутренняя сверху, «пост.» — vendor batch, ниже ячейка, откуда FEFO
          предлагает взять. История «куда выдали» — движения и ячейка цеха.
        </p>
      </>
    ),
  },
  {
    id: "warehouse-ops",
    category: "terms",
    title: "Методы ГП и материалов: супермаркет, Kanban, min/max, dead stock",
    summary: "Каталог методов. В колонке «Работает» только то, что считает живой остаток, партия или движение.",
    icon: Library,
    keywords:
      "supermarket two-bin kanban min max safety reorder lead time dock putaway directed zone wave batch pick path dead stock aging obsolescence accuracy shrinkage damage quarantine sampling coa genealogy recall hu nested catch weight roll bulk hazmat temperature esd consignment reservation allocation shortage substitution starvation call-off milk run tugger interleaving dock-to-stock heatmap congestion slotting reslot",
    body: (
      <>
        <p>
          Если на карточке нет min/max, порог считается по расходу за 90 дней. Приёмка не снимает признак dead stock.
          Методы без контура учёта (силосы, возвратная тара, владелец на партии) остаются в статусе «План».
        </p>
        <p>
          Фильтры:{" "}
          <Link href="/warehouse-stock/materials?view=min" className="text-primary underline-offset-2 hover:underline">
            склад материалов
          </Link>{" "}
          — чипы Min / max, Kanban, Dead, Возраст;{" "}
          <Link href="/warehouse-stock/finished-goods" className="text-primary underline-offset-2 hover:underline">
            склад ГП
          </Link>{" "}
          — селектор «Методы». Разбор:{" "}
          <a href="#stock-policy" className="text-primary underline-offset-2 hover:underline">
            политика запаса
          </a>
          ,{" "}
          <a href="#kanban-supermarket" className="text-primary underline-offset-2 hover:underline">
            Kanban
          </a>
          ,{" "}
          <a href="#warehouse-ops-inbox" className="text-primary underline-offset-2 hover:underline">
            очередь методов
          </a>
          ,{" "}
          <a href="#dead-aging" className="text-primary underline-offset-2 hover:underline">
            возраст
          </a>
          .
        </p>
        <WarehouseOpsCatalog />
      </>
    ),
  },
  {
    id: "warehouse-ops-inbox",
    category: "warehouse",
    title: "Очередь методов: Kanban, milk run, тягач, волны, FEFO",
    summary: "Экран «Методы склада»: сигнал пополнения превращается в документ и задание ТСД.",
    icon: Package,
    keywords:
      "очередь методов kanban e-kanban milk run tugger тягач волна wave fefo exception replenish shrinkage heatmap dock-to-stock пополнение линия",
    body: (
      <>
        <p>
          Экран{" "}
          <Link href="/warehouse-stock/ops" className="text-primary underline-offset-2 hover:underline">
            Методы склада
          </Link>{" "}
          — рабочая очередь, не справочник. Слева сигналы пополнения линии, справа открытый отбор, ниже журнал и
          показатели. Как появляется сигнал Kanban — в теме{" "}
          <a href="#kanban-supermarket" className="text-primary underline-offset-2 hover:underline">
            e-Kanban
          </a>
          .
        </p>

        <h3 className="text-sm font-medium text-foreground">Пополнение одного артикула</h3>
        <p>
          Кнопка «Задание» создаёт документ типа <span className="font-mono text-xs">replenishment</span> и одно
          открытое задание в очереди ТСД: склад материалов OS → пустая ячейка цеха <span className="font-mono text-xs">A-*</span>.
          Источник — ячейка FEFO на OS. Приёмник — своя пустая ячейка, не общая на весь рейс.
        </p>
        <p>
          Количество в задании — сигнал кладовщику, не вывоз доли склада. Берётся 15&nbsp;% доступного остатка, но не
          больше 200 единиц. На документе количество можно изменить перед выполнением.
        </p>

        <h3 className="text-sm font-medium text-foreground">Рейс к линии и тягач</h3>
        <p>
          «Рейс к линии» собирает все текущие сигналы в один документ: несколько строк, у каждой своя остановка.
          «Тягач» строит тот же документ и раскладывает остановки по петлям цеха по 20 ячеек: T1 = A-1…A-20, T2 =
          A-21…A-40, до A-140. В задании пишутся петля и порядок объезда. Склад-приёмник — тот, где стоит ячейка
          (на заводе это «Цех №2», не пустой справочник LINE).
        </p>

        <h3 className="text-sm font-medium text-foreground">Волны отбора</h3>
        <p>
          «Собрать волну» записывает идентификатор волны в payload открытых заданий pick, ship, replenishment и
          issue_to_line. Это группировка уже существующих заданий, новые строки отбора не создаются.
        </p>

        <h3 className="text-sm font-medium text-foreground">Исключение FEFO</h3>
        <p>
          Запись в журнал: артикул, партия и причина не короче трёх символов. Блок выдачи более ранней партии при этом
          не снимается. Без причины строка не сохраняется.
        </p>

        <h3 className="text-sm font-medium text-foreground">Показатели на том же экране</h3>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Списания за 180 дней и бой — только если в движениях есть writeoff или revision_adjustment.</li>
          <li>Accuracy — доля расхождений ревизии к остатку. Пока ревизий не было, поле пустое, не 100&nbsp;%.</li>
          <li>Dock-to-stock — средние часы от receiving до первого putaway или transfer.</li>
          <li>Тепло ячеек — число движений за 30 дней (ячейка to, иначе from).</li>
          <li>Календарь — события площадки за 180 дней: план выпуска, мойка, дефицит.</li>
          <li>Поставщики — число документов приёмки. Балл качества не считаем: списание к поставщику не привязано.</li>
          <li>Расход партий — issue и production_consume за 180 дней.</li>
        </ul>
      </>
    ),
  },
  {
    id: "stock-policy",
    category: "terms",
    title: "Min / max, точка заказа, страховой, срок поставки",
    summary: "Политика запаса с карточки. Если поля пустые — WMS считает пороги по расходу за 90 дней.",
    icon: Layers,
    keywords: "min max target safety reorder lead time точка заказа страховой срок поставки политика запаса",
    body: (
      <>
        <p>
          На карточке, вкладка «Склад»: минимум, максимум, цель, точка заказа, страховой, срок поставки в днях. Оба
          склада сравнивают с остатком (материалы: доступно + в цеху; ГП: бутылки на складе / плане).
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">Ниже min / страховой / точка заказа</span> — фильтр «Min / заказ» на
            материалах и «Методы» на ГП.
          </li>
          <li>
            <span className="text-foreground">Выше max</span> — перезапас, видно в колонке «Политика» (~ если порог
            посчитан).
          </li>
          <li>
            <span className="text-foreground">Пустая карточка</span> — не «метод выключен». Берём расход (выдача,
            consume, отбор, отгрузка) за 90 дней: страховой ≈ 3 дня, min ≈ неделя, точка заказа = расход за срок
            поставки + страховой, цель ≈ 21 день, max ≈ 45 дней. Срок поставки по умолчанию 14 дней.
          </li>
        </ul>
        <p>
          Тильда «~» в политике = порог не с карточки, а из расхода. Запишите свои числа — они важнее расчёта.
        </p>
      </>
    ),
  },
  {
    id: "kanban-supermarket",
    category: "warehouse",
    title: "e-Kanban, супермаркет и two-bin",
    summary: "Линия держит запас у ячеек A-*. Когда его мало, WMS поднимает сигнал пополнить с OS.",
    icon: Package,
    keywords:
      "supermarket two-bin e-kanban kanban call-off starvation line-side пополнение линия супермаркет карточка min milk run тягач",
    body: (
      <>
        <p>
          На Скеэте канбан — это не карточка на ящике и не отдельный справочник. WMS сравнивает остаток у линии с
          порогом и остатком на складе материалов. Если линия просит пополнение, а на OS ещё есть — позиция попадает в
          фильтр Kanban и в{" "}
          <Link href="/warehouse-stock/ops" className="text-primary underline-offset-2 hover:underline">
            очередь методов
          </Link>
          .
        </p>

        <h3 className="text-sm font-medium text-foreground">Три связанных метода</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Метод</th>
                <th className="py-1.5 font-medium">Что означает на заводе</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              <tr className="border-t">
                <td className="py-1.5 pr-3 align-top">Супермаркет</td>
                <td className="py-1.5">
                  Есть остаток «в производстве» — в ячейках цеха A-1…A-140 (склад «Цех №2»). Основной склад OS не
                  отпускает каждую коробку на линию: сначала наполняется эта зона.
                </td>
              </tr>
              <tr className="border-t">
                <td className="py-1.5 pr-3 align-top">Two-bin</td>
                <td className="py-1.5">
                  Один артикул лежит в двух и более ячейках. Пустая тара — сигнал: вторую оставляют в работе, первую
                  везут пополнить.
                </td>
              </tr>
              <tr className="border-t">
                <td className="py-1.5 pr-3 align-top">e-Kanban</td>
                <td className="py-1.5">
                  Электронный сигнал. Срабатывает, если на OS ещё есть запас и выполняется одно из условий: у линии
                  меньше минимума либо линия пустая, но по артикулу уже был расход (выдача, consume, отбор, отгрузка).
                </td>
              </tr>
              <tr className="border-t">
                <td className="py-1.5 pr-3 align-top">Starvation</td>
                <td className="py-1.5">
                  Частный случай канбана: линия пустая, расход идёт. В очереди методов причина «Линия пустая» — риск,
                  что линия встанет.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-sm font-medium text-foreground">Откуда берётся минимум</h3>
        <p>
          Порог — поле min на карточке (вкладка «Склад»). Если поле пустое, WMS считает минимум по расходу за 90 дней:
          примерно неделя потребления, срок поставки по умолчанию 14 дней. Тильда «~» в колонке политики означает
          расчётный порог. Записанное на карточке число важнее расчёта. Подробнее —{" "}
          <a href="#stock-policy" className="text-primary underline-offset-2 hover:underline">
            политика запаса
          </a>
          .
        </p>

        <h3 className="text-sm font-medium text-foreground">Как работать</h3>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Откройте{" "}
            <Link href="/warehouse-stock/materials?view=kanban" className="text-primary underline-offset-2 hover:underline">
              склад материалов → Kanban
            </Link>
            . Здесь только позиции с сигналом.
          </li>
          <li>
            Перейдите в{" "}
            <Link href="/warehouse-stock/ops" className="text-primary underline-offset-2 hover:underline">
              Методы склада
            </Link>
            . Для одного артикула нажмите «Задание». Для всего списка — «Рейс к линии» или «Тягач».
          </li>
          <li>
            На ТСД закройте задание replenishment: взять с ячейки FEFO на OS, положить в указанную A-*. Количество на
            задании можно скорректировать.
          </li>
        </ol>
        <p>
          Call-off — это обычная выдача в цех с OS. Автоматического вызова материала из APS нет: сигнал поднимает
          кладовщик кнопкой, а не план линии.
        </p>

        <h3 className="text-sm font-medium text-foreground">Когда список пустой</h3>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>У линии не меньше минимума, расход с OS не идёт — сигнала нет, очередь чистая.</li>
          <li>На OS нет доступного остатка — пополнять нечем, строка в очередь не попадает.</li>
          <li>
            В цеху ноль по всем SKU — супермаркет пуст. Канбан тогда смотрит расход с OS и порог. Это штатное
            состояние, а не ошибка экрана.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "dead-aging",
    category: "warehouse",
    title: "Dead stock, возраст партии и риск устаревания",
    summary: "Лежит без расхода, сколько дней с прихода, не просрочится ли на полке.",
    icon: CalendarRange,
    keywords: "dead stock aging obsolescence возраст залежалый устаревание без движения",
    body: (
      <>
        <p>
          Dead stock — остаток есть, а расхода нет за 90 дней (выдача, consume, отбор, отгрузка). Приёмка и ревизия
          сюда не входят: иначе свежий приход «оживлял» бы то, что никто не берёт.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">Возраст</span> — дни с прихода партии или эмиссии: свежий / стареет /
            старый (90+) / залежалый (180+).
          </li>
          <li>
            <span className="text-foreground">Устаревание</span> — dead stock + близкий срок или возраст. Этикетку с
            высоким риском запускайте в линию.
          </li>
          <li>
            На ГП FSN = N тоже помечает dead stock. Фильтры: материалы — Dead stock / Возраст; ГП — «Методы».
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "nomenclature-classes",
    category: "warehouse",
    title: "Номенклатура, группы и классы S1–S5",
    summary: "Группа из 1С — одно, класс хранения считается сам. Картон и плёнка — сырьё.",
    icon: Layers,
    keywords: "номенклатура группа класс s1 s2 s3 s4 s5 сырьё картон плёнка стикер вода справочник",
    body: (
      <>
        <p>
          В{" "}
          <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
            Настройки → Справочники
          </Link>{" "}
          группы товаров берутся из 1С («Вода», «Стикеры Скит», «Картон»). Это не класс хранения.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">S1 мелкоштучный</span> — стикеры, этикетки, крепёж, скотч.
          </li>
          <li>
            <span className="text-foreground">S2 средний тарный</span> — средний груз, который сам не сырьё линии.
            Картон и плёнка сюда не входят.
          </li>
          <li>
            <span className="text-foreground">S3 сырьё</span> — преформа, мешки, клей, картон, плёнка, короба.
          </li>
          <li>
            <span className="text-foreground">S4 палетный / ГП</span> — готовая вода и напитки на палете.
          </li>
          <li>
            <span className="text-foreground">S5 карантин</span> — брак и карантин.
          </li>
        </ul>
        <p>
          Класс на карточке не выбирают вручную. Оборачиваемость ABC и FSN — отдельно, это не S1–S5.
        </p>
      </>
    ),
  },
  {
    id: "fsn",
    category: "warehouse",
    title: "FSN: быстрый, средний, редкий",
    summary: "Считается по движениям за 30/60/90 дней. F ближе к отбору, N — дальше.",
    icon: Layers,
    keywords: "fsn fast slow non-moving оборачиваемость слоттинг ячейка ряд отгрузка 30 60 90",
    body: (
      <>
        <p>
          FSN — скорость, с которой товар ходит по складу. Это не класс хранения S1–S5 и не ABC из 1С. На складе
          ГП система считает его сама по истории движений.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">F — Fast</span> — часто отгружают. Ставим ближе к воротам и отбору,
            чтобы кар меньше ездил.
          </li>
          <li>
            <span className="text-foreground">S — Slow</span> — двигается, но не каждый день. Средние ряды.
          </li>
          <li>
            <span className="text-foreground">N — Non-moving</span> — за период почти не двигался. Дальше, чтобы не
            занимать ближние ячейки.
          </li>
        </ul>
        <p>
          Период: 30, 60 или 90 дней. По умолчанию 90 — так слоттинг не прыгает от одной недели. F — примерно
          верхние 20% по числу движений, S — следующие 50%, остальное и нули — N.
        </p>
        <p>
          Как пользоваться: на{" "}
          <Link href="/warehouse-stock/finished-goods" className="text-primary underline-offset-2 hover:underline">
            складе ГП
          </Link>{" "}
          смотрите колонку «Профиль» (S4 · AX · F) и фильтр F/S/N. При рекомендации ячейки WMS добавляет балл: F
          тянет к ближним рядам (A-1 раньше, чем C-40), N — к дальним. Класс руками не выбирают.
        </p>
      </>
    ),
  },
  {
    id: "wms-terms",
    category: "terms",
    title: "Словарь: ABC, XYZ, FSN, FEFO, слоттинг",
    summary: "Все главные складские термины — что уже считает WMS, а что пока только в планах.",
    icon: Library,
    keywords:
      "словарь термины abc xyz fsn hml ved sde fifo fefo lot serial slotting coi cube velocity family compatibility replenishment cycle count cross-dock interleaving materials quality kanban min max dead stock supermarket apriltag tag36h11",
    body: (
      <>
        <p>
          Одни и те же салфетки и короб этикеток могут быть оба S1, но жить по-разному: C·X·S против A·X·F. Класс
          хранения — физика. ABC / XYZ / FSN — спрос. FEFO и партии — как отпускать. Слоттинг решает, куда поставить.
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className="bg-muted/50 text-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Метод</th>
                <th className="px-2 py-1.5 font-medium">Что показывает</th>
                <th className="px-2 py-1.5 font-medium">В этой WMS</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">S1–S5</td>
                <td className="px-2 py-1.5">Физика и тип груза</td>
                <td className="px-2 py-1.5">Работает. Считается сам, не вручную.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">ABC</td>
                <td className="px-2 py-1.5">Ценность / доля оборота. A ближе и строже</td>
                <td className="px-2 py-1.5">Работает на складе ГП по доле qty за период.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">XYZ</td>
                <td className="px-2 py-1.5">Стабильность спроса. X ровный, Z хаотичный</td>
                <td className="px-2 py-1.5">Работает: CV недельных движений.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">FSN</td>
                <td className="px-2 py-1.5">Скорость: Fast / Slow / Non-moving</td>
                <td className="px-2 py-1.5">Работает. F ближе, N дальше.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">ABC×XYZ</td>
                <td className="px-2 py-1.5">AX прогнозировать у отбора, CZ убрать далеко</td>
                <td className="px-2 py-1.5">Работает в профиле и в балле слоттинга.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">COI</td>
                <td className="px-2 py-1.5">Объём ÷ число обращений</td>
                <td className="px-2 py-1.5">Работает для палет ГП (евро 1,2×0,8×1,4 м).</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Slotting</td>
                <td className="px-2 py-1.5">Куда выгоднее положить SKU</td>
                <td className="px-2 py-1.5">Работает: балл ряда + рекомендация ячейки.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">FIFO / FEFO</td>
                <td className="px-2 py-1.5">Сначала старая приходная / сначала истекающая</td>
                <td className="px-2 py-1.5">FEFO — ГП, выдача в цех и склад материалов. Без срока — FIFO.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Lot / Serial</td>
                <td className="px-2 py-1.5">Партия или уникальная единица</td>
                <td className="px-2 py-1.5">Партии и коды ЧЗ на карточке и складе ГП.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Cube / Weight</td>
                <td className="px-2 py-1.5">Габарит и масса, тип ячейки</td>
                <td className="px-2 py-1.5">S1–S5, ВГХ палеты, профиль ячейки.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">HML / VED / SDE</td>
                <td className="px-2 py-1.5">Цена штуки / критичность / сложность закупки</td>
                <td className="px-2 py-1.5">Пока не считаем — закупка и себестоимость не ведутся здесь.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Family grouping</td>
                <td className="px-2 py-1.5">Этикетка, пробка, преформа рядом</td>
                <td className="px-2 py-1.5">Планируется. Сейчас группа 1С и правило ряда.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Compatibility</td>
                <td className="px-2 py-1.5">Что нельзя хранить рядом</td>
                <td className="px-2 py-1.5">Семейство на складе материалов. Жёсткий putaway — следующий шаг.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Cycle count</td>
                <td className="px-2 py-1.5">A каждую неделю, C раз в квартал</td>
                <td className="px-2 py-1.5">Планируется. ABC уже есть — задания на пересчёт ещё нет.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Replenishment</td>
                <td className="px-2 py-1.5">Резерв → пик-фейс, когда мало</td>
                <td className="px-2 py-1.5">Планируется.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Cross-dock</td>
                <td className="px-2 py-1.5">С приёмки сразу в отгрузку</td>
                <td className="px-2 py-1.5">Работает: открытая отгрузка SKU → SHIP, не в ряд.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Interleaving</td>
                <td className="px-2 py-1.5">Кара не едет пустая: рядом забрать другую палету</td>
                <td className="px-2 py-1.5">Работает на карах: следующий забор у текущего тега.</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">Min/Max, Kanban, dead stock</td>
                <td className="px-2 py-1.5">Политика запаса, супермаркет, возраст, отзыв, HU</td>
                <td className="px-2 py-1.5">
                  Каталог на обоих складах.{" "}
                  <a href="#warehouse-ops" className="text-primary underline-offset-2 hover:underline">
                    Все методы
                  </a>
                  .
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          На складе ГП профиль выглядит как <span className="font-mono text-foreground">S4 · AX · F</span>. Подробнее:{" "}
          <a href="#abc-xyz" className="text-primary underline-offset-2 hover:underline">
            ABC×XYZ
          </a>
          ,{" "}
          <a href="#slotting" className="text-primary underline-offset-2 hover:underline">
            слоттинг
          </a>
          ,{" "}
          <a href="#coi" className="text-primary underline-offset-2 hover:underline">
            COI
          </a>
          ,{" "}
          <a href="#fsn" className="text-primary underline-offset-2 hover:underline">
            FSN
          </a>
          ,{" "}
          <a href="#warehouse-ops" className="text-primary underline-offset-2 hover:underline">
            методы ГП и материалов
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "abc-xyz",
    category: "terms",
    title: "ABC × XYZ: ценность и стабильность",
    summary: "AX — важный и ровный. AZ — важный, но скачет. CZ — дешёвый и редкий, его можно убрать далеко.",
    icon: Layers,
    keywords: "abc xyz матрица ax az cz оборот cv неделя спрос профиль sku",
    body: (
      <>
        <p>
          ABC — не класс хранения и не FSN. Это доля оборота за 30/60/90 дней: A набирает первые 80% qty или свою долю
          от 20%, B — до 95% или свою долю от 5%, остальное и нули — C. XYZ — насколько ровно товар шёл по неделям
          (коэффициент вариации). X &lt; 0,5, Y до 1, Z выше или истории мало.
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead className="bg-muted/50 text-foreground">
              <tr>
                <th className="px-2 py-1.5" />
                <th className="px-2 py-1.5 font-medium">X стабильный</th>
                <th className="px-2 py-1.5 font-medium">Y колеблется</th>
                <th className="px-2 py-1.5 font-medium">Z хаотичный</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">A</td>
                <td className="px-2 py-1.5">AX у отбора, можно прогнозировать</td>
                <td className="px-2 py-1.5">AY ближе, с запасом</td>
                <td className="px-2 py-1.5">AZ ближе и осторожнее</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">B</td>
                <td className="px-2 py-1.5">BX обычное удобное место</td>
                <td className="px-2 py-1.5">BY середина</td>
                <td className="px-2 py-1.5">BZ не самые горячие ячейки</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-foreground">C</td>
                <td className="px-2 py-1.5">CX чуть дальше, место постоянное</td>
                <td className="px-2 py-1.5">CY дальняя зона</td>
                <td className="px-2 py-1.5">CZ убрать подальше</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Если движений почти нет, почти всё будет C·Z·N — так и должно быть, пока история не накопится. Фильтры
          ABC / XYZ / FSN — на складе ГП.
        </p>
      </>
    ),
  },
  {
    id: "slotting",
    category: "terms",
    title: "Слоттинг и re-slotting",
    summary: "WMS считает балл ячейки и говорит, куда поставить. Если F-товар лежит далеко — предлагает переставить.",
    icon: Map,
    keywords: "слоттинг slotting putaway re-slotting балл ячейка ряд рекомендация размещение",
    body: (
      <>
        <p>
          Слоттинг отвечает на вопрос: «Приехал этот товар — куда его сейчас поставить?» Балл ряда складывается из
          закрепления SKU, той же номенклатуры рядом, FEFO-партии, зоны, FSN, матрицы ABC×XYZ, COI, пути до отбора и
          штрафов за плотность и разрывы.
        </p>
        <p>
          Пример: A-01-02 — 94 балла, A-03-06 — 81, B-11-04 — 55. Рекомендуемая ячейка — первая. Если FSN сменился с
          S на F, а палета стоит в дальнем ряду, на складе ГП появляется пометка re-slot: откуда переставить и на
          сколько примерно короче станет маршрут.
        </p>
        <p>
          Re-slot на складе ГП — подсказка. Cross-dock и interleaving уже живые: отгрузка перехватывает putaway, кара
          получает попутный забор. Пополнение пик-фейса — следующий модуль.
        </p>
      </>
    ),
  },
  {
    id: "coi",
    category: "terms",
    title: "COI — объём на одно обращение",
    summary: "Маленький частый товар ближе. Большой редкий — дальше.",
    icon: Package,
    keywords: "coi cube per order index объём палета болтики короб",
    body: (
      <>
        <p>
          COI = занимаемый объём / число обращений. На складе ГП объём считаем как число палет × европалета 1,2 × 0,8
          × 1,4 м. Болтики с крошечным объёмом и сотнями отборов получают крошечный COI и должны стоять у отбора.
          Короб плёнки на три отбора — большой COI, его лучше держать дальше.
        </p>
        <p>
          Если палет нет или движений ноль, COI не считается. В слоттинге маленький COI тянет к ближним рядам
          относительно медианы по складу.
        </p>
      </>
    ),
  },
  {
    id: "cross-dock",
    category: "terms",
    title: "Cross-dock: не класть, если скоро уезжает",
    summary: "Есть открытая отгрузка этого SKU — WMS шлёт на рампу, а не в ряд хранения.",
    icon: Truck,
    keywords: "cross-dock кроссдок рампа отгрузка putaway не хранить ship",
    body: (
      <>
        <p>
          Если на ту же номенклатуру уже есть открытое задание отгрузки / отбора с горизонтом до 36 часов, размещение
          предлагает <span className="font-mono text-foreground">CROSS-DOCK → SHIP-01</span> вместо ряда A-03. Два
          перемещения — в ячейку и обратно — не нужны.
        </p>
        <p>
          На складе ГП это видно в профиле и на вкладке «Отгрузка». Можно всё равно поставить в ряд, но система
          предупредит. Документ отгрузки и количество подтягиваются из открытых задач.
        </p>
      </>
    ),
  },
  {
    id: "interleaving",
    category: "terms",
    title: "Interleaving: кара не едет пустая",
    summary: "После выгрузки WMS ищет забор рядом и назначает его той же каре.",
    icon: Truck,
    keywords: "interleaving кара погрузчик порожний пробег april tag задание рядом",
    body: (
      <>
        <p>
          Обычный рейс: отвёз палету и вернулся порожняком. Interleaving говорит: раз кара уже у D-18, забери палету из
          D-19. Расстояние считается по тегам пути / AprilTag и по ряду.
        </p>
        <p>
          На странице{" "}
          <Link href="/warehouse-stock/finished-goods/fleet" className="text-primary underline-offset-2 hover:underline">
            Кары и маршруты
          </Link>{" "}
          после шага задания появляется блок «не ехать порожняком» и кнопка назначить попутный маршрут. Нужны
          назначенные каре маршруты с точкой погрузки рядом.
        </p>
      </>
    ),
  },
  {
    id: "planned-wms",
    category: "terms",
    title: "Что пока не встроено",
    summary: "HML, VED, SDE, семейства, матрица совместимости, cycle count, replenishment.",
    icon: BookOpen,
    keywords: "hml ved sde planned cycle replenishment crossdock interleaving family compatibility",
    body: (
      <>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">HML</span> — цена единицы High / Medium / Low. Нужна стабильная
            себестоимость в карточке.
          </li>
          <li>
            <span className="text-foreground">VED</span> — Vital / Essential / Desirable для производства. Пока
            критичность не размечена.
          </li>
          <li>
            <span className="text-foreground">SDE</span> — Scarce / Difficult / Easy закупка. Это контур снабжения.
          </li>
          <li>
            <span className="text-foreground">Family grouping</span> — держать преформу, пробку и плёнку в одной
            логической зоне.
          </li>
          <li>
            <span className="text-foreground">Compatibility</span> — семейство уже на складе материалов; жёсткий
            запрет putaway ещё нет.
          </li>
          <li>
            <span className="text-foreground">Cycle count</span> — задания пересчёта по ABC (A еженедельно).
          </li>
          <li>
            <span className="text-foreground">Replenishment</span> — пополнение пик-фейса из резерва, когда мало.
          </li>
        </ul>
        <p>
          Живой контур ГП: S1–S5 → ABC/XYZ → FSN → FEFO → слоттинг → cross-dock → interleaving. Живой контур
          материалов: семейство → FEFO/FIFO → качество → партия → min/max / Kanban → dead stock → выдача в цех.
          Полный список с пометкой «план»:{" "}
          <a href="#warehouse-ops" className="text-primary underline-offset-2 hover:underline">
            методы ГП и материалов
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "sticker-vs-bottle",
    category: "warehouse",
    title: "Стикер и бутылка с одним названием",
    summary: "Шмаковка на стикере и Шмаковка в группе «Вода» — две разные карточки. Считаем бутылки.",
    icon: Package,
    keywords: "стикер бутылка шмаковка вода тархун чз приёмка этикетка",
    body: (
      <>
        <p>
          На заводе один и тот же напиток живёт двумя карточками. Стикер «Стикер Шмаковка №1» — невыпущенная
          этикетка, её кладут в группу стикеров. Карточка «Шмаковка №1» в группе «Вода» — бутылка, на которую этот
          стикер уже наклеили.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Приёмка «Стикеры» пишет остаток на карточку стикера. Бутылку она не переименовывает.</li>
          <li>Приёмка «Вода и напитки» и склад ГП считают бутылки. Код ЧЗ на бутылке — это уже готовая продукция.</li>
          <li>Нельзя схлопывать эти две карточки: рулон этикеток и палета воды — разный товар.</li>
        </ul>
        <p>
          Подгруппы приёмки: Настройки → Справочники → Подгруппы приёмки. Группы 1С: там же, «Группы товаров и ЕИ».
        </p>
      </>
    ),
  },
  {
    id: "pack-vgh",
    category: "warehouse",
    title: "Вес и габариты палеты от бутылки",
    summary: "0,5 л ≈ 600 г. Палета = штуки × вес бутылки + поддон + плёнка.",
    icon: Package,
    keywords: "вгх габариты вес палета бутылка 0.5 1.5 19 поддон плёнка тара",
    body: (
      <>
        <p>
          На карточке номенклатуры, вкладка «Габариты», включается авторасчёт ВГХ. Литраж берётся из названия
          (0,5л, 1,5л, 11л, 19л) или вводится вручную. Количество бутылок на палете разное даже для одного
          литража — его видно сразу и его можно поправить.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>0,5 л ≈ 600 г одной бутылки с водой.</li>
          <li>Палета: европоддон 1200×800, высота = поддон + слои × высота бутылки.</li>
          <li>Брутто = бутылки × вес + вес поддона (обычно 22 кг) + стретч-плёнка.</li>
        </ul>
        <p>Если авторасчёт включён, поля длины, ширины, высоты и веса заполняются сами. Сохраните карточку.</p>
      </>
    ),
  },
  {
    id: "ship-rules",
    category: "warehouse",
    title: "Отгрузка сетям: слои и свежесть",
    summary: "Пятёрочка просит 4 слоя и свежую продукцию. Партии помечают под контрагента.",
    icon: Truck,
    keywords: "пятёрочка x5 отгрузка слои срок годности контрагент партия свежесть",
    body: (
      <>
        <p>
          В{" "}
          <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
            Настройки → Справочники → Отгрузка контрагентам
          </Link>{" "}
          задаётся правило: сколько слоёв на палете и сколько дней срока должно остаться. Для X5 / Пятёрочки
          обычно 4 слоя и свежая вода.
        </p>
        <p>
          На складе ГП вкладка «Отгрузка» показывает партии с остатком: подходит ли срок, сколько слоёв в
          карточке и кому партия уже помечена. Помеченную партию отгружают этому контрагенту, остальные сети её
          не забирают.
        </p>
      </>
    ),
  },
  {
    id: "receiving",
    category: "warehouse",
    title: "Приёмка",
    summary: "Сессия приёмки, сканы и проведение на остаток.",
    icon: Package,
    keywords: "приёмка приемка тorg1 сессия скан партия",
    body: (
      <>
        <p>
          Откройте{" "}
          <Link href="/receiving" className="text-primary underline-offset-2 hover:underline">
            Приёмку
          </Link>
          . Сессия собирает сканы, партии и расхождения. Когда состав сверен — проведите документ: остаток появится
          на складе.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Неопознанный код не должен теряться: его видно в ленте и можно разобрать позже.</li>
          <li>Коды из заказа этикеток (PRT-…) приходят в приёмку сами после отправки на принтер.</li>
          <li>
            Подгруппа «Стикеры» — невыпущенные этикетки. Подгруппа «Вода и напитки» — бутылки со стикером уже на
            горлышке. Подробнее:{" "}
            <a href="#sticker-vs-bottle" className="text-primary underline-offset-2 hover:underline">
              стикер и бутылка
            </a>
            .
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "movement",
    category: "warehouse",
    title: "Перемещения",
    summary: "Откуда, куда и сколько — без путаницы в ячейках.",
    icon: Truck,
    keywords: "перемещение движение ячейка откуда куда",
    body: (
      <>
        <p>
          Страница{" "}
          <Link href="/movement" className="text-primary underline-offset-2 hover:underline">
            Перемещения
          </Link>
          : укажите источник, приёмник и количество. Сначала ячейка-источник, потом назначение — так меньше
          ошибочных проводок.
        </p>
        <p>Если ячейка заблокирована или на ней чужая номенклатура ожидания — система не даст положить «мимо».</p>
      </>
    ),
  },
  {
    id: "documents",
    category: "warehouse",
    title: "Документы и задания",
    summary: "Как создать документ и закрыть задачу на ТСД.",
    icon: FileText,
    keywords: "документ задача очередь готово",
    body: (
      <>
        <p>
          Документ создаётся кнопкой «Новый документ» в соответствующем разделе. Задания из документа попадают в{" "}
          <Link href="/tasks" className="text-primary underline-offset-2 hover:underline">
            очередь
          </Link>{" "}
          и на назначенный терминал.
        </p>
        <p>
          На ТСД задача закрывается кнопкой «Готово»: можно указать фактическое количество и комментарий. Если
          задача назначена на другой терминал, чужой ТСД её не возьмёт.
        </p>
      </>
    ),
  },
  {
    id: "notifications",
    category: "warehouse",
    title: "Уведомления",
    summary: "Колокольчик в шапке и ежедневная почта о просрочке.",
    icon: Bell,
    keywords: "уведомления колокольчик просрочка почта рассылка",
    body: (
      <p>
        Список в правом верхнем углу. Нажмите на строку — она станет прочитанной. Ежедневное письмо «Уведомление о
        просроченной продукции на складе» настраивается в Контроль → Уведомления: пул адресов и что включать. Пока
        партию не спишут, письмо повторяется каждое утро с support@scada25.ru.
      </p>
    ),
  },
  {
    id: "label-orders",
    category: "marking",
    title: "Заказы кодов и погрешность печати",
    summary: "Документ заказа, хвост пустых этикеток и факт печати.",
    icon: ClipboardList,
    keywords: "заказ кодов стикер суз погрешность хвост печать zk",
    body: (
      <>
        <p>
          Страница{" "}
          <Link href="/marking/label-orders" className="text-primary underline-offset-2 hover:underline">
            Заказы кодов
          </Link>
          : каждая строка — документ <span className="font-mono text-xs">ZK-ГГММДД-NN</span>. В нём кто заказал,
          откуда и когда.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Печать идёт с первой этикетки, в конце рулона остаётся хвост пустых — это планируемая погрешность.</li>
          <li>По умолчанию хвост 3 % от тиража, но не меньше минимального числа штук. Настраивается в шестерёнке.</li>
          <li>
            После печати внесите факт: сколько годных, сколько промотали, сколько брака. Можно несколько записей,
            ошибочную — отменить.
          </li>
          <li>«На принтер» отправляет задание в очередь и сразу кладёт коды в приёмку документом PRT-…</li>
        </ul>
      </>
    ),
  },
  {
    id: "aps",
    category: "production",
    title: "Календарь производства",
    summary: "Полоски заказов, сдвиг дат, зависимости и партии с линии.",
    icon: CalendarRange,
    keywords: "aps календарь план векas мойка линия",
    body: (
      <>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Клик по полоске — выбор заказа, двойной клик — MRP и материалы.</li>
          <li>Перетащите полоску или кнопки «−1 день» / «+1 день».</li>
          <li>«Месяц / День»: в дне сетка по часам; клик по числу в месяце открывает этот день.</li>
          <li>«Сделать предыдущим» → выберите следующий план — появится стрелка зависимости.</li>
          <li>События линии: выберите план → «Мойка после» или «Профилактика после».</li>
        </ul>
        <p>
          Партии Векас со статусом «В процессе» подтягиваются сами. Когда партия «На складе» — в план пишется число
          валидированных кодов. Кнопка «С линии (Векас)» запускает тот же цикл вручную.
        </p>
      </>
    ),
  },
  {
    id: "apriltag-print",
    category: "warehouse",
    title: "AprilTag: печать меток",
    summary: "Сторона чёрного квадрата в сантиметрах. PDF печатается 1:1.",
    icon: ScanLine,
    keywords: "apriltag april tag36h11 печать метка ряд план png pdf см dpi 80",
    body: (
      <>
        <p>
          Раздел в меню «Контроль» →{" "}
          <Link href="/warehouse-stock/finished-goods/apriltags" className="text-primary underline-offset-2 hover:underline">
            AprilTag
          </Link>
          . Семья на плане ГП и в ТСД — <span className="font-mono text-foreground">tag36h11</span>, номера 0…586.
        </p>
        <p>
          Размер — сторона чёрного квадрата в сантиметрах, не пиксели. Для метки 80 см поставьте 80. Белое поле считается
          в клетках сетки (у tag36h11 это 8×8): одна клетка = сторона / 8. При 80 см и поле 1 клетка лист будет 100×100
          см.
        </p>
        <p>
          Если нужна другая семья, переключите её на странице: tag16h5 (30 кодов, сетка 6×6), tag25h9 (35 кодов, 7×7),
          tag36h10 (2320 кодов, 8×8). Картинки те же, что даёт April Robotics GenerateTags. Камера прочитает их только
          если детектор настроен на эту семью — ряды склада сами не переключатся.
        </p>
        <p>
          PNG пишется с физическим размером (pHYs). PDF — страница в тех же сантиметрах, печать 100%, без масштаба. ZIP
          с плана собирает PNG или PDF номеров с плана. Для маленьких семей есть ZIP всех кодов.
        </p>
      </>
    ),
  },
  {
    id: "fg-row",
    category: "warehouse",
    title: "Склад ГП и идентификация ряда",
    summary: "Две бутылки задают диапазон — паллеты встают в ряд на карте.",
    icon: Map,
    keywords: "гп ряд паллета бутылка карта april",
    body: (
      <>
        <p>
          На складе готовой продукции ряд можно заполнить с телефона: сканируете первую и последнюю бутылку. WMS
          берёт даты изготовления, отбирает коды той же номенклатуры в диапазоне и пишет паллеты в выбранный ряд.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-xl">
            <Link href="/warehouse-stock/finished-goods">Склад ГП</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="rounded-xl">
            <Link href="/help/row-identify-api">Swagger идентификации ряда</Link>
          </Button>
        </div>
      </>
    ),
  },
  {
    id: "api",
    category: "dev",
    title: "Полный API (Swagger)",
    summary: "Все 361 операция WMS, очереди печати и обновлений в одном контракте.",
    icon: BookOpen,
    keywords: "swagger openapi api json разработчик интеграция 1с",
    body: (
      <>
        <p>
          Интерактивная документация: авторизация токеном и вызов методов из браузера. Сырой JSON можно скачать и
          импортировать в Postman.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="rounded-xl">
            <Link href="/help/api">Открыть Swagger</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-xl">
            <a href="/api/wms/openapi" download="wms.openapi.json">
              Скачать OpenAPI JSON
            </a>
          </Button>
        </div>
        <p className="text-xs">
          Для интеграций выпустите токен в Настройки → Профиль → «Токены API» и передайте
          <span className="font-mono"> Authorization: Bearer wmsu_…</span>. Сессия сайта (логин) тоже подходит.
          Для ТСД — схема deviceToken после обмена кода.
        </p>
      </>
    ),
  },
]

export default function HelpPage() {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<HelpCategory>("all")
  const [openIds, setOpenIds] = useState<string[]>([])

  useEffect(() => {
    function openHash() {
      const rawHash = window.location.hash.replace("#", "")
      const aliases: Record<string, string> = {
        "fefo-workshop": "fefo",
        "vendor-batch": "material-lot",
        "internal-batch": "material-lot",
        kitting: "material-warehouse",
        backflush: "material-warehouse",
        "line-side": "material-warehouse",
        "uom-conversion": "material-warehouse",
        "return-to-stock": "material-warehouse",
        minmax: "stock-policy",
        safety: "stock-policy",
        reorder: "stock-policy",
        "lead-time": "stock-policy",
        supermarket: "kanban-supermarket",
        "two-bin": "kanban-supermarket",
        ekanban: "kanban-supermarket",
        "call-off": "kanban-supermarket",
        starvation: "kanban-supermarket",
        "milk-run": "warehouse-ops-inbox",
        tugger: "warehouse-ops-inbox",
        wave: "warehouse-ops-inbox",
        "fefo-ex": "warehouse-ops-inbox",
        "dock-to-stock": "warehouse-ops-inbox",
        heatmap: "warehouse-ops-inbox",
        "dead-stock": "dead-aging",
        aging: "dead-aging",
        obsolescence: "dead-aging",
      }
      const topicIds = new Set(TOPICS.map((t) => t.id))
      for (const row of WAREHOUSE_OPS_CATALOG) {
        if (!topicIds.has(row.id) && !aliases[row.id]) aliases[row.id] = "warehouse-ops"
      }
      const hash = aliases[rawHash] || rawHash
      if (hash && TOPICS.some((t) => t.id === hash)) {
        setOpenIds([hash])
        requestAnimationFrame(() => {
          const target = document.getElementById(rawHash) || document.getElementById(hash)
          target?.scrollIntoView({ behavior: "smooth", block: "start" })
        })
      }
    }
    openHash()
    window.addEventListener("hashchange", openHash)
    return () => window.removeEventListener("hashchange", openHash)
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return TOPICS.filter((t) => {
      if (category !== "all" && t.category !== category) return false
      if (!q) return true
      return `${t.title} ${t.summary} ${t.keywords}`.toLowerCase().includes(q)
    })
  }, [query, category])

  function toggle(id: string, next: boolean) {
    setOpenIds((prev) => {
      const set = new Set(prev)
      if (next) set.add(id)
      else set.delete(id)
      return [...set]
    })
    if (next) history.replaceState(null, "", `#${id}`)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 border-b border-border/70 bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-foreground">Справка</h1>
            <p className="text-xs text-muted-foreground">Как работать в WMS — коротко и по делу</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти: FEFO, Kanban, min/max, dead stock, карантин…"
            className="h-11 rounded-xl bg-card pl-10 shadow-sm"
          />
        </div>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                category === c.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            По запросу «{query}» ничего нет. Сбросьте поиск или выберите другой раздел.
          </div>
        ) : (
          <div className="space-y-2.5">
            {visible.map((topic) => (
              <Topic
                key={topic.id}
                topic={topic}
                open={openIds.includes(topic.id)}
                onOpenChange={(next) => toggle(topic.id, next)}
              />
            ))}
          </div>
        )}

        <p className="px-1 pb-4 text-center text-xs text-muted-foreground">
          {visible.length}{" "}
          {visible.length === 1 ? "тема" : visible.length < 5 ? "темы" : "тем"}
          {query || category !== "all" ? " по фильтру" : ""}
        </p>
      </div>
    </div>
  )
}
