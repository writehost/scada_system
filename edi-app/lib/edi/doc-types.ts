/**
 * Реестр типов документов. Тип задаёт реквизиты, наличие табличной части, допустимые направления,
 * структурированные форматы (если подключены) и срок хранения по умолчанию (переопределяется
 * в edi_retention_rules администратором — значения здесь стартовые, а не юридическое заключение).
 *
 * Статусы делятся на три независимые оси и не смешиваются:
 *  - status          — жизненный цикл документа внутри организации (черновик, согласование, подпись…);
 *  - exchange_status — юридически значимый обмен через оператора ЭДО;
 *  - wms_status      — связь с фактической складской операцией.
 */

export type FieldType = "text" | "textarea" | "number" | "money" | "date" | "select" | "boolean" | "user"

export type FieldDef = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: Array<{ value: string; label: string }>
  /** Показывать поле, только если другое поле имеет значение. */
  showIf?: { field: string; equals: string | boolean }
  hint?: string
}

export type DocCategory = "financial" | "contract" | "warehouse" | "internal" | "logistics" | "commercial"

export type DocTypeDef = {
  code: string
  name: string
  short: string
  category: DocCategory
  directions: Array<"incoming" | "outgoing" | "internal">
  hasCounterparty: boolean
  hasLines: boolean
  hasAmount: boolean
  fields: FieldDef[]
  /** Коды форматов edi_formats, которыми документ может быть представлен структурированно. */
  formats?: string[]
  /** Может породить черновик приёмки WMS. */
  wmsReceipt?: boolean
  retentionYears: number
  retentionBasis: string
  /** Документ, который этот тип корректирует (для корректировочных). */
  corrects?: string[]
}

export const CATEGORY_LABEL: Record<DocCategory, string> = {
  financial: "Финансовые",
  contract: "Договорные",
  warehouse: "Складские",
  internal: "Внутренние",
  logistics: "Логистические",
  commercial: "Коммерческие",
}

const ACCOUNTING_5Y = "402-ФЗ ст. 29: первичные учётные документы — не менее 5 лет после отчётного года"
const TAX_4Y = "НК РФ ст. 23: документы налогового учёта — 4 года (проверьте учётную политику)"
const CONTRACT_5Y = "Перечень Росархива (приказ № 236): договоры — 5 лет после истечения срока действия"
const INTERNAL_5Y = "Перечень Росархива (приказ № 236): по виду документа; стартовое значение 5 лет"

const basis = { key: "basis", label: "Основание", type: "text" as const, hint: "Договор, заказ или иной документ-основание" }
const contractRef = { key: "contractNumber", label: "Договор №", type: "text" as const }
const payDue = { key: "paymentDue", label: "Оплатить до", type: "date" as const }

export const DOC_TYPES: DocTypeDef[] = [
  {
    code: "invoice",
    name: "Счёт на оплату",
    short: "Счёт",
    category: "financial",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [contractRef, payDue, { key: "purpose", label: "Назначение платежа", type: "textarea" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "invoice_fact",
    name: "Счёт-фактура",
    short: "СФ",
    category: "financial",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [basis, { key: "shipmentDocNumber", label: "Документ отгрузки", type: "text" }],
    formats: ["fns_upd_5_03", "fns_upd_5_01"],
    retentionYears: 4,
    retentionBasis: TAX_4Y,
  },
  {
    code: "upd",
    name: "Универсальный передаточный документ",
    short: "УПД",
    category: "financial",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [
      {
        key: "function",
        label: "Функция",
        type: "select",
        required: true,
        options: [
          { value: "СЧФДОП", label: "СЧФДОП — счёт-фактура и передаточный документ" },
          { value: "ДОП", label: "ДОП — только передаточный документ" },
          { value: "СЧФ", label: "СЧФ — только счёт-фактура" },
        ],
      },
      basis,
      { key: "shipmentDate", label: "Дата отгрузки", type: "date" },
      { key: "operation", label: "Содержание операции", type: "text" },
    ],
    formats: ["fns_upd_5_03", "fns_upd_5_01"],
    wmsReceipt: true,
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "ukd",
    name: "Корректировочный документ (УКД)",
    short: "УКД",
    category: "financial",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [
      { key: "correctedNumber", label: "Исправляемый документ №", type: "text", required: true },
      { key: "correctedDate", label: "Дата исправляемого", type: "date", required: true },
      { key: "reason", label: "Основание корректировки", type: "textarea" },
    ],
    corrects: ["upd", "invoice_fact"],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "act_works",
    name: "Акт выполненных работ",
    short: "Акт работ",
    category: "financial",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [contractRef, { key: "periodFrom", label: "Период с", type: "date" }, { key: "periodTo", label: "по", type: "date" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "act_services",
    name: "Акт оказанных услуг",
    short: "Акт услуг",
    category: "financial",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [contractRef, { key: "periodFrom", label: "Период с", type: "date" }, { key: "periodTo", label: "по", type: "date" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "reconciliation",
    name: "Акт сверки",
    short: "Сверка",
    category: "financial",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: false,
    hasAmount: true,
    fields: [
      { key: "periodFrom", label: "Период с", type: "date", required: true },
      { key: "periodTo", label: "по", type: "date", required: true },
      { key: "openingBalance", label: "Сальдо на начало", type: "money" },
      { key: "closingBalance", label: "Сальдо на конец", type: "money" },
    ],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "contract",
    name: "Договор",
    short: "Договор",
    category: "contract",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: false,
    hasAmount: true,
    fields: [
      {
        key: "subject",
        label: "Предмет",
        type: "select",
        options: [
          { value: "supply", label: "Поставка" },
          { value: "services", label: "Оказание услуг" },
          { value: "works", label: "Подряд" },
          { value: "lease", label: "Аренда" },
          { value: "energy", label: "Энергоснабжение" },
          { value: "other", label: "Иное" },
        ],
      },
      { key: "validFrom", label: "Действует с", type: "date" },
      { key: "validTo", label: "Действует по", type: "date" },
      { key: "autoProlong", label: "Автопролонгация", type: "boolean" },
      { key: "paymentTerms", label: "Условия оплаты", type: "textarea" },
    ],
    retentionYears: 5,
    retentionBasis: CONTRACT_5Y,
  },
  {
    code: "supplementary",
    name: "Дополнительное соглашение",
    short: "Доп. соглашение",
    category: "contract",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: false,
    hasAmount: true,
    fields: [{ ...contractRef, required: true }, { key: "summary", label: "Изменения", type: "textarea" }],
    retentionYears: 5,
    retentionBasis: CONTRACT_5Y,
  },
  {
    code: "specification",
    name: "Спецификация",
    short: "Спецификация",
    category: "contract",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [{ ...contractRef, required: true }, { key: "deliveryTerms", label: "Условия поставки", type: "textarea" }],
    retentionYears: 5,
    retentionBasis: CONTRACT_5Y,
  },
  {
    code: "contract_appendix",
    name: "Приложение к договору",
    short: "Приложение",
    category: "contract",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: false,
    hasAmount: false,
    fields: [{ ...contractRef, required: true }],
    retentionYears: 5,
    retentionBasis: CONTRACT_5Y,
  },
  {
    code: "disagreement_protocol",
    name: "Протокол разногласий",
    short: "Разногласия",
    category: "contract",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: false,
    hasAmount: false,
    fields: [{ ...contractRef, required: true }, { key: "points", label: "Пункты разногласий", type: "textarea", required: true }],
    retentionYears: 5,
    retentionBasis: CONTRACT_5Y,
  },
  {
    code: "receipt",
    name: "Документ приёмки",
    short: "Приёмка",
    category: "warehouse",
    directions: ["incoming", "internal"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: false,
    fields: [basis, { key: "warehouse", label: "Склад", type: "text" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "shipment",
    name: "Документ отгрузки",
    short: "Отгрузка",
    category: "warehouse",
    directions: ["outgoing", "internal"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [basis, { key: "warehouse", label: "Склад", type: "text" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "writeoff_act",
    name: "Акт списания",
    short: "Списание",
    category: "warehouse",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: true,
    hasAmount: true,
    fields: [{ key: "reason", label: "Причина списания", type: "textarea", required: true }, { key: "commission", label: "Комиссия", type: "textarea" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "discrepancy_act",
    name: "Акт расхождений",
    short: "Расхождения",
    category: "warehouse",
    directions: ["incoming", "outgoing", "internal"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [basis, { key: "findings", label: "Описание расхождений", type: "textarea" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "transfer",
    name: "Документ перемещения",
    short: "Перемещение",
    category: "warehouse",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: true,
    hasAmount: false,
    fields: [{ key: "fromWarehouse", label: "Откуда", type: "text", required: true }, { key: "toWarehouse", label: "Куда", type: "text", required: true }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "accompanying",
    name: "Сопроводительный документ",
    short: "Сопроводит.",
    category: "warehouse",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: false,
    hasAmount: false,
    fields: [basis, { key: "kindNote", label: "Вид (сертификат, паспорт качества…)", type: "text" }],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "memo",
    name: "Служебная записка",
    short: "Записка",
    category: "internal",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: false,
    hasAmount: false,
    fields: [{ key: "addressee", label: "Кому", type: "text", required: true }, { key: "body", label: "Текст", type: "textarea", required: true }],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "request",
    name: "Заявка",
    short: "Заявка",
    category: "internal",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: true,
    hasAmount: true,
    fields: [
      {
        key: "requestKind",
        label: "Вид заявки",
        type: "select",
        options: [
          { value: "purchase", label: "Закупка" },
          { value: "service", label: "Обслуживание" },
          { value: "production", label: "Производство" },
          { value: "other", label: "Иное" },
        ],
      },
      { key: "neededBy", label: "Нужно к", type: "date" },
      { key: "justification", label: "Обоснование", type: "textarea" },
    ],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "application",
    name: "Заявление",
    short: "Заявление",
    category: "internal",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: false,
    hasAmount: false,
    fields: [{ key: "addressee", label: "Кому", type: "text", required: true }, { key: "body", label: "Текст", type: "textarea", required: true }],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "order",
    name: "Приказ",
    short: "Приказ",
    category: "internal",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: false,
    hasAmount: false,
    fields: [{ key: "body", label: "Текст приказа", type: "textarea", required: true }, { key: "effectiveFrom", label: "Вступает в силу", type: "date" }],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "internal_act",
    name: "Акт (внутренний)",
    short: "Акт",
    category: "internal",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: true,
    hasAmount: false,
    fields: [{ key: "body", label: "Содержание", type: "textarea", required: true }],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "protocol",
    name: "Протокол",
    short: "Протокол",
    category: "internal",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: false,
    hasAmount: false,
    fields: [{ key: "participants", label: "Участники", type: "textarea" }, { key: "body", label: "Решения", type: "textarea", required: true }],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "internal_other",
    name: "Внутренний документ",
    short: "Внутренний",
    category: "internal",
    directions: ["internal"],
    hasCounterparty: false,
    hasLines: false,
    hasAmount: false,
    fields: [{ key: "body", label: "Содержание", type: "textarea" }],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "commercial_offer",
    name: "Коммерческое предложение",
    short: "КП",
    category: "commercial",
    directions: ["outgoing", "incoming"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: true,
    fields: [{ key: "validUntil", label: "Действует до", type: "date" }, { key: "terms", label: "Условия", type: "textarea" }],
    retentionYears: 5,
    retentionBasis: INTERNAL_5Y,
  },
  {
    code: "waybill",
    name: "Транспортная накладная",
    short: "ТН",
    category: "logistics",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: false,
    fields: [
      { key: "carrier", label: "Перевозчик", type: "text" },
      { key: "vehicle", label: "Транспортное средство", type: "text" },
      { key: "driver", label: "Водитель", type: "text" },
      { key: "loadingAddress", label: "Адрес погрузки", type: "text" },
      { key: "unloadingAddress", label: "Адрес выгрузки", type: "text" },
    ],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "shipping_spec",
    name: "Отгрузочная спецификация",
    short: "Отгр. спецификация",
    category: "logistics",
    directions: ["outgoing", "incoming"],
    hasCounterparty: true,
    hasLines: true,
    hasAmount: false,
    fields: [basis],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "delivery_confirmation",
    name: "Подтверждение доставки",
    short: "Доставка",
    category: "logistics",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: false,
    hasAmount: false,
    fields: [basis, { key: "deliveredAt", label: "Доставлено", type: "date", required: true }, { key: "receivedBy", label: "Принял", type: "text" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
  {
    code: "freight_doc",
    name: "Документ грузоперевозки",
    short: "Перевозка",
    category: "logistics",
    directions: ["incoming", "outgoing"],
    hasCounterparty: true,
    hasLines: false,
    hasAmount: true,
    fields: [{ key: "carrier", label: "Перевозчик", type: "text" }, { key: "route", label: "Маршрут", type: "text" }],
    retentionYears: 5,
    retentionBasis: ACCOUNTING_5Y,
  },
]

const BY_CODE = new Map(DOC_TYPES.map((t) => [t.code, t]))

export function docType(code: string): DocTypeDef | null {
  return BY_CODE.get(code) ?? null
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  received: "Новый входящий",
  in_review: "На согласовании",
  rework: "На доработке",
  approved: "Согласован",
  rejected: "Отклонён",
  signing: "На подписи",
  signed: "Подписан",
  sent: "Отправлен",
  completed: "Завершён",
  cancelled: "Аннулирован",
}

export const EXCHANGE_LABEL: Record<string, string> = {
  none: "Не отправлялся",
  queued: "В очереди к оператору",
  sent: "Отправлен оператору",
  delivered: "Доставлен контрагенту",
  accepted: "Подписан контрагентом",
  rejected: "Отклонён контрагентом",
  clarification: "Запрошено уточнение",
  error: "Ошибка обмена",
}

export const WMS_STATUS_LABEL: Record<string, string> = {
  draft_created: "Создан заказ на приход WMS",
  receiving: "Склад принимает",
  received: "Принято складом",
  received_with_discrepancies: "Принято с расхождениями",
  link_error: "Ошибка связи с WMS",
}

export const DIRECTION_LABEL: Record<string, string> = {
  incoming: "Входящий",
  outgoing: "Исходящий",
  internal: "Внутренний",
}

/** Переходы жизненного цикла, которые делает сам пользователь (согласование меняет статус через движок маршрутов). */
export const MANUAL_TRANSITIONS: Record<string, string[]> = {
  draft: ["cancelled"],
  received: ["completed", "rejected", "cancelled"],
  rework: ["cancelled"],
  approved: ["signing", "sent", "completed", "cancelled"],
  rejected: ["draft"],
  signing: ["approved"],
  signed: ["sent", "completed"],
  sent: ["completed"],
  completed: [],
  cancelled: [],
  in_review: [],
}

/** Статусы, в которых реквизиты документа можно править (иначе — новая версия/корректировка). */
export function isEditableStatus(status: string): boolean {
  return status === "draft" || status === "rework" || status === "received"
}
