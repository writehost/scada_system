import { barcodeDesignHtml, normalizeBarcodeBlock, type BarcodeBlockConfig } from "./barcode.ts"
import { DOC_COMPONENTS_CSS } from "./components-css.ts"
import { dataTableDesignHtml, defaultDataTable, type DataTableColumn, type DataTableConfig } from "./data-table.ts"
import { wrapJinjaDocument } from "./document.ts"
import { designHtmlToJinja } from "./jinja/exporter.ts"
import { DEFAULT_PAGE, type PageSettings } from "./page.ts"

/**
 * Готовые системные шаблоны. Хранятся как обычный Jinja HTML — тот же путь,
 * что и импорт существующих шаблонов: importer превращает их в блоки редактора.
 */

export type SystemTemplate = {
  id: string
  name: string
  docTypeLabel: string
  docKind: string
  description: string
  page: PageSettings
  sampleId: string
  jinja: string
}

function col(id: string, label: string, expr: string, width = "", align: DataTableColumn["align"] = "left", format: DataTableColumn["format"] = ""): DataTableColumn {
  return { id, label, expr, width, align, format }
}

function table(over: Partial<DataTableConfig>): string {
  return designHtmlToJinja(dataTableDesignHtml({ ...defaultDataTable(over.source, over.itemVar), ...over }))
}

function barcode(cfg: Partial<BarcodeBlockConfig>): string {
  return designHtmlToJinja(barcodeDesignHtml(normalizeBarcodeBlock(cfg)))
}

const FOOTER_PAGES = `<div class="doc-region doc-region-footer" data-doc-region="footer" data-doc-repeat="all"><div style="text-align:right">Страница {{ page.number }} из {{ page.total }}</div></div>`

function signature(role: string, nameExpr: string, signatureExpr?: string): string {
  const img = signatureExpr ? `{% if ${signatureExpr} %}<img src="{{ ${signatureExpr} }}" alt="">{% endif %}` : ""
  return `<div class="doc-signature"><span class="doc-signature-role">${role}</span><span class="doc-signature-line">${img}</span><span class="doc-signature-name">/ {{ ${nameExpr} }} /</span></div>`
}

function stamp(imageExpr: string): string {
  return `<div class="doc-stamp">М.П.{% if ${imageExpr} %}<img src="{{ ${imageExpr} }}" alt="">{% endif %}</div>`
}

const TRADE_CSS = `${DOC_COMPONENTS_CSS}
.party { margin: 0 0 1.5mm; }
.party b { display: inline-block; min-width: 28mm; }
.org-name { font-size: 12pt; font-weight: 700; }
.total-line { text-align: right; margin: 3mm 0; font-size: 11pt; }
.comment-box { border-left: 2pt solid #94a3b8; padding: 1.5mm 3mm; margin: 3mm 0; background: #f8fafc; }`

const UPD_TABLE = table({
  source: "document.items",
  itemVar: "item",
  columns: [
    col("c_no", "№", "loop.index", "9mm", "center"),
    col("c_name", "Наименование", "item.name"),
    col("c_gtin", "GTIN", "item.gtin", "30mm"),
    col("c_qty", "Количество", "item.quantity", "22mm", "right", "number"),
    col("c_price", "Цена", "item.price", "22mm", "right", "money"),
    col("c_sum", "Сумма", "item.amount", "26mm", "right", "money"),
  ],
  totals: { show: true, bold: true, cells: { c_name: { text: "Итого" }, c_sum: { expr: "document.total" } } },
})

const UPD_DEMO = `<div class="doc-cols">
  <div class="doc-col">
    <div class="org-name">{{ seller.name }}</div>
    <div class="doc-requisites">ИНН {{ seller.inn }} / КПП {{ seller.kpp }}<br>{{ seller.address }}</div>
  </div>
  <div class="doc-col" style="flex:0 0 26mm">${barcode({ kind: "qrcode", expr: "document.url", sizeMm: 24 })}</div>
</div>
<h1 class="doc-title">УПД № {{ document.number }} от {{ document.date | date }}</h1>
<p class="party"><b>Продавец:</b> {{ seller.name }}</p>
<p class="party"><b>Покупатель:</b> {{ buyer.name }}</p>
<p class="party"><b>ИНН покупателя:</b> {{ buyer.inn }}</p>
${UPD_TABLE}
<p class="total-line"><b>Итого:</b> {{ document.total | money }} руб.</p>
{% if document.comment %}<div class="comment-box"><b>Комментарий:</b> {{ document.comment }}</div>{% endif %}
<div class="doc-cols" style="margin-top:8mm">
  <div class="doc-col">
    <div class="doc-small">Товар передал</div>
    ${signature("Продавец", "seller.responsible", "seller.signature_image")}
  </div>
  <div class="doc-col">
    <div class="doc-small">Товар получил</div>
    ${signature("Покупатель", "buyer.responsible", "buyer.signature_image")}
  </div>
</div>
${stamp("seller.stamp_image")}
${FOOTER_PAGES}`

const INVOICE = `<div class="doc-cols">
  <div class="doc-col"><div class="org-name">{{ seller.name }}</div><div class="doc-requisites">{{ seller.address }}<br>Тел.: {{ seller.phone }}</div></div>
</div>
<table class="doc-table" style="width:100%;border-collapse:collapse;margin:4mm 0;font-size:9pt">
  <tbody>
    <tr><td style="border:0.75pt solid #333;padding:1.5mm" colspan="2">{{ seller.bank_name }}<br><span class="doc-caption">Банк получателя</span></td><td style="border:0.75pt solid #333;padding:1.5mm;width:20mm">БИК</td><td style="border:0.75pt solid #333;padding:1.5mm;width:45mm">{{ seller.bik }}</td></tr>
    <tr><td style="border:0.75pt solid #333;padding:1.5mm">ИНН {{ seller.inn }}</td><td style="border:0.75pt solid #333;padding:1.5mm">КПП {{ seller.kpp }}</td><td style="border:0.75pt solid #333;padding:1.5mm">Сч. №</td><td style="border:0.75pt solid #333;padding:1.5mm">{{ seller.account }}</td></tr>
  </tbody>
</table>
<h1 class="doc-title">Счёт на оплату № {{ document.number }} от {{ document.date | date("D MMMM YYYY") }} г.</h1>
<p class="party"><b>Поставщик:</b> {{ seller.name }}, ИНН {{ seller.inn }}, {{ seller.address }}</p>
<p class="party"><b>Покупатель:</b> {{ buyer.name }}, ИНН {{ buyer.inn }}, {{ buyer.address }}</p>
${table({
  columns: [
    col("c_no", "№", "loop.index", "9mm", "center"),
    col("c_name", "Товар", "item.name"),
    col("c_qty", "Кол-во", "item.quantity", "18mm", "right", "number"),
    col("c_unit", "Ед.", "item.unit", "12mm", "center"),
    col("c_price", "Цена", "item.price", "24mm", "right", "money"),
    col("c_sum", "Сумма", "item.amount", "26mm", "right", "money"),
  ],
  totals: { show: true, bold: true, cells: { c_price: { text: "Итого:" }, c_sum: { expr: "document.total" } } },
})}
<p class="total-line">В том числе НДС: {{ document.vat_total | money }} руб.</p>
<p><b>Всего к оплате:</b> {{ document.total_in_words }}</p>
<div class="doc-cols" style="margin-top:8mm">
  <div class="doc-col">${signature("Руководитель", "seller.director")}</div>
  <div class="doc-col">${signature("Бухгалтер", "seller.accountant")}</div>
</div>
${FOOTER_PAGES}`

const ACT = `<h1 class="doc-title">Акт № {{ document.number }} от {{ document.date | date }}</h1>
<p class="party"><b>Исполнитель:</b> {{ seller.name }}, ИНН {{ seller.inn }}</p>
<p class="party"><b>Заказчик:</b> {{ buyer.name }}, ИНН {{ buyer.inn }}</p>
<p class="party"><b>Основание:</b> {{ document.basis }}</p>
${table({
  columns: [
    col("c_no", "№", "loop.index", "9mm", "center"),
    col("c_name", "Наименование работ, услуг", "item.name"),
    col("c_qty", "Кол-во", "item.quantity", "18mm", "right", "number"),
    col("c_unit", "Ед.", "item.unit", "12mm", "center"),
    col("c_price", "Цена", "item.price", "24mm", "right", "money"),
    col("c_sum", "Сумма", "item.amount", "26mm", "right", "money"),
  ],
  totals: { show: true, bold: true, cells: { c_price: { text: "Итого:" }, c_sum: { expr: "document.total" } } },
})}
<p>Всего оказано услуг на сумму {{ document.total | money }} руб. ({{ document.total_in_words }}).</p>
<p>Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.</p>
<div class="doc-cols" style="margin-top:10mm">
  <div class="doc-col"><div class="doc-small">Исполнитель</div>${signature("", "seller.director")}${stamp("seller.stamp_image")}</div>
  <div class="doc-col"><div class="doc-small">Заказчик</div>${signature("", "buyer.director")}${stamp("buyer.stamp_image")}</div>
</div>`

const QUALITY = `<div class="doc-cols">
  <div class="doc-col"><div class="org-name">{{ organization.name }}</div><div class="doc-requisites">{{ organization.address }}</div></div>
  <div class="doc-col" style="flex:0 0 26mm">${barcode({ kind: "qrcode", expr: "document.url", sizeMm: 24 })}</div>
</div>
<h1 class="doc-title">Сертификат качества № {{ document.number }}</h1>
<p style="text-align:center">от {{ document.date | date("D MMMM YYYY") }} г.</p>
<table style="width:100%;border-collapse:collapse;margin:3mm 0">
  <tbody>
    <tr><td style="padding:1mm 0;width:45mm"><b>Продукция</b></td><td>{{ product.name }}</td></tr>
    <tr><td style="padding:1mm 0"><b>GTIN</b></td><td>{{ product.gtin }}</td></tr>
    <tr><td style="padding:1mm 0"><b>Партия</b></td><td>{{ product.batch }}, {{ product.quantity | number }} {{ product.unit }}</td></tr>
    <tr><td style="padding:1mm 0"><b>Дата производства</b></td><td>{{ product.production_date | date }}</td></tr>
    <tr><td style="padding:1mm 0"><b>Годен до</b></td><td>{{ product.expiry_date | date }}</td></tr>
    <tr><td style="padding:1mm 0"><b>Нормативный документ</b></td><td>{{ product.standard }}</td></tr>
  </tbody>
</table>
${table({
  source: "tests",
  itemVar: "test",
  columns: [
    col("c_param", "Показатель", "test.parameter"),
    col("c_norm", "Норма", "test.norm", "26mm", "center"),
    col("c_act", "Факт", "test.actual", "20mm", "center"),
    col("c_unit", "Ед. изм.", "test.unit", "20mm", "center"),
    col("c_res", "Результат", "test.result", "30mm", "center"),
  ],
})}
<p style="margin-top:4mm"><b>Заключение:</b> {{ document.comment }}</p>
<div style="margin-top:10mm">${signature("{{ responsible.position }}", "responsible.short_name", "responsible.signature_image")}</div>
${stamp("organization.stamp_image")}`

const EQUIPMENT = `<h1 class="doc-title">Паспорт оборудования</h1>
<p style="text-align:center;font-size:12pt"><b>{{ equipment.name }}</b></p>
<div class="doc-cols">
  <div class="doc-col">
    <p class="party"><b>Модель:</b> {{ equipment.model }}</p>
    <p class="party"><b>Заводской №:</b> {{ equipment.serial }}</p>
    <p class="party"><b>Инвентарный №:</b> {{ equipment.inventory_number }}</p>
    <p class="party"><b>Изготовитель:</b> {{ equipment.manufacturer }}</p>
    <p class="party"><b>Год выпуска:</b> {{ equipment.year }}</p>
    <p class="party"><b>Место установки:</b> {{ equipment.location }}</p>
    <p class="party"><b>Ввод в эксплуатацию:</b> {{ equipment.commissioning_date | date }}</p>
  </div>
  <div class="doc-col" style="flex:0 0 30mm">${barcode({ kind: "datamatrix", expr: "equipment.inventory_number", sizeMm: 26 })}</div>
</div>
<h2>Технические характеристики</h2>
${table({
  source: "equipment.parameters",
  itemVar: "param",
  columns: [col("c_n", "Параметр", "param.name"), col("c_v", "Значение", "param.value", "40mm", "right"), col("c_u", "Ед. изм.", "param.unit", "24mm", "center")],
})}
<h2 style="margin-top:5mm">Техническое обслуживание</h2>
${table({
  source: "equipment.maintenance",
  itemVar: "record",
  columns: [
    col("c_d", "Дата", "record.date", "24mm", "center", "date"),
    col("c_k", "Вид работ", "record.kind", "30mm"),
    col("c_p", "Исполнитель", "record.performer", "40mm"),
    col("c_note", "Примечание", "record.note"),
  ],
  emptyText: "Записей нет",
})}
<div style="margin-top:8mm">${signature("{{ responsible.position }}", "responsible.short_name")}</div>`

const PRODUCTION = `<div class="doc-cols">
  <div class="doc-col"><div class="org-name">{{ organization.name }}</div></div>
  <div class="doc-col" style="flex:0 0 55mm;text-align:right">${barcode({ kind: "code128", expr: "order.number", sizeMm: 25, humanReadable: true })}</div>
</div>
<h1 class="doc-title">Задание на производство № {{ order.number }}</h1>
<div class="doc-cols">
  <div class="doc-col">
    <p class="party"><b>Дата:</b> {{ order.date | date }}</p>
    <p class="party"><b>Линия:</b> {{ order.line }}, смена: {{ order.shift }}</p>
    <p class="party"><b>Срок:</b> {{ order.due_date | date }}</p>
  </div>
  <div class="doc-col">
    <p class="party"><b>Продукция:</b> {{ order.product_name }}</p>
    <p class="party"><b>GTIN:</b> {{ order.gtin }}</p>
    <p class="party"><b>План:</b> {{ order.planned_qty | number }} {{ order.unit }}</p>
  </div>
</div>
<h2>Маршрут</h2>
${table({
  source: "order.operations",
  itemVar: "op",
  columns: [
    col("c_seq", "№", "op.seq", "12mm", "center"),
    col("c_name", "Операция", "op.name"),
    col("c_wc", "Участок", "op.workcenter", "30mm"),
    col("c_dur", "Мин", "op.duration_min", "16mm", "right"),
    col("c_op", "Исполнитель", "op.operator", "32mm"),
    col("c_sign", "Отметка", "", "24mm"),
  ],
})}
<h2 style="margin-top:5mm">Материалы</h2>
${table({
  source: "order.materials",
  itemVar: "mat",
  columns: [col("c_code", "Код", "mat.code", "24mm"), col("c_name", "Материал", "mat.name"), col("c_q", "Кол-во", "mat.quantity", "24mm", "right", "number"), col("c_u", "Ед.", "mat.unit", "12mm", "center")],
})}
{% if order.comment %}<p class="comment-box">{{ order.comment }}</p>{% endif %}
<div style="margin-top:8mm">${signature("{{ responsible.position }}", "responsible.short_name")}</div>`

const WAREHOUSE = `<div class="doc-cols">
  <div class="doc-col"><div class="org-name">{{ organization.name }}</div></div>
  <div class="doc-col" style="flex:0 0 55mm;text-align:right">${barcode({ kind: "code128", expr: "document.number", sizeMm: 25, humanReadable: true })}</div>
</div>
<h1 class="doc-title">{{ document.type }} № {{ document.number }} от {{ document.date | date }}</h1>
<p class="party"><b>Откуда:</b> {{ document.source_warehouse }} {{ document.source_location }}</p>
<p class="party"><b>Куда:</b> {{ document.target_warehouse }} {{ document.target_location }}</p>
{% if document.line_name %}<p class="party"><b>Участок:</b> {{ document.line_name }}</p>{% endif %}
${table({
  source: "document.items",
  itemVar: "item",
  columns: [
    col("c_no", "№", "item.line_no", "10mm", "center"),
    col("c_code", "Код", "item.code", "24mm"),
    col("c_name", "Наименование", "item.name"),
    col("c_lot", "Партия", "item.lot", "22mm"),
    col("c_q", "Кол-во", "item.quantity", "18mm", "right", "number"),
    col("c_cq", "Факт", "item.confirmed_quantity", "18mm", "right", "number"),
    col("c_u", "Ед.", "item.unit", "12mm", "center"),
  ],
})}
{% if document.comment %}<p class="comment-box">{{ document.comment }}</p>{% endif %}
<div class="doc-cols" style="margin-top:8mm">
  <div class="doc-col">${signature("Отпустил", "document.operator")}</div>
  <div class="doc-col">${signature("Принял", "print.user")}</div>
</div>
${FOOTER_PAGES}`

const LABELS = `<h2>{{ sheet.title }}</h2>
<div style="display:flex;flex-wrap:wrap;gap:4mm">{% for label in labels %}<div style="width:58mm;border:0.5pt dashed #94a3b8;padding:2mm;break-inside:avoid;display:flex;gap:2mm"><div>${barcode({ kind: "gs1datamatrix", expr: "label.marking_code", sizeMm: 18 })}</div><div style="font-size:7pt;line-height:1.25"><b>{{ label.name }}</b><br>GTIN {{ label.gtin }}<br>Партия {{ label.batch }}<br>Годен до {{ label.expiry_date | date }}</div></div>{% endfor %}</div>`

const BLANK = `<h1 class="doc-title">Новый документ</h1>
<p>Перетащите блоки слева, чтобы собрать документ. Данные — в разделе «Данные».</p>`

const PORTRAIT = DEFAULT_PAGE

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  { id: "upd-demo", name: "УПД — Demo", docTypeLabel: "УПД", docKind: "trade", description: "Демонстрационный УПД: шапка, таблица позиций, итог, условие комментария, подписи", page: PORTRAIT, sampleId: "upd-123", jinja: wrapJinjaDocument({ title: "УПД — Demo", page: PORTRAIT, css: TRADE_CSS, body: UPD_DEMO }) },
  { id: "invoice", name: "Счёт на оплату", docTypeLabel: "Счёт", docKind: "trade", description: "Счёт с банковскими реквизитами", page: PORTRAIT, sampleId: "upd-123", jinja: wrapJinjaDocument({ title: "Счёт на оплату", page: PORTRAIT, css: TRADE_CSS, body: INVOICE }) },
  { id: "act", name: "Акт оказанных услуг", docTypeLabel: "Акт", docKind: "trade", description: "Акт с подписями и печатями сторон", page: PORTRAIT, sampleId: "upd-123", jinja: wrapJinjaDocument({ title: "Акт оказанных услуг", page: PORTRAIT, css: TRADE_CSS, body: ACT }) },
  { id: "quality-cert", name: "Сертификат качества", docTypeLabel: "Сертификат качества", docKind: "quality", description: "Показатели партии и заключение ОТК", page: PORTRAIT, sampleId: "cert-2610", jinja: wrapJinjaDocument({ title: "Сертификат качества", page: PORTRAIT, css: TRADE_CSS, body: QUALITY }) },
  { id: "equipment-passport", name: "Паспорт оборудования", docTypeLabel: "Паспорт оборудования", docKind: "equipment", description: "Характеристики и журнал обслуживания", page: PORTRAIT, sampleId: "filler-01", jinja: wrapJinjaDocument({ title: "Паспорт оборудования", page: PORTRAIT, css: TRADE_CSS, body: EQUIPMENT }) },
  { id: "production-task", name: "Задание на производство", docTypeLabel: "Задание на производство", docKind: "production", description: "Маршрутный лист с операциями и материалами", page: PORTRAIT, sampleId: "po-777", jinja: wrapJinjaDocument({ title: "Задание на производство", page: PORTRAIT, css: TRADE_CSS, body: PRODUCTION }) },
  { id: "warehouse-doc", name: "Складской документ", docTypeLabel: "Складской документ", docKind: "warehouse", description: "Перемещение / выдача по документу WMS", page: PORTRAIT, sampleId: "transfer-demo", jinja: wrapJinjaDocument({ title: "Складской документ", page: PORTRAIT, css: TRADE_CSS, body: WAREHOUSE }) },
  { id: "labels-sheet", name: "Этикеточный лист", docTypeLabel: "Этикетки", docKind: "labels", description: "Лист этикеток с GS1 DataMatrix", page: { ...PORTRAIT, margins: { top: 10, right: 10, bottom: 10, left: 10 } }, sampleId: "labels-demo", jinja: wrapJinjaDocument({ title: "Этикеточный лист", page: { ...PORTRAIT, margins: { top: 10, right: 10, bottom: 10, left: 10 } }, css: TRADE_CSS, body: LABELS }) },
  { id: "blank", name: "Пустой документ", docTypeLabel: "Документ", docKind: "trade", description: "Чистый лист A4", page: PORTRAIT, sampleId: "upd-123", jinja: wrapJinjaDocument({ title: "Пустой документ", page: PORTRAIT, css: DOC_COMPONENTS_CSS, body: BLANK }) },
]

export function getSystemTemplate(id: string): SystemTemplate | null {
  return SYSTEM_TEMPLATES.find((t) => t.id === id) ?? null
}
