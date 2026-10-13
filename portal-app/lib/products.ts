/**
 * Каталог продуктов экосистемы — единственный источник правды для витрины,
 * формы заявки, админки и раздела «Мои приложения».
 *
 * Статусы выставлены по тому, что подтверждается кодом и документацией
 * репозитория (см. portal-app/README.md, раздел «Аудит»). Владелец меняет их
 * переменными окружения PORTAL_PRODUCT_STATUS_<KEY>, не правя код.
 *
 * Цвета: WMS / ID / QPass / XRAY / GSMT — из утверждённого лаунчера
 * `components/wms/apps-launcher.tsx`, YMS — из темы `yms-app`. Для APS, EMS и
 * Mobile утверждённых цветов в репозитории нет, взяты нейтральные.
 */

export type ProductKey = "wms" | "yms" | "ems" | "qpass" | "aps" | "gsmt" | "xray" | "mobile" | "id"

export type ProductStatus = "live" | "pilot" | "on_request" | "development"

export type CategoryKey =
  | "warehouse"
  | "logistics"
  | "production"
  | "equipment"
  | "marking"
  | "infrastructure"
  | "medicine"
  | "platform"

export type Product = {
  key: ProductKey
  name: string
  short: string
  tagline: string
  description: string
  features: string[]
  /** Ограничения текущей версии — показываются честно на странице продукта. */
  limitations?: string[]
  categories: CategoryKey[]
  status: ProductStatus
  color: string
  onColor: string
  /** Можно ли выбрать продукт в заявке. */
  requestable: boolean
  /** Продукт поставляется в составе другого (доступ выдаётся через родителя). */
  partOf?: ProductKey
  /** Ключ приложения в SCADA ID (application_slug в grants). */
  scadaIdApp: string
  /** Адрес запуска; null — адреса в публичной сети нет. */
  defaultUrl: string | null
  launchPath?: string
  accessNote?: string
}

export const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "warehouse", label: "Склад" },
  { key: "logistics", label: "Логистика" },
  { key: "production", label: "Производство" },
  { key: "equipment", label: "Оборудование" },
  { key: "marking", label: "Маркировка" },
  { key: "infrastructure", label: "Инфраструктура" },
  { key: "medicine", label: "Медицина" },
  { key: "platform", label: "Платформа" },
]

export const STATUS_LABEL: Record<ProductStatus, string> = {
  live: "Работает",
  pilot: "Пилотная версия",
  on_request: "По запросу",
  development: "В разработке",
}

export const STATUS_HINT: Record<ProductStatus, string> = {
  live: "Продукт используется в работе.",
  pilot: "Базовые сценарии работают, функциональность расширяется.",
  on_request: "Подключение после консультации и развёртывания в контуре заказчика.",
  development: "Продукт в разработке. Заявку на подключение пока принять нельзя.",
}

const BASE: Product[] = [
  {
    key: "wms",
    name: "SCADA WMS",
    short: "WMS",
    tagline: "Складской учёт и адресное хранение",
    description:
      "Управление складом материалов и готовой продукции: адресное хранение, приёмка, перемещения, отбор и отгрузка с работой через терминалы сбора данных.",
    features: [
      "Адресное хранение, ячейки и заполненность",
      "Приёмка с ТСД и проверкой маркировки",
      "Перемещения, отбор и отгрузка",
      "Ревизия и инвентаризация",
      "Склад готовой продукции, партии и сроки годности",
      "Обмен с 1С",
    ],
    categories: ["warehouse", "logistics"],
    status: "live",
    color: "#6b7a10",
    onColor: "#ffffff",
    requestable: true,
    scadaIdApp: "scada-wms",
    defaultUrl: "https://wms.scada25.ru",
  },
  {
    key: "yms",
    name: "SCADA YMS",
    short: "YMS",
    tagline: "Транспорт, КПП, доки и погрузка",
    description:
      "Управление транспортными потоками на территории: визиты машин, КПП, стоянки и доки, контроль погрузки по палетам склада.",
    features: [
      "Заявки на визит и очередь со строгой сменой статусов",
      "КПП: въезд, выезд и внеплановый визит по номеру",
      "Назначение доков и стоянок",
      "Закрытие погрузки только после подтверждения палет WMS",
      "Кабинет водителя по ссылке на свой рейс",
    ],
    limitations: [
      "Нет календаря окон, SMS-уведомлений и распознавания номеров",
      "Вход пока по учётной записи WMS",
    ],
    categories: ["logistics"],
    status: "pilot",
    color: "#c6e34a",
    onColor: "#24300a",
    requestable: true,
    scadaIdApp: "scada-yms",
    defaultUrl: "https://yms.scadasystem.io",
  },
  {
    key: "ems",
    name: "SCADA EMS",
    short: "EMS",
    tagline: "Мониторинг энергоресурсов",
    description:
      "Мониторинг расхода электроэнергии и воды, состояния оборудования и уведомления об отклонениях.",
    features: [
      "Учёт расхода электроэнергии и воды",
      "Привязка потребления к оборудованию",
      "Уведомления об отклонениях",
    ],
    categories: ["infrastructure", "equipment"],
    status: "development",
    color: "#b4532a",
    onColor: "#ffffff",
    requestable: false,
    scadaIdApp: "scada-ems",
    defaultUrl: null,
  },
  {
    key: "qpass",
    name: "SCADA QPass",
    short: "QPass",
    tagline: "Электронные паспорта оборудования",
    description:
      "Электронный паспорт для каждой единицы оборудования: документы, история ТО и ремонтов, идентификация по QR-коду.",
    features: [
      "Паспорт оборудования с QR-кодом",
      "Документы и история обслуживания",
      "Учёт ТО и ремонтов",
      "Публичная карточка по сканированию QR",
    ],
    categories: ["equipment"],
    status: "live",
    color: "#bd821a",
    onColor: "#ffffff",
    requestable: true,
    scadaIdApp: "scada-qpass",
    defaultUrl: "https://qpass.scada25.ru",
  },
  {
    key: "aps",
    name: "SCADA APS",
    short: "APS",
    tagline: "Производственное планирование",
    description:
      "План выпуска по линиям, производственный календарь и учёт выпуска партий. Поставляется в составе SCADA WMS.",
    features: [
      "План выпуска по линиям (диаграмма Ганта)",
      "Производственный календарь",
      "Учёт выпуска и партий",
      "Потребность в материалах со склада",
    ],
    categories: ["production"],
    status: "live",
    color: "#5b5bd6",
    onColor: "#ffffff",
    requestable: true,
    partOf: "wms",
    scadaIdApp: "scada-wms",
    defaultUrl: "https://wms.scada25.ru",
    launchPath: "/production-calendar",
    accessNote: "Доступ выдаётся вместе с SCADA WMS.",
  },
  {
    key: "gsmt",
    name: "SCADA GSMT / Code Route",
    short: "GSMT",
    tagline: "Маркировка и коды GS1 DataMatrix",
    description:
      "Инструменты маркировки: заказ кодов, очередь печати этикеток, проверка и анализ кодов GS1 DataMatrix.",
    features: [
      "Заказ кодов маркировки",
      "Очередь печати этикеток",
      "Проверка структуры GS1 DataMatrix",
      "Анализ считанных кодов",
    ],
    categories: ["marking", "production"],
    status: "on_request",
    color: "#1d7970",
    onColor: "#ffffff",
    requestable: true,
    scadaIdApp: "scada-gsmt",
    defaultUrl: null,
    accessNote: "Разворачивается в сети предприятия.",
  },
  {
    key: "xray",
    name: "SCADA XRAY",
    short: "XRAY",
    tagline: "Медицинские исследования и снимки",
    description: "Система управления медицинскими исследованиями и рентгеновскими снимками.",
    features: ["Учёт исследований", "Хранение и просмотр снимков"],
    categories: ["medicine"],
    status: "on_request",
    color: "#3a5c8c",
    onColor: "#ffffff",
    requestable: true,
    scadaIdApp: "scada-xray",
    defaultUrl: null,
  },
  {
    key: "mobile",
    name: "SCADA Mobile",
    short: "Mobile",
    tagline: "Мобильные терминалы и ТСД",
    description:
      "Android-приложение для терминалов сбора данных: складские операции со сканера, в том числе без постоянной связи.",
    features: [
      "Приёмка, перемещение и отбор со сканера",
      "Работа без сети с последующей синхронизацией",
      "Чтение штрихкодов и DataMatrix",
      "Профиль оператора",
    ],
    categories: ["platform", "warehouse"],
    status: "live",
    color: "#334155",
    onColor: "#ffffff",
    requestable: true,
    partOf: "wms",
    scadaIdApp: "scada-wms",
    defaultUrl: "https://wms.scada25.ru",
    launchPath: "/mobile",
    accessNote: "Доступ выдаётся вместе с SCADA WMS.",
  },
  {
    key: "id",
    name: "SCADA ID",
    short: "ID",
    tagline: "Единая учётная запись и доступы",
    description:
      "Идентификация пользователей, единый вход во все продукты и управление доступами по организациям.",
    features: [
      "Единый вход по OpenID Connect",
      "Роли и права по приложениям",
      "Организации и площадки",
      "Приглашения новых пользователей",
    ],
    categories: ["platform"],
    status: "live",
    color: "#4c5268",
    onColor: "#ffffff",
    requestable: false,
    scadaIdApp: "scada-id",
    defaultUrl: "https://id.scada25.ru",
    accessNote: "Учётная запись SCADA ID создаётся автоматически при одобрении заявки.",
  },
]

const STATUSES: ProductStatus[] = ["live", "pilot", "on_request", "development"]

function envOverride(key: ProductKey, suffix: string): string | undefined {
  if (typeof process === "undefined") return undefined
  const v = process.env[`PORTAL_${suffix}_${key.toUpperCase()}`]
  return v && v.trim() ? v.trim() : undefined
}

function withOverrides(p: Product): Product {
  const status = envOverride(p.key, "PRODUCT_STATUS") as ProductStatus | undefined
  const url = envOverride(p.key, "APP_URL")
  const app = envOverride(p.key, "SCADA_ID_APP")
  const next = { ...p }
  if (status && STATUSES.includes(status)) {
    next.status = status
    if (status === "development") next.requestable = false
  }
  if (url) next.defaultUrl = url === "none" ? null : url
  if (app) next.scadaIdApp = app
  return next
}

export function products(): Product[] {
  return BASE.map(withOverrides)
}

export const PRODUCT_KEYS = BASE.map((p) => p.key)

export function productByKey(key: string): Product | undefined {
  return products().find((p) => p.key === key)
}

export function requestableProducts(): Product[] {
  return products().filter((p) => p.requestable)
}

export function launchUrl(p: Product): string | null {
  if (!p.defaultUrl) return null
  return `${p.defaultUrl.replace(/\/$/, "")}${p.launchPath || ""}`
}

export type Integration = {
  a: ProductKey
  b: ProductKey
  state: "live" | "planned"
  label: string
}

/**
 * Связи между продуктами. `live` — подтверждено кодом (см. README, «Аудит»),
 * `planned` — заявлено, но в коде не реализовано.
 */
export const INTEGRATIONS: Integration[] = [
  { a: "id", b: "wms", state: "live", label: "Вход в WMS через SCADA ID" },
  { a: "wms", b: "yms", state: "live", label: "YMS читает заказы и палеты WMS" },
  { a: "wms", b: "aps", state: "live", label: "План выпуска и материалы склада" },
  { a: "wms", b: "qpass", state: "live", label: "Паспорт QPass в карточке номенклатуры" },
  { a: "wms", b: "gsmt", state: "live", label: "Заказ и проверка кодов маркировки" },
  { a: "wms", b: "mobile", state: "live", label: "Операции склада с ТСД" },
  { a: "id", b: "yms", state: "planned", label: "Вход в YMS через SCADA ID" },
  { a: "id", b: "qpass", state: "planned", label: "Вход в QPass через SCADA ID" },
  { a: "id", b: "xray", state: "planned", label: "Вход в XRAY через SCADA ID" },
  { a: "ems", b: "qpass", state: "planned", label: "Потребление на паспорте оборудования" },
  { a: "id", b: "ems", state: "planned", label: "Вход в EMS через SCADA ID" },
]

export type Scenario = {
  title: string
  chain: ProductKey[]
  state: "live" | "planned"
  text: string
}

export const SCENARIOS: Scenario[] = [
  {
    title: "Склад и транспорт",
    chain: ["wms", "yms"],
    state: "live",
    text: "Диспетчер видит заказ отгрузки из WMS и назначает док. Погрузка закрывается только после того, как склад подтвердил палеты.",
  },
  {
    title: "Производство и склад",
    chain: ["aps", "wms"],
    state: "live",
    text: "План выпуска по линиям опирается на остатки материалов, а выпуск партий попадает на склад готовой продукции.",
  },
  {
    title: "Склад и оборудование",
    chain: ["wms", "qpass"],
    state: "live",
    text: "Карточка номенклатуры связана с электронным паспортом QPass: документы и QR-код доступны прямо со склада.",
  },
  {
    title: "Маркировка на приёмке",
    chain: ["gsmt", "wms", "mobile"],
    state: "live",
    text: "Коды маркировки заказываются и проверяются, а кладовщик сканирует DataMatrix на ТСД при приёмке.",
  },
  {
    title: "Энергия и оборудование",
    chain: ["ems", "qpass"],
    state: "planned",
    text: "Расход электроэнергии и воды по каждой единице оборудования на его электронном паспорте.",
  },
]
