import type { PoolClient } from "pg"

/**
 * Справочные данные, которые нужны для работы с первого запуска. Это не демо-документы:
 * реестр форматов, тарифные планы (без цен) и системные шаблоны. Администратор правит всё в интерфейсе,
 * повторный запуск не перезаписывает изменения (ON CONFLICT DO NOTHING).
 */

export const FORMAT_SEED = [
  {
    code: "fns_upd_5_03",
    name: "Счёт-фактура / УПД, формат 5.03",
    docTypes: ["upd", "invoice_fact"],
    knd: "1115131",
    version: "5.03",
    validFrom: "2025-01-23",
    validTo: null,
    legalBasis: "Приказ ФНС от 19.12.2023 № ЕД-7-26/970@ (прил. 1) в ред. № ЕД-7-26/1032@ от 15.11.2024",
    note: "Обязателен с 01.04.2025. Дату и редакцию сверьте с nalog.gov.ru; администратор может изменить период.",
  },
  {
    code: "fns_upd_5_01",
    name: "Счёт-фактура / УПД, формат 5.01",
    docTypes: ["upd", "invoice_fact"],
    knd: "1115131",
    version: "5.01",
    validFrom: "2019-07-01",
    validTo: "2025-03-31",
    legalBasis: "Приказ ФНС от 19.12.2018 № ММВ-7-15/820@; прил. 2 к № ЕД-7-26/970@",
    note: "После 31.03.2025 допускается только для завершения документооборота, начатого до 01.04.2025.",
  },
]

export const PLAN_SEED = [
  {
    code: "trial",
    name: "Free / Trial",
    sort: 1,
    limits: { users: 3, documentsPerMonth: 100, storageMb: 500, trialDays: 30 },
    features: { workflows: false, integrations: false, edo: false, analytics: false, webhooks: false, customRoutes: false, templatesCustom: false },
  },
  {
    code: "business",
    name: "Business",
    sort: 2,
    limits: { users: 15, documentsPerMonth: 2000, storageMb: 10240 },
    features: { workflows: true, integrations: false, edo: false, analytics: false, webhooks: false, customRoutes: false, templatesCustom: true },
  },
  {
    code: "professional",
    name: "Professional",
    sort: 3,
    limits: { users: 50, documentsPerMonth: 20000, storageMb: 102400 },
    features: { workflows: true, integrations: true, edo: true, analytics: true, webhooks: true, customRoutes: false, templatesCustom: true },
  },
  {
    code: "enterprise",
    name: "Enterprise",
    sort: 4,
    limits: { users: null, documentsPerMonth: null, storageMb: null },
    features: { workflows: true, integrations: true, edo: true, analytics: true, webhooks: true, customRoutes: true, templatesCustom: true },
  },
]

const PRICE_NOTE =
  "Цена не утверждена: нужен расчёт себестоимости (оператор ЭДО, сервис подписи, хранение, OCR, поддержка)."

type TemplateSeed = {
  code: string
  name: string
  docType: string
  schema: Record<string, unknown>
  layout: Record<string, unknown>
  numbering: Record<string, unknown>
}

const SUPPLY_CONTRACT_BODY = [
  "1. ПРЕДМЕТ ДОГОВОРА",
  "1.1. Поставщик обязуется передать в собственность Покупателя товар, а Покупатель — принять и оплатить его на условиях настоящего договора.",
  "1.2. Наименование, количество, цена и сроки поставки товара согласуются в спецификациях, являющихся неотъемлемой частью договора.",
  "2. ЦЕНА И ПОРЯДОК РАСЧЁТОВ",
  "2.1. {{fields.paymentTerms}}",
  "3. СРОК ДЕЙСТВИЯ",
  "3.1. Договор действует с {{fields.validFrom}} по {{fields.validTo}}.",
  "4. РЕКВИЗИТЫ СТОРОН",
].join("\n")

export const TEMPLATE_SEED: TemplateSeed[] = [
  {
    code: "supply_contract",
    name: "Договор поставки",
    docType: "contract",
    schema: { defaults: { subject: "supply", autoProlong: true }, required: ["validFrom", "validTo"], body: SUPPLY_CONTRACT_BODY },
    layout: { showLogo: true, signatures: ["Поставщик", "Покупатель"] },
    numbering: { prefix: "Д-", pattern: "{prefix}{year}-{seq:4}", reset: "year" },
  },
  {
    code: "invoice",
    name: "Счёт на оплату",
    docType: "invoice",
    schema: { defaults: {}, required: ["paymentDue"], showBank: true },
    layout: { showLogo: true, signatures: ["Руководитель", "Главный бухгалтер"] },
    numbering: { prefix: "", pattern: "{seq}", reset: "year" },
  },
  {
    code: "act_works",
    name: "Акт выполненных работ",
    docType: "act_works",
    schema: { defaults: {}, required: ["contractNumber"] },
    layout: { showLogo: false, signatures: ["Исполнитель", "Заказчик"] },
    numbering: { prefix: "А-", pattern: "{prefix}{seq}", reset: "year" },
  },
  {
    code: "application",
    name: "Заявление",
    docType: "application",
    schema: { defaults: {}, required: ["addressee", "body"] },
    layout: { showLogo: false, signatures: ["Заявитель"] },
    numbering: { prefix: "З-", pattern: "{prefix}{seq}", reset: "year" },
  },
  {
    code: "memo",
    name: "Служебная записка",
    docType: "memo",
    schema: { defaults: {}, required: ["addressee", "body"] },
    layout: { showLogo: false, signatures: ["Автор"] },
    numbering: { prefix: "СЗ-", pattern: "{prefix}{seq}", reset: "year" },
  },
  {
    code: "commercial_offer",
    name: "Коммерческое предложение",
    docType: "commercial_offer",
    schema: { defaults: {}, required: ["validUntil"] },
    layout: { showLogo: true, signatures: ["Руководитель"] },
    numbering: { prefix: "КП-", pattern: "{prefix}{seq}", reset: "year" },
  },
  {
    code: "purchase_request",
    name: "Заявка на закупку",
    docType: "request",
    schema: { defaults: { requestKind: "purchase" }, required: ["neededBy"] },
    layout: { showLogo: false, signatures: ["Инициатор", "Руководитель"] },
    numbering: { prefix: "ЗЗ-", pattern: "{prefix}{seq}", reset: "year" },
  },
  {
    code: "discrepancy_act",
    name: "Акт расхождений",
    docType: "discrepancy_act",
    schema: { defaults: {}, required: ["findings"] },
    layout: { showLogo: false, signatures: ["Представитель получателя", "Представитель поставщика"] },
    numbering: { prefix: "АР-", pattern: "{prefix}{seq}", reset: "year" },
  },
]

export async function seedReference(client: PoolClient): Promise<void> {
  for (const f of FORMAT_SEED) {
    await client.query(
      `INSERT INTO edi_formats (format_code, name, doc_types, knd, version, valid_from, valid_to, legal_basis, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (format_code) DO NOTHING`,
      [f.code, f.name, f.docTypes, f.knd, f.version, f.validFrom, f.validTo, f.legalBasis, f.note]
    )
  }
  for (const p of PLAN_SEED) {
    await client.query(
      `INSERT INTO edi_plans (plan_code, name, limits, features, price_note, sort_order)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6) ON CONFLICT (plan_code) DO NOTHING`,
      [p.code, p.name, JSON.stringify(p.limits), JSON.stringify(p.features), PRICE_NOTE, p.sort]
    )
  }
  for (const t of TEMPLATE_SEED) {
    await client.query(
      `INSERT INTO edi_templates (site_id, code, name, doc_type, version, schema, layout, numbering)
       SELECT NULL, $1, $2, $3, 1, $4::jsonb, $5::jsonb, $6::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM edi_templates WHERE site_id IS NULL AND code = $1)`,
      [t.code, t.name, t.docType, JSON.stringify(t.schema), JSON.stringify(t.layout), JSON.stringify(t.numbering)]
    )
  }
}
