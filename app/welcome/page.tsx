"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

type PlanCode = "lite" | "standard" | "enterprise"

const SLIDES = [
  { src: "/marketing/slide-login.png", title: "Авторизация", caption: "Вход оператора, Scada ID, Passkey" },
  { src: "/marketing/slide-dashboard.png", title: "Дашборд", caption: "Приёмка, задания, то что требует действий" },
  { src: "/marketing/slide-activity.png", title: "Активность склада", caption: "Операции, график, задания на выполнение" },
  { src: "/marketing/slide-ops.png", title: "Последние операции", caption: "Подпитка, сборка, перемещения, списания" },
  { src: "/marketing/slide-aps.png", title: "APS · план выпуска", caption: "Линии, партии, выпуск в реальном времени" },
  { src: "/marketing/slide-fg-stock.png", title: "Склад ГП", caption: "Номенклатура, партии, размещение, сроки" },
]

const PLANS: Array<{
  code: PlanCode
  name: string
  priceLabel: string
  priceNote: string
  badge?: string
  desc: string
  features: string[]
  cta: string
}> = [
  {
    code: "lite",
    name: "Lite",
    priceLabel: "15 000 ₽",
    priceNote: "в месяц · trial 14 дней",
    desc: "Магазин, точка, один склад",
    features: ["Остатки и ячейки", "Приёмка / отпуск", "Заполненность", "Без плана ГП и флота"],
    cta: "Выбрать Lite",
  },
  {
    code: "standard",
    name: "Standard",
    priceLabel: "45 000 ₽",
    priceNote: "в месяц · trial 14 дней",
    badge: "Популярный",
    desc: "Склад + цех + маркировка",
    features: ["Всё из Lite", "Цех и материалы", "Производство", "Маркировка", "Аналитика"],
    cta: "Выбрать Standard",
  },
  {
    code: "enterprise",
    name: "Enterprise",
    priceLabel: "По договору",
    priceNote: "полный контур · trial 14 дней",
    desc: "Завод: ГП, флот, вирт. склад",
    features: ["План склада ГП", "Флот погрузчиков", "Виртуальный склад", "Несколько складов", "Все модули"],
    cta: "Выбрать Enterprise",
  },
]

export default function WelcomeLandingPage() {
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<PlanCode>("standard")
  const [orgName, setOrgName] = useState("")
  const [siteCode, setSiteCode] = useState("")
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ siteCode: string; login: string; expiresAt: string } | null>(null)
  const [slide, setSlide] = useState(0)

  const selected = PLANS.find((p) => p.code === plan)!

  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 4500)
    return () => clearInterval(t)
  }, [])

  function openPlan(code: PlanCode) {
    setPlan(code)
    setError(null)
    setDone(null)
    setOpen(true)
  }

  function suggestCode(name: string) {
    const c = name
      .toLowerCase()
      .replace(/[а-яё]/gi, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 24)
    if (c.length >= 2) setSiteCode(c)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const r = await fetch("/api/wms/platform/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planCode: plan,
          orgName,
          siteCode,
          login,
          password,
          email,
          displayName: orgName || login,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `Ошибка ${r.status}`)
      setDone({ siteCode: data.siteCode, login: data.login, expiresAt: data.expiresAt })
    } catch (err) {
      setError(err instanceof Error ? err.message : "не удалось оформить")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0f0c] text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-[#0b0f0c]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="text-sm font-semibold tracking-wide">
            SCADA <span className="text-lime-400">WMS</span>
          </div>
          <Link
            href="/login"
            className="rounded-full border border-zinc-700 px-3.5 py-1.5 text-xs text-zinc-200 hover:border-zinc-500"
          >
            Войти
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-10 pt-12 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:pt-16">
          <div className="max-w-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-lime-400/90">Warehouse SaaS</p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Складской учёт.
              <br />
              <span className="text-zinc-500">Только нужные модули.</span>
            </h1>
            <p className="mt-5 text-sm leading-relaxed text-zinc-400">
              Выберите тариф, создайте организацию и сразу начните работу.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openPlan("standard")}
                className="rounded-full bg-lime-400 px-5 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-lime-300"
              >
                Начать
              </button>
              <Link
                href="/login"
                className="rounded-full border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 hover:border-zinc-500"
              >
                Войти
              </Link>
            </div>
          </div>

          {/* carousel */}
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-2xl shadow-black/40">
              <div className="relative aspect-[16/10] bg-zinc-950">
                {SLIDES.map((s, i) => (
                  <div
                    key={s.src}
                    className={
                      "absolute inset-0 transition-opacity duration-500 " +
                      (i === slide ? "opacity-100" : "pointer-events-none opacity-0")
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.src} alt={s.title} className="h-full w-full object-cover object-top" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-3 pt-10">
                      <div className="text-sm font-medium text-white">{s.title}</div>
                      <div className="text-[11px] text-zinc-400">{s.caption}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Слайд ${i + 1}`}
                  onClick={() => setSlide(i)}
                  className={
                    "h-1.5 rounded-full transition-all " +
                    (i === slide ? "w-6 bg-lime-400" : "w-1.5 bg-zinc-600 hover:bg-zinc-400")
                  }
                />
              ))}
            </div>
            <div className="mt-2 flex justify-center gap-2">
              <button
                type="button"
                className="rounded-full border border-zinc-700 px-3 py-1 text-[11px] text-zinc-400 hover:text-white"
                onClick={() => setSlide((s) => (s - 1 + SLIDES.length) % SLIDES.length)}
              >
                ←
              </button>
              <button
                type="button"
                className="rounded-full border border-zinc-700 px-3 py-1 text-[11px] text-zinc-400 hover:text-white"
                onClick={() => setSlide((s) => (s + 1) % SLIDES.length)}
              >
                →
              </button>
            </div>
          </div>
        </section>

        <section id="plans" className="border-t border-white/5 bg-zinc-950/40 py-14">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-semibold tracking-tight">Тарифы</h2>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {PLANS.map((p) => {
                const active = plan === p.code && open
                return (
                  <article
                    key={p.code}
                    className={
                      "relative flex flex-col rounded-2xl border p-5 transition " +
                      (p.badge
                        ? "border-lime-400/40 bg-gradient-to-b from-lime-400/10 to-transparent"
                        : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-600") +
                      (active ? " ring-1 ring-lime-400/50" : "")
                    }
                  >
                    {p.badge ? (
                      <span className="absolute -top-2.5 right-4 rounded-full bg-lime-400 px-2 py-0.5 text-[10px] font-semibold text-zinc-900">
                        {p.badge}
                      </span>
                    ) : null}

                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{p.code}</div>
                    <h3 className="mt-1 text-xl font-semibold">{p.name}</h3>
                    <p className="mt-1 text-xs text-zinc-500">{p.desc}</p>

                    <div className="mt-5">
                      <div className="text-3xl font-semibold tracking-tight text-white">{p.priceLabel}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">{p.priceNote}</div>
                    </div>

                    <ul className="mt-5 flex-1 space-y-2 text-xs text-zinc-400">
                      {p.features.map((f) => (
                        <li key={f} className="flex gap-2">
                          <span className="mt-0.5 text-lime-400">✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      onClick={() => openPlan(p.code)}
                      className={
                        "mt-6 w-full rounded-full py-2.5 text-sm font-semibold transition " +
                        (p.badge
                          ? "bg-lime-400 text-zinc-900 hover:bg-lime-300"
                          : "border border-zinc-600 bg-zinc-900 text-zinc-100 hover:border-lime-400/50 hover:text-white")
                      }
                    >
                      {p.cta}
                    </button>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <footer className="border-t border-white/5 py-8 text-center text-[11px] text-zinc-600">
          SCADA System · WMS ·{" "}
          <Link href="/login" className="underline hover:text-zinc-400">
            вход
          </Link>
        </footer>
      </main>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-[#111612] shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4">
              <div>
                <div className="text-sm font-semibold">Оформление доступа</div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {selected.name} · {selected.priceLabel}{" "}
                  <span className="text-zinc-600">· {selected.priceNote}</span>
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
                onClick={() => !busy && setOpen(false)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              {done ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-lime-400/30 bg-lime-400/10 px-4 py-3">
                    <div className="text-sm font-semibold text-lime-400">Заказ оформлен</div>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                      Организация <b className="text-white">{done.siteCode}</b> создана. Trial до{" "}
                      {new Date(done.expiresAt).toLocaleDateString("ru-RU")}. Логин:{" "}
                      <b className="text-white">{done.login}</b>
                    </p>
                  </div>
                  <Link
                    href="/login"
                    className="block w-full rounded-full bg-lime-400 py-2.5 text-center text-sm font-semibold text-zinc-900"
                  >
                    Войти в WMS
                  </Link>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-3">
                  <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-zinc-900/80 p-1">
                    {PLANS.map((p) => (
                      <button
                        key={p.code}
                        type="button"
                        onClick={() => setPlan(p.code)}
                        className={
                          "rounded-lg py-2 text-[11px] font-medium " +
                          (plan === p.code ? "bg-lime-400 text-zinc-900" : "text-zinc-400 hover:text-white")
                        }
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>

                  <label className="block text-[11px] text-zinc-500">
                    Название организации
                    <input
                      required
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-lime-400/50"
                      value={orgName}
                      onChange={(e) => {
                        setOrgName(e.target.value)
                        if (!siteCode) suggestCode(e.target.value)
                      }}
                      placeholder="ООО Ромашка"
                    />
                  </label>

                  <label className="block text-[11px] text-zinc-500">
                    Код организации <span className="text-zinc-600">(латиница, уникальный)</span>
                    <input
                      required
                      minLength={2}
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 font-mono text-sm text-white outline-none focus:border-lime-400/50"
                      value={siteCode}
                      onChange={(e) => setSiteCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                      placeholder="romashka"
                    />
                  </label>

                  <label className="block text-[11px] text-zinc-500">
                    Email для чека и связи
                    <input
                      type="email"
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-lime-400/50"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.ru"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-[11px] text-zinc-500">
                      Логин администратора
                      <input
                        required
                        className="mt-1 h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-lime-400/50"
                        value={login}
                        onChange={(e) => setLogin(e.target.value.trim().toLowerCase())}
                        placeholder="admin"
                      />
                    </label>
                    <label className="block text-[11px] text-zinc-500">
                      Пароль
                      <input
                        required
                        type="password"
                        minLength={6}
                        className="mt-1 h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-lime-400/50"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="мин. 6 символов"
                      />
                    </label>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-xs text-zinc-400">
                    <div className="flex justify-between">
                      <span>Тариф</span>
                      <span className="text-zinc-200">{selected.name}</span>
                    </div>
                    <div className="mt-1 flex justify-between">
                      <span>К оплате после trial</span>
                      <span className="font-medium text-white">{selected.priceLabel}</span>
                    </div>
                  </div>

                  {error ? <p className="text-xs text-red-400">{error}</p> : null}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded-full bg-lime-400 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-lime-300 disabled:opacity-60"
                  >
                    {busy ? "Оформляем…" : "Зарегистрировать и активировать trial"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
