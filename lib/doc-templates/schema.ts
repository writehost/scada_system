/**
 * Схема данных шаблонов. Редактор строит по ней выбор переменных и не знает
 * заранее ни одного поля — один и тот же дизайнер работает для WMS, QMS, MES, QPass.
 */

export type FieldType = "string" | "number" | "money" | "date" | "boolean" | "image" | "barcode" | "object" | "collection"

export type SchemaField = {
  label: string
  type: FieldType
  /** Для object. */
  fields?: Record<string, SchemaField>
  /** Для collection — поля одного элемента. */
  item?: Record<string, SchemaField>
  /** Имя переменной элемента цикла по умолчанию (`item`, `row`, `test`). */
  itemVar?: string
  description?: string
}

export type DataSchema = Record<string, SchemaField>

export type SampleDataset = { id: string; label: string; data: Record<string, unknown> }

export type DocumentKind = {
  id: string
  label: string
  description: string
  schemaVersion: number
  schema: DataSchema
  samples: SampleDataset[]
  /** Можно ли брать данные из реальных документов WMS. */
  wmsDocuments?: boolean
}

const s = (label: string): SchemaField => ({ label, type: "string" })
const n = (label: string): SchemaField => ({ label, type: "number" })
const money = (label: string): SchemaField => ({ label, type: "money" })
const d = (label: string): SchemaField => ({ label, type: "date" })
const img = (label: string): SchemaField => ({ label, type: "image" })
const obj = (label: string, fields: Record<string, SchemaField>): SchemaField => ({ label, type: "object", fields })
const coll = (label: string, itemVar: string, item: Record<string, SchemaField>): SchemaField => ({
  label,
  type: "collection",
  itemVar,
  item,
})

function orgFields(): Record<string, SchemaField> {
  return {
    name: s("Название"),
    short_name: s("Краткое название"),
    inn: s("ИНН"),
    kpp: s("КПП"),
    ogrn: s("ОГРН"),
    address: s("Адрес"),
    phone: s("Телефон"),
    email: s("E-mail"),
    bank_name: s("Банк"),
    bik: s("БИК"),
    account: s("Расчётный счёт"),
    corr_account: s("Корр. счёт"),
    director: s("Руководитель"),
    accountant: s("Главный бухгалтер"),
    responsible: s("Ответственный"),
    responsible_position: s("Должность ответственного"),
    signature_image: img("Подпись (изображение)"),
    stamp_image: img("Печать (изображение)"),
    logo: img("Логотип"),
  }
}

const PAGE_FIELD = obj("Страница", {
  number: n("Номер страницы"),
  total: n("Всего страниц"),
})

const PRINT_FIELD = obj("Печать", {
  date: d("Дата печати"),
  user: s("Кто печатает"),
})

const tradeItem: Record<string, SchemaField> = {
  name: s("Наименование"),
  code: s("Код"),
  gtin: { label: "GTIN", type: "barcode" },
  unit: s("Ед. изм."),
  quantity: n("Количество"),
  price: money("Цена"),
  vat_rate: s("Ставка НДС"),
  vat_amount: money("Сумма НДС"),
  amount: money("Сумма"),
  country: s("Страна происхождения"),
  batch: s("Партия"),
  expiry_date: d("Годен до"),
  marking_code: { label: "Код маркировки", type: "barcode" },
}

const TRADE_SCHEMA: DataSchema = {
  document: obj("Документ", {
    number: s("Номер"),
    date: d("Дата"),
    status: s("Статус"),
    type: s("Вид документа"),
    basis: s("Основание"),
    comment: s("Комментарий"),
    currency: s("Валюта"),
    total: money("Итого"),
    total_without_vat: money("Итого без НДС"),
    vat_total: money("Итого НДС"),
    total_in_words: s("Сумма прописью"),
    url: s("Ссылка на документ"),
    items: coll("Позиции", "item", tradeItem),
  }),
  organization: obj("Организация", orgFields()),
  seller: obj("Продавец", orgFields()),
  buyer: obj("Покупатель", orgFields()),
  consignee: obj("Грузополучатель", { name: s("Название"), address: s("Адрес") }),
  page: PAGE_FIELD,
  print: PRINT_FIELD,
}

const DEMO_ITEMS = [
  {
    name: "Вода питьевая «Славда» 0,5 л",
    code: "SL-05",
    gtin: "04607012345677",
    unit: "шт",
    quantity: 100,
    price: 52.4,
    vat_rate: "20%",
    vat_amount: 873.33,
    amount: 5240,
    country: "Россия",
    batch: "2610-01",
    expiry_date: "2027-10-01",
    marking_code: "0104607012345677215AbCdE\u001d93dGVz",
  },
  {
    name: "Вода детская «Славда» 0,33 л",
    code: "SLD-033",
    gtin: "04607112345676",
    unit: "шт",
    quantity: 50,
    price: 48.1,
    vat_rate: "20%",
    vat_amount: 400.83,
    amount: 2405,
    country: "Россия",
    batch: "2610-02",
    expiry_date: "2027-09-15",
    marking_code: "0104607112345676215XyZ12\u001d93aBcD",
  },
  {
    name: "Вода минеральная «Славда» 1,5 л",
    code: "SLM-15",
    gtin: "04607212345675",
    unit: "шт",
    quantity: 24,
    price: 89.9,
    vat_rate: "20%",
    vat_amount: 359.6,
    amount: 2157.6,
    country: "Россия",
    batch: "2609-11",
    expiry_date: "2027-06-30",
    marking_code: "0104607212345675215QwErT\u001d93zXcV",
  },
]

const SKIT = {
  name: "ООО «СКИТ»",
  short_name: "СКИТ",
  inn: "7701234567",
  kpp: "770101001",
  ogrn: "1027700000000",
  address: "125009, г. Москва, ул. Тверская, д. 1",
  phone: "+7 (495) 000-00-00",
  email: "info@skit.example",
  bank_name: "ПАО «Банк»",
  bik: "044525000",
  account: "40702810000000000001",
  corr_account: "30101810400000000225",
  director: "Иванов И. И.",
  accountant: "Петрова А. С.",
  responsible: "Сидоров П. А.",
  responsible_position: "Начальник склада",
  signature_image: "",
  stamp_image: "",
  logo: "",
}

const BUYER = {
  name: "ООО «Торговый дом Север»",
  short_name: "ТД Север",
  inn: "7812345678",
  kpp: "781201001",
  ogrn: "1157800000000",
  address: "191186, г. Санкт-Петербург, Невский пр., д. 10",
  phone: "+7 (812) 000-00-00",
  email: "zakaz@sever.example",
  bank_name: "АО «Банк Север»",
  bik: "044030000",
  account: "40702810900000000002",
  corr_account: "30101810900000000700",
  director: "Смирнов А. В.",
  accountant: "Кузнецова Е. Н.",
  responsible: "Орлов Д. С.",
  responsible_position: "Кладовщик",
  signature_image: "",
  stamp_image: "",
  logo: "",
}

function tradeSample(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    document: {
      number: "123",
      date: "2026-10-05",
      status: "APPROVED",
      type: "УПД",
      basis: "Договор поставки № 15 от 10.01.2026",
      comment: "Доставка до 12:00, въезд с ул. Лесной",
      currency: "RUB",
      total: 9802.6,
      total_without_vat: 8168.84,
      vat_total: 1633.76,
      total_in_words: "Девять тысяч восемьсот два рубля 60 копеек",
      url: "https://wms.scada25.ru/s/upd-123",
      items: DEMO_ITEMS,
      ...over,
    },
    organization: SKIT,
    seller: SKIT,
    buyer: BUYER,
    consignee: { name: BUYER.name, address: "г. Санкт-Петербург, ул. Складская, д. 5" },
    print: { date: "2026-10-06", user: "Иванов И. И." },
  }
}

const QUALITY_SCHEMA: DataSchema = {
  document: obj("Документ", {
    number: s("Номер"),
    date: d("Дата"),
    status: s("Статус"),
    comment: s("Заключение"),
    url: s("Ссылка на документ"),
  }),
  organization: obj("Организация", orgFields()),
  product: obj("Продукция", {
    name: s("Наименование"),
    gtin: { label: "GTIN", type: "barcode" },
    batch: s("Партия"),
    quantity: n("Количество"),
    unit: s("Ед. изм."),
    production_date: d("Дата производства"),
    expiry_date: d("Годен до"),
    standard: s("ГОСТ / ТУ"),
  }),
  tests: coll("Показатели", "test", {
    parameter: s("Показатель"),
    norm: s("Норма"),
    actual: s("Фактически"),
    unit: s("Ед. изм."),
    method: s("Метод"),
    result: s("Результат"),
  }),
  responsible: obj("Ответственный", { name: s("ФИО"), short_name: s("Фамилия И. О."), position: s("Должность"), signature_image: img("Подпись") }),
  page: PAGE_FIELD,
  print: PRINT_FIELD,
}

const EQUIPMENT_SCHEMA: DataSchema = {
  equipment: obj("Оборудование", {
    name: s("Наименование"),
    model: s("Модель"),
    serial: s("Заводской номер"),
    inventory_number: s("Инвентарный номер"),
    manufacturer: s("Изготовитель"),
    year: n("Год выпуска"),
    location: s("Место установки"),
    commissioning_date: d("Ввод в эксплуатацию"),
    url: s("Ссылка на карточку"),
    parameters: coll("Технические характеристики", "param", { name: s("Параметр"), value: s("Значение"), unit: s("Ед. изм.") }),
    maintenance: coll("Обслуживание", "record", { date: d("Дата"), kind: s("Вид работ"), performer: s("Исполнитель"), note: s("Примечание") }),
  }),
  organization: obj("Организация", orgFields()),
  responsible: obj("Ответственный", { name: s("ФИО"), short_name: s("Фамилия И. О."), position: s("Должность") }),
  page: PAGE_FIELD,
  print: PRINT_FIELD,
}

const PRODUCTION_SCHEMA: DataSchema = {
  order: obj("Задание", {
    number: s("Номер"),
    date: d("Дата"),
    status: s("Статус"),
    line: s("Линия"),
    shift: s("Смена"),
    product_name: s("Продукция"),
    gtin: { label: "GTIN", type: "barcode" },
    planned_qty: n("План, шт"),
    unit: s("Ед. изм."),
    due_date: d("Срок"),
    comment: s("Комментарий"),
    url: s("Ссылка на задание"),
    operations: coll("Операции", "op", {
      seq: n("№"),
      name: s("Операция"),
      workcenter: s("Участок"),
      duration_min: n("Длительность, мин"),
      operator: s("Исполнитель"),
    }),
    materials: coll("Материалы", "mat", { name: s("Материал"), code: s("Код"), quantity: n("Количество"), unit: s("Ед. изм.") }),
  }),
  organization: obj("Организация", orgFields()),
  responsible: obj("Мастер", { name: s("ФИО"), short_name: s("Фамилия И. О."), position: s("Должность") }),
  page: PAGE_FIELD,
  print: PRINT_FIELD,
}

const WAREHOUSE_SCHEMA: DataSchema = {
  document: obj("Документ", {
    number: s("Номер"),
    date: d("Дата"),
    type: s("Тип"),
    status: s("Статус"),
    comment: s("Комментарий"),
    source_warehouse: s("Склад-отправитель"),
    target_warehouse: s("Склад-получатель"),
    source_location: s("Ячейка-источник"),
    target_location: s("Ячейка-приёмник"),
    line_name: s("Линия / участок"),
    operator: s("Оператор"),
    external_ref: s("Номер в 1С"),
    url: s("Ссылка на документ"),
    items: coll("Строки", "item", {
      line_no: n("№ строки"),
      name: s("Наименование"),
      code: s("Код"),
      quantity: n("Количество"),
      confirmed_quantity: n("Подтверждено"),
      unit: s("Ед. изм."),
      lot: s("Партия"),
      source_location: s("Откуда"),
      target_location: s("Куда"),
      load_unit: s("Грузоместо"),
      comment: s("Комментарий"),
    }),
  }),
  organization: obj("Организация", orgFields()),
  page: PAGE_FIELD,
  print: PRINT_FIELD,
}

const LABELS_SCHEMA: DataSchema = {
  sheet: obj("Лист", { title: s("Заголовок"), date: d("Дата") }),
  labels: coll("Этикетки", "label", {
    name: s("Наименование"),
    gtin: { label: "GTIN", type: "barcode" },
    marking_code: { label: "Код маркировки", type: "barcode" },
    batch: s("Партия"),
    production_date: d("Дата производства"),
    expiry_date: d("Годен до"),
    weight: s("Масса / объём"),
  }),
  organization: obj("Организация", orgFields()),
  page: PAGE_FIELD,
}

export const DOCUMENT_KINDS: DocumentKind[] = [
  {
    id: "trade",
    label: "Торговые документы",
    description: "УПД, накладная, счёт, акт",
    schemaVersion: 1,
    schema: TRADE_SCHEMA,
    samples: [
      { id: "upd-123", label: "Тестовый УПД № 123", data: tradeSample() },
      {
        id: "invoice-no-comment",
        label: "Счёт № 45 без комментария",
        data: tradeSample({ number: "45", type: "Счёт", status: "DRAFT", comment: "", items: DEMO_ITEMS.slice(0, 1), total: 5240, vat_total: 873.33, total_without_vat: 4366.67, total_in_words: "Пять тысяч двести сорок рублей 00 копеек" }),
      },
      {
        id: "upd-long",
        label: "УПД № 124 на 60 позиций (несколько листов)",
        data: tradeSample({
          number: "124",
          items: Array.from({ length: 60 }, (_, i) => ({ ...DEMO_ITEMS[i % 3], name: `${DEMO_ITEMS[i % 3].name} · поз. ${i + 1}` })),
        }),
      },
    ],
  },
  {
    id: "quality",
    label: "Качество (QMS)",
    description: "Сертификат качества, протокол испытаний, отчёт QMS",
    schemaVersion: 1,
    schema: QUALITY_SCHEMA,
    samples: [
      {
        id: "cert-2610",
        label: "Сертификат качества партии 2610-01",
        data: {
          document: { number: "КК-2610-01", date: "2026-10-03", status: "APPROVED", comment: "Партия соответствует требованиям ГОСТ 32220-2013", url: "https://wms.scada25.ru/s/qc-2610-01" },
          organization: SKIT,
          product: { name: "Вода питьевая «Славда» 0,5 л", gtin: "04607012345677", batch: "2610-01", quantity: 12000, unit: "шт", production_date: "2026-10-01", expiry_date: "2027-10-01", standard: "ГОСТ 32220-2013" },
          tests: [
            { parameter: "Общая минерализация", norm: "200–500", actual: "312", unit: "мг/дм³", method: "ГОСТ 18164", result: "Соответствует" },
            { parameter: "Водородный показатель (pH)", norm: "6,5–8,5", actual: "7,4", unit: "ед. pH", method: "ПНД Ф 14.1:2:3:4.121", result: "Соответствует" },
            { parameter: "Жёсткость общая", norm: "≤ 7,0", actual: "3,1", unit: "°Ж", method: "ГОСТ 31954", result: "Соответствует" },
            { parameter: "ОМЧ", norm: "≤ 20", actual: "< 1", unit: "КОЕ/мл", method: "МУК 4.2.1018", result: "Соответствует" },
          ],
          responsible: { name: "Белова Ольга Николаевна", short_name: "Белова О. Н.", position: "Начальник ОТК", signature_image: "" },
          print: { date: "2026-10-06", user: "Белова О. Н." },
        },
      },
    ],
  },
  {
    id: "equipment",
    label: "Паспорт оборудования",
    description: "Паспорт, карточка оборудования, журнал ТО",
    schemaVersion: 1,
    schema: EQUIPMENT_SCHEMA,
    samples: [
      {
        id: "filler-01",
        label: "Розливочный автомат РА-12",
        data: {
          equipment: {
            name: "Автомат розлива РА-12",
            model: "РА-12/0,5",
            serial: "SN-2021-00457",
            inventory_number: "ОС-000123",
            manufacturer: "ООО «ПромМаш»",
            year: 2021,
            location: "Цех № 1, линия 2",
            commissioning_date: "2021-06-15",
            url: "https://wms.scada25.ru/s/eq-123",
            parameters: [
              { name: "Производительность", value: "6000", unit: "бут/ч" },
              { name: "Мощность", value: "7,5", unit: "кВт" },
              { name: "Объём тары", value: "0,33–1,5", unit: "л" },
            ],
            maintenance: [
              { date: "2026-03-10", kind: "ТО-1", performer: "Кузьмин А. А.", note: "Замена уплотнений" },
              { date: "2026-09-02", kind: "ТО-2", performer: "Кузьмин А. А.", note: "" },
            ],
          },
          organization: SKIT,
          responsible: { name: "Кузьмин Алексей Андреевич", short_name: "Кузьмин А. А.", position: "Главный механик" },
          print: { date: "2026-10-06", user: "Кузьмин А. А." },
        },
      },
    ],
  },
  {
    id: "production",
    label: "Производство (MES)",
    description: "Задание на производство, маршрутный лист",
    schemaVersion: 1,
    schema: PRODUCTION_SCHEMA,
    samples: [
      {
        id: "po-777",
        label: "Задание № 777 на линию 2",
        data: {
          order: {
            number: "777",
            date: "2026-10-06",
            status: "RELEASED",
            line: "Линия 2",
            shift: "Дневная",
            product_name: "Вода питьевая «Славда» 0,5 л",
            gtin: "04607012345677",
            planned_qty: 12000,
            unit: "шт",
            due_date: "2026-10-07",
            comment: "",
            url: "https://wms.scada25.ru/s/po-777",
            operations: [
              { seq: 10, name: "Выдув преформ", workcenter: "Выдув", duration_min: 120, operator: "Носов К." },
              { seq: 20, name: "Розлив", workcenter: "РА-12", duration_min: 180, operator: "Фомина Л." },
              { seq: 30, name: "Маркировка и упаковка", workcenter: "Упаковка", duration_min: 150, operator: "Гусев Р." },
            ],
            materials: [
              { name: "Преформа 28 г", code: "PF-28", quantity: 12100, unit: "шт" },
              { name: "Крышка 28 мм", code: "CP-28", quantity: 12100, unit: "шт" },
              { name: "Этикетка «Славда» 0,5", code: "LB-05", quantity: 12100, unit: "шт" },
            ],
          },
          organization: SKIT,
          responsible: { name: "Носов Кирилл Петрович", short_name: "Носов К. П.", position: "Мастер смены" },
          print: { date: "2026-10-06", user: "Носов К. П." },
        },
      },
    ],
  },
  {
    id: "warehouse",
    label: "Складские документы (WMS)",
    description: "Приёмка, перемещение, выдача — по реальным документам WMS",
    schemaVersion: 1,
    schema: WAREHOUSE_SCHEMA,
    wmsDocuments: true,
    samples: [
      {
        id: "transfer-demo",
        label: "Перемещение № ПМ-58 (пример)",
        data: {
          document: {
            number: "ПМ-58",
            date: "2026-10-05",
            type: "Перемещение",
            status: "Выполнен",
            comment: "",
            source_warehouse: "Склад материалов",
            target_warehouse: "Цех",
            source_location: "A-01-02",
            target_location: "LINE-2",
            line_name: "Линия 2",
            operator: "Сидоров П. А.",
            external_ref: "00-000123",
            url: "https://wms.scada25.ru/documents/58",
            items: [
              { line_no: 1, name: "Преформа 28 г", code: "PF-28", quantity: 12100, confirmed_quantity: 12100, unit: "шт", lot: "PF-2609", source_location: "A-01-02", target_location: "LINE-2", load_unit: "PAL-0012", comment: "" },
              { line_no: 2, name: "Крышка 28 мм", code: "CP-28", quantity: 12100, confirmed_quantity: 12000, unit: "шт", lot: "CP-2609", source_location: "A-02-01", target_location: "LINE-2", load_unit: "PAL-0013", comment: "Недостача 100 шт" },
            ],
          },
          organization: SKIT,
          print: { date: "2026-10-06", user: "Сидоров П. А." },
        },
      },
    ],
  },
  {
    id: "labels",
    label: "Этикеточный лист",
    description: "Лист этикеток с кодами маркировки",
    schemaVersion: 1,
    schema: LABELS_SCHEMA,
    samples: [
      {
        id: "labels-demo",
        label: "6 этикеток партии 2610-01",
        data: {
          sheet: { title: "Этикетки партии 2610-01", date: "2026-10-06" },
          labels: Array.from({ length: 6 }, (_, i) => ({
            name: "Вода питьевая «Славда» 0,5 л",
            gtin: "04607012345677",
            marking_code: `010460701234567721${String(1000 + i)}AbC\u001d93dGVz`,
            batch: "2610-01",
            production_date: "2026-10-01",
            expiry_date: "2027-10-01",
            weight: "0,5 л",
          })),
          organization: SKIT,
        },
      },
    ],
  },
]

export const DEFAULT_KIND_ID = "trade"

export function getDocumentKind(id: string | null | undefined): DocumentKind {
  return DOCUMENT_KINDS.find((k) => k.id === id) ?? DOCUMENT_KINDS.find((k) => k.id === DEFAULT_KIND_ID)!
}

export function listDocumentKinds() {
  return DOCUMENT_KINDS.map((k) => ({
    id: k.id,
    label: k.label,
    description: k.description,
    schemaVersion: k.schemaVersion,
    wmsDocuments: !!k.wmsDocuments,
    samples: k.samples.map((s) => ({ id: s.id, label: s.label })),
  }))
}

export type FlatField = { path: string; label: string; groupLabel: string; type: FieldType; collection?: boolean }

/** Плоский список путей схемы: для подписи переменных в редакторе. */
export function flattenSchema(schema: DataSchema, prefix = "", group = ""): FlatField[] {
  const out: FlatField[] = []
  for (const [key, field] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (field.type === "object" && field.fields) {
      out.push(...flattenSchema(field.fields, path, field.label))
    } else {
      out.push({ path, label: field.label, groupLabel: group, type: field.type, collection: field.type === "collection" })
    }
  }
  return out
}

/** Все коллекции схемы с полями элемента: источники для циклов и таблиц данных. */
export function listCollections(schema: DataSchema, prefix = "", group = ""): { path: string; label: string; itemVar: string; item: Record<string, SchemaField> }[] {
  const out: { path: string; label: string; itemVar: string; item: Record<string, SchemaField> }[] = []
  for (const [key, field] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (field.type === "collection" && field.item) {
      out.push({ path, label: group ? `${group} → ${field.label}` : field.label, itemVar: field.itemVar ?? "item", item: field.item })
    } else if (field.type === "object" && field.fields) {
      out.push(...listCollections(field.fields, path, field.label))
    }
  }
  return out
}
