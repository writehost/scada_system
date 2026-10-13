import Link from "next/link"
import { productByKey, SCENARIOS, type ProductKey } from "@/lib/products"
import { ProductIcon } from "./brand"

function SectionHead({ eyebrow, title, lead, id }: { eyebrow: string; title: string; lead?: string; id: string }) {
  return (
    <div className="max-w-3xl">
      <p className="eyebrow text-brand-600">{eyebrow}</p>
      <h2 id={id} className="h-section mt-3">{title}</h2>
      {lead && <p className="mt-4 text-lg leading-relaxed text-slate-text">{lead}</p>}
    </div>
  )
}

const ADVANTAGES = [
  {
    title: "Один SCADA ID",
    text: "Одна учётная запись для всех продуктов. Права выдаются по приложениям и организациям, без отдельных паролей в каждой системе.",
    icon: <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4.5" />,
  },
  {
    title: "Модульный подход",
    text: "Подключайте только нужные продукты: склад сегодня, транспорт или паспорта оборудования — когда понадобятся.",
    icon: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM15.5 13v7M12 16.5h7" />,
  },
  {
    title: "Общие интеграции",
    text: "Продукты обмениваются данными напрямую: заказы, палеты, коды маркировки и паспорта оборудования не нужно переносить вручную.",
    icon: (
      <>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M8.5 6h7M6 8.5V12a6 6 0 0 0 6 6h3.5" />
      </>
    ),
  },
  {
    title: "Мобильный доступ",
    text: "Складские операции на терминалах сбора данных, в том числе без постоянной связи — с синхронизацией при подключении.",
    icon: <path d="M7.5 2.8h9a1.5 1.5 0 0 1 1.5 1.5v15.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.7V4.3a1.5 1.5 0 0 1 1.5-1.5zM10.5 18h3" />,
  },
  {
    title: "Управление организациями",
    text: "Доступ выдаётся к конкретной организации. Сотрудники одной компании не видят данные другой.",
    icon: <path d="M3.5 20.5h17M5.5 20.5V8l6.5-4 6.5 4v12.5M9.5 20.5v-5h5v5M9 10.5h.01M15 10.5h.01" />,
  },
]

export function Advantages() {
  return (
    <section aria-labelledby="adv-title" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <SectionHead id="adv-title" eyebrow="Почему экосистема" title="Связанные продукты вместо разрозненных систем" />
      <ul className="mt-12 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {ADVANTAGES.map((a) => (
          <li key={a.title} className="bg-white p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {a.icon}
              </svg>
            </span>
            <h3 className="mt-5 font-bold">{a.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-text">{a.text}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

const STEPS = [
  { n: "01", title: "Выбор продуктов", text: "Отметьте один или несколько продуктов в каталоге или в форме заявки." },
  { n: "02", title: "Отправка заявки", text: "Укажите контакты и организацию. Номер заявки придёт на почту сразу." },
  { n: "03", title: "Подтверждение доступа", text: "Администратор экосистемы рассматривает заявку и одобряет нужные модули." },
  { n: "04", title: "Начало работы", text: "Вы получаете приглашение SCADA ID, входите — и открываете свои приложения." },
]

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="relative overflow-hidden bg-navy-900 py-24 text-white">
      <div className="blueprint pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="eyebrow text-ice-300">Как работает SCADA SYSTEM</p>
          <h2 id="how-title" className="h-section mt-3">От заявки до работы — четыре шага</h2>
          <p className="mt-4 text-lg leading-relaxed text-white/65">
            Свободной регистрации нет: каждый доступ подтверждает администратор, а вход идёт только через SCADA ID.
          </p>
        </div>
        <ol className="relative mt-14 grid gap-8 md:grid-cols-4 md:gap-6">
          <span aria-hidden="true" className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-ice-400/0 via-ice-400/50 to-ice-400/0 md:block" />
          {STEPS.map((s) => (
            <li key={s.n} className="relative">
              <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 font-mono text-sm font-bold shadow-[0_0_0_6px_rgb(7_20_48)]">
                {s.n}
              </span>
              <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12 flex flex-wrap gap-3">
          <Link href="/request" className="btn btn-primary">Запросить подключение</Link>
        </div>
      </div>
    </section>
  )
}

function Chain({ keys }: { keys: ProductKey[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {keys.map((k, i) => {
        const p = productByKey(k)
        if (!p) return null
        return (
          <span key={k} className="flex items-center gap-2">
            {i > 0 && (
              <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" className="text-muted">
                <path d="M1 5h18M15 1.5 19 5l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span className="inline-flex items-center gap-2 rounded-xl border border-line bg-white py-1 pl-1 pr-3 text-sm font-semibold">
              <ProductIcon k={k} color={p.color} onColor={p.onColor} size={28} />
              {p.short}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function Scenarios() {
  const live = SCENARIOS.filter((s) => s.state === "live")
  const planned = SCENARIOS.filter((s) => s.state === "planned")
  return (
    <section id="scenarios" aria-labelledby="sc-title" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <SectionHead
        id="sc-title"
        eyebrow="Сценарии использования"
        title="Как продукты работают вместе"
        lead="Здесь только связки, которые уже реализованы. Планируемые интеграции вынесены отдельно."
      />
      <ul className="mt-12 grid gap-5 md:grid-cols-2">
        {live.map((s) => (
          <li key={s.title} className="card p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">{s.title}</h3>
              <span className="chip bg-[#e6f6ef] text-ok">Работает</span>
            </div>
            <div className="mt-4"><Chain keys={s.chain} /></div>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-text">{s.text}</p>
          </li>
        ))}
      </ul>
      {planned.length > 0 && (
        <div className="mt-10">
          <h3 className="eyebrow text-muted">В планах</h3>
          <ul className="mt-4 grid gap-5 md:grid-cols-2">
            {planned.map((s) => (
              <li key={s.title} className="rounded-[var(--radius-card)] border border-dashed border-line bg-frost-2/50 p-6">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-lg font-bold text-ink/80">{s.title}</h4>
                  <span className="chip bg-[#fff4e5] text-warn">Планируется</span>
                </div>
                <div className="mt-4 opacity-80"><Chain keys={s.chain} /></div>
                <p className="mt-4 text-[15px] leading-relaxed text-slate-text">{s.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

const AUDIENCE = [
  { title: "Производственные предприятия", text: "Склад материалов, план выпуска, готовая продукция и маркировка в одном контуре.", keys: ["aps", "wms", "gsmt"] as ProductKey[] },
  { title: "Склады и распределительные центры", text: "Адресное хранение, приёмка и отгрузка с ТСД.", keys: ["wms", "mobile"] as ProductKey[] },
  { title: "Логистические площадки", text: "Визиты машин, КПП, доки и контроль погрузки.", keys: ["yms", "wms"] as ProductKey[] },
  { title: "Товары с обязательной маркировкой", text: "Заказ кодов, печать этикеток и проверка GS1 DataMatrix.", keys: ["gsmt"] as ProductKey[] },
  { title: "Службы эксплуатации оборудования", text: "Паспорта оборудования, документы, ТО и ремонты по QR-коду.", keys: ["qpass"] as ProductKey[] },
  { title: "Медицинские организации", text: "Учёт исследований и работа со снимками.", keys: ["xray"] as ProductKey[] },
]

export function Audience() {
  return (
    <section aria-labelledby="aud-title" className="border-y border-line bg-white py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHead id="aud-title" eyebrow="Для кого" title="Кому подходит SCADA SYSTEM" />
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCE.map((a) => (
            <li key={a.title} className="rounded-[var(--radius-card)] border border-line bg-frost/60 p-6">
              <div className="flex -space-x-2">
                {a.keys.map((k) => {
                  const p = productByKey(k)!
                  return <ProductIcon key={k} k={k} color={p.color} onColor={p.onColor} size={36} className="ring-2 ring-white" />
                })}
              </div>
              <h3 className="mt-5 font-bold">{a.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-text">{a.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const FAQ = [
  {
    q: "Как получить доступ к продуктам?",
    a: "Отправьте заявку: выберите продукты и укажите данные организации. Администратор экосистемы рассмотрит её, и на почту придёт приглашение войти через SCADA ID. Самостоятельной регистрации с автоматическим доступом нет.",
  },
  {
    q: "Можно ли подключить несколько продуктов сразу?",
    a: "Да. В одной заявке можно выбрать любую комбинацию доступных продуктов. Администратор может одобрить их все или часть — в письме будет видно, что именно подключено.",
  },
  {
    q: "Как работает SCADA ID?",
    a: "SCADA ID — единая учётная запись экосистемы. Вы входите один раз, а права на каждое приложение и организацию выдаются отдельно. Если учётной записи нет, после одобрения заявки придёт письмо для завершения регистрации: email уже подтверждён, остаётся проверить данные и задать пароль.",
  },
  {
    q: "Можно ли добавить приложение позже?",
    a: "Да. Войдите через SCADA ID и нажмите «Запросить ещё модули» в разделе «Мои приложения» — данные профиля подставятся автоматически.",
  },
  {
    q: "Что значат статусы продуктов?",
    a: "«Работает» — продукт используется в работе. «Пилотная версия» — базовые сценарии работают, функции расширяются. «По запросу» — подключение после консультации и развёртывания у заказчика. «В разработке» — заявку пока принять нельзя.",
  },
  {
    q: "Кнопка «Открыть» даёт доступ к приложению?",
    a: "Нет. Кнопка только ведёт в приложение, а вход и права проверяет само приложение через SCADA ID. Без выданных прав войти не получится.",
  },
]

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:px-8">
      <SectionHead id="faq-title" eyebrow="Вопросы и ответы" title="Частые вопросы" lead="Не нашли ответа? Опишите задачу в комментарии к заявке." />
      <div className="divide-y divide-line border-y border-line">
        {FAQ.map((f) => (
          <details key={f.q} className="group py-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-lg font-bold [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-transform group-open:rotate-45" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </span>
            </summary>
            <p className="pb-5 pr-12 text-[15px] leading-relaxed text-slate-text">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-brand-600 via-brand-700 to-navy-800 px-6 py-14 text-white sm:px-12">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h2 id="cta-title" className="h-section">Подключите нужные продукты</h2>
            <p className="mt-4 text-lg text-white/75">Выберите модули, отправьте заявку и получите доступ через SCADA ID после подтверждения.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/request" className="btn bg-white text-brand-700 hover:bg-brand-50">Запросить подключение</Link>
            <a href="#products" className="btn btn-ghost-dark">Изучить продукты</a>
          </div>
        </div>
      </div>
    </section>
  )
}
