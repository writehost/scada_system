"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ProductKey } from "@/lib/products"
import { ProductIcon, StatusPill } from "./brand"

export type WizardProduct = {
  key: ProductKey
  name: string
  tagline: string
  status: string
  statusLabel: string
  color: string
  onColor: string
  requestable: boolean
  note: string | null
}

type Fields = {
  firstName: string
  lastName: string
  email: string
  company: string
  jobTitle: string
  phone: string
  comment: string
  consent: boolean
}

type Draft = { modules: string[]; fields: Fields; key: string }

type Success = { publicNo: string; statusLabel: string; confirmationEmail: string; email: string; modules: string[] }

const DRAFT_KEY = "scada-portal:request-draft"
const STEPS = ["Продукты", "Данные заявителя", "Подтверждение"] as const

const EMPTY: Fields = { firstName: "", lastName: "", email: "", company: "", jobTitle: "", phone: "", comment: "", consent: false }

function newKey() {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "")
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}

function writeDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* приватный режим — черновик просто не сохраняется */
  }
}

const EMAIL_RE = /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-zA-Zа-яА-Я]{2,}$/

function validate(f: Fields): Partial<Record<keyof Fields, string>> {
  const e: Partial<Record<keyof Fields, string>> = {}
  if (!f.firstName.trim()) e.firstName = "Укажите имя"
  if (!f.lastName.trim()) e.lastName = "Укажите фамилию"
  if (!EMAIL_RE.test(f.email.trim())) e.email = "Укажите корректный email"
  if (f.company.trim().length < 2) e.company = "Укажите название организации"
  if (f.jobTitle.trim().length < 2) e.jobTitle = "Укажите должность"
  if (f.phone.trim() && !/^\+?[0-9\s()\-]{6,24}$/.test(f.phone.trim())) e.phone = "Телефон в формате +7 900 000-00-00"
  if (f.comment.length > 2000) e.comment = "Не больше 2000 символов"
  if (!f.consent) e.consent = "Нужно согласие на обработку персональных данных"
  return e
}

export function RequestWizard({
  products,
  preselected,
  prefill,
  signedIn,
}: {
  products: WizardProduct[]
  preselected: string[]
  prefill: Partial<Fields>
  signedIn: boolean
}) {
  const requestable = products.filter((p) => p.requestable)
  const upcoming = products.filter((p) => !p.requestable && p.status === "development")
  const byKey = useMemo(() => new Map(products.map((p) => [p.key as string, p])), [products])

  const [step, setStep] = useState(0)
  const [modules, setModules] = useState<string[]>(preselected)
  const [fields, setFields] = useState<Fields>({ ...EMPTY, ...prefill })
  const [errors, setErrors] = useState<Partial<Record<keyof Fields | "modules", string>>>({})
  const [touched, setTouched] = useState(false)
  const [key, setKey] = useState("")
  const [formToken, setFormToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState<Success | null>(null)
  const [restored, setRestored] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const loadToken = useCallback(async (): Promise<string | null> => {
    setTokenError(false)
    try {
      const r = await fetch("/api/requests/form-token", { cache: "no-store" })
      if (!r.ok) throw new Error()
      const token = ((await r.json()) as { token: string }).token
      setFormToken(token)
      return token
    } catch {
      setTokenError(true)
      return null
    }
  }, [])

  // Черновик: выбранные модули и поля переживают перезагрузку вкладки.
  useEffect(() => {
    const d = readDraft()
    if (d) {
      setModules((cur) => [...new Set([...(d.modules || []), ...cur])].filter((m) => requestable.some((p) => p.key === m)))
      setFields((cur) => ({ ...cur, ...d.fields, ...(signedIn && prefill.email ? { email: prefill.email } : {}) }))
      setKey(d.key || newKey())
    } else {
      setKey(newKey())
    }
    setRestored(true)
    void loadToken()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!restored || success) return
    writeDraft({ modules, fields: { ...fields, consent: false }, key })
  }, [modules, fields, key, restored, success])

  useEffect(() => {
    if (restored) headingRef.current?.focus()
  }, [step, success, restored])

  const toggle = (k: string) => {
    setModules((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))
    setErrors((e) => ({ ...e, modules: undefined }))
  }

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setFields((f) => ({ ...f, [k]: v }))
    if (touched) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  function next() {
    if (step === 0) {
      if (modules.length === 0) {
        setErrors({ modules: "Выберите хотя бы один продукт" })
        return
      }
      setStep(1)
    } else if (step === 1) {
      setTouched(true)
      const e = validate(fields)
      setErrors(e)
      if (Object.keys(e).length) {
        const first = Object.keys(e)[0]
        document.getElementById(`f-${first}`)?.focus()
        return
      }
      setStep(2)
    }
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const token = formToken || (await loadToken())
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, modules, idempotencyKey: key, formToken: token, website: (document.getElementById("f-website") as HTMLInputElement | null)?.value || "" }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        writeDraft(null)
        setSuccess({
          publicNo: body.request.publicNo,
          statusLabel: body.request.statusLabel,
          confirmationEmail: body.confirmationEmail,
          email: fields.email.trim().toLowerCase(),
          modules,
        })
        window.scrollTo({ top: 0 })
        return
      }
      if (res.status === 422 && body.fields) {
        setErrors(body.fields)
        setStep(body.fields.modules ? 0 : 1)
        setSubmitError("Проверьте отмеченные поля.")
        return
      }
      if (body.code === "bad_form_token" || body.code === "stale_form_token") await loadToken()
      setSubmitError(body.error || `Сервер ответил ошибкой ${res.status}. Попробуйте ещё раз.`)
    } catch {
      setSubmitError("Нет связи с сервером. Проверьте подключение и нажмите «Отправить» ещё раз — повторная отправка не создаст дубликат.")
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="card mx-auto max-w-2xl p-8 text-center sm:p-12" aria-live="polite">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e6f6ef] text-ok">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-3xl font-extrabold tracking-tight outline-none">Заявка отправлена</h1>
        <p className="mt-3 text-slate-text">Сохраните номер — он нужен для связи с администратором.</p>
        <dl className="mx-auto mt-8 grid max-w-md gap-px overflow-hidden rounded-2xl border border-line bg-line text-left sm:grid-cols-2">
          <div className="bg-frost p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Номер заявки</dt>
            <dd data-testid="request-number" className="mt-1 font-mono text-xl font-bold">{success.publicNo}</dd>
          </div>
          <div className="bg-frost p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Статус</dt>
            <dd data-testid="request-status" className="mt-1 text-lg font-bold text-brand-700">{success.statusLabel}</dd>
          </div>
        </dl>
        <p className="mx-auto mt-6 max-w-md text-sm text-slate-text">
          Продукты: {success.modules.map((m) => byKey.get(m)?.name || m).join(", ")}
        </p>
        {success.confirmationEmail === "sent" ? (
          <p className="mx-auto mt-3 max-w-md text-sm text-slate-text">Подтверждение отправлено на {success.email}.</p>
        ) : success.confirmationEmail === "failed" ? (
          <p role="status" className="mx-auto mt-3 max-w-md rounded-xl bg-[#fff4e5] px-4 py-3 text-sm text-warn">
            Заявка сохранена, но письмо с подтверждением на {success.email} отправить не удалось. Администратор видит заявку и свяжется с вами.
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn btn-secondary">На главную</Link>
          {!signedIn && <a href="/api/auth/login?next=%2F%23my-apps" className="btn btn-primary">Войти через SCADA ID</a>}
        </div>
      </div>
    )
  }

  const selected = modules.map((m) => byKey.get(m)).filter((p): p is WizardProduct => Boolean(p))

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="card p-5 sm:p-8">
        <ol className="flex items-center gap-2 sm:gap-3" aria-label="Шаги заявки">
          {STEPS.map((s, i) => (
            <li key={s} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" aria-current={i === step ? "step" : undefined}>
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  i < step ? "bg-ok text-white" : i === step ? "bg-brand-600 text-white" : "bg-frost-2 text-muted"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span className={`hidden truncate text-sm font-semibold sm:block ${i === step ? "text-ink" : "text-muted"}`}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-px min-w-4 flex-1 bg-line" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="mt-8" aria-labelledby="st-0">
            <h1 id="st-0" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold tracking-tight outline-none sm:text-3xl">
              Какие продукты подключить?
            </h1>
            <p className="mt-2 text-slate-text">Выберите один или несколько. SCADA ID для входа включён в каждую заявку.</p>
            <fieldset className="mt-6">
              <legend className="sr-only">Продукты для подключения</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {requestable.map((p) => {
                  const on = modules.includes(p.key)
                  return (
                    <label
                      key={p.key}
                      className={`relative flex cursor-pointer gap-4 rounded-2xl border p-4 transition-[border-color,box-shadow,background-color] ${
                        on ? "border-brand-500 bg-brand-50/50 shadow-[0_0_0_3px_rgb(47_116_255/0.14)]" : "border-line bg-white hover:border-brand-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={on}
                        onChange={() => toggle(p.key)}
                        name="modules"
                        value={p.key}
                        data-testid={`module-${p.key}`}
                      />
                      <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">{p.name}</span>
                        </span>
                        <span className="mt-0.5 block text-sm text-slate-text">{p.tagline}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-2">
                          <StatusPill status={p.status} label={p.statusLabel} />
                          {p.note && <span className="text-xs text-muted">{p.note}</span>}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors peer-focus-visible:ring-4 peer-focus-visible:ring-brand-200 ${
                          on ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white"
                        }`}
                      >
                        {on && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            {errors.modules && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{errors.modules}</p>}
            {upcoming.length > 0 && (
              <div className="mt-6 rounded-2xl border border-dashed border-line p-4">
                <p className="text-sm font-semibold text-slate-text">Пока нельзя подключить</p>
                <ul className="mt-3 flex flex-wrap gap-3">
                  {upcoming.map((p) => (
                    <li key={p.key} className="flex items-center gap-2 text-sm text-muted">
                      <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={28} className="opacity-60" />
                      {p.name} · {p.statusLabel.toLowerCase()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {step === 1 && (
          <section className="mt-8" aria-labelledby="st-1">
            <h1 id="st-1" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold tracking-tight outline-none sm:text-3xl">
              Сведения о заявителе
            </h1>
            <p className="mt-2 text-slate-text">
              {signedIn ? "Данные подставлены из профиля SCADA ID — проверьте их." : "По этим данным администратор свяжется с вами и создаст доступ."}
            </p>
            <form
              className="mt-6 grid gap-5 sm:grid-cols-2"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                next()
              }}
            >
              <Field id="firstName" label="Имя" value={fields.firstName} error={errors.firstName} onChange={(v) => set("firstName", v)} autoComplete="given-name" required />
              <Field id="lastName" label="Фамилия" value={fields.lastName} error={errors.lastName} onChange={(v) => set("lastName", v)} autoComplete="family-name" required />
              <Field
                id="email"
                label="Электронная почта"
                type="email"
                value={fields.email}
                error={errors.email}
                onChange={(v) => set("email", v)}
                autoComplete="email"
                required
                readOnly={signedIn && Boolean(prefill.email)}
                hint={signedIn && prefill.email ? "Email вашей учётной записи SCADA ID" : "На него придут решение и приглашение"}
              />
              <Field id="phone" label="Телефон" type="tel" value={fields.phone} error={errors.phone} onChange={(v) => set("phone", v)} autoComplete="tel" hint="Необязательно" />
              <Field id="company" label="Компания или организация" value={fields.company} error={errors.company} onChange={(v) => set("company", v)} autoComplete="organization" required />
              <Field id="jobTitle" label="Должность" value={fields.jobTitle} error={errors.jobTitle} onChange={(v) => set("jobTitle", v)} autoComplete="organization-title" required />
              <div className="sm:col-span-2">
                <label htmlFor="f-comment" className="text-sm font-semibold">Цели использования</label>
                <textarea
                  id="f-comment"
                  className="field mt-1.5 min-h-28 resize-y"
                  value={fields.comment}
                  maxLength={2000}
                  onChange={(e) => set("comment", e.target.value)}
                  placeholder="Например: склад готовой продукции на 2 000 ячеек, 6 ТСД, нужна связь с 1С"
                  aria-invalid={Boolean(errors.comment)}
                  aria-describedby="f-comment-hint"
                />
                <p id="f-comment-hint" className={`mt-1 text-xs ${errors.comment ? "text-danger" : "text-muted"}`}>
                  {errors.comment || `${fields.comment.length} / 2000`}
                </p>
              </div>
              {/* Ловушка для ботов: людям не видна и недоступна с клавиатуры */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="f-website">Сайт</label>
                <input id="f-website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              <div className="sm:col-span-2">
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    id="f-consent"
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                    checked={fields.consent}
                    onChange={(e) => set("consent", e.target.checked)}
                    aria-invalid={Boolean(errors.consent)}
                    aria-describedby={errors.consent ? "f-consent-err" : undefined}
                  />
                  <span className="text-slate-text">
                    Я согласен(а) на обработку персональных данных в целях рассмотрения заявки и предоставления доступа в соответствии с{" "}
                    <Link href="/privacy" target="_blank" className="font-semibold text-brand-700 underline underline-offset-2">политикой конфиденциальности</Link>.
                  </span>
                </label>
                {errors.consent && <p id="f-consent-err" role="alert" className="mt-1.5 text-sm font-semibold text-danger">{errors.consent}</p>}
              </div>
              <button type="submit" className="sr-only">Далее</button>
            </form>
          </section>
        )}

        {step === 2 && (
          <section className="mt-8" aria-labelledby="st-2">
            <h1 id="st-2" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold tracking-tight outline-none sm:text-3xl">
              Проверьте заявку
            </h1>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Summary title="Организация" onEdit={() => setStep(1)}>
                <p className="font-semibold">{fields.company}</p>
                <p className="text-slate-text">{fields.jobTitle}</p>
              </Summary>
              <Summary title="Контактные данные" onEdit={() => setStep(1)}>
                <p className="font-semibold">{fields.firstName} {fields.lastName}</p>
                <p className="text-slate-text">{fields.email}</p>
                {fields.phone && <p className="text-slate-text">{fields.phone}</p>}
              </Summary>
              <Summary title={`Выбранные продукты · ${selected.length}`} onEdit={() => setStep(0)} wide>
                <ul className="flex flex-wrap gap-2">
                  {selected.map((p) => (
                    <li key={p.key} className="inline-flex items-center gap-2 rounded-xl border border-line bg-white py-1 pl-1 pr-3 text-sm font-semibold">
                      <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={26} />
                      {p.name}
                    </li>
                  ))}
                </ul>
              </Summary>
              {fields.comment && (
                <Summary title="Цели использования" onEdit={() => setStep(1)} wide>
                  <p className="whitespace-pre-wrap text-slate-text">{fields.comment}</p>
                </Summary>
              )}
            </div>
            <div className="mt-6 rounded-2xl bg-frost p-5">
              <h2 className="text-sm font-bold">Что будет дальше</h2>
              <ol className="mt-3 space-y-2 text-sm text-slate-text">
                <li>1. Заявка получит номер, подтверждение придёт на {fields.email || "вашу почту"}.</li>
                <li>2. Администратор экосистемы рассмотрит её и одобрит все или часть продуктов.</li>
                <li>3. Придёт приглашение SCADA ID: завершить регистрацию или войти в существующую учётную запись.</li>
                <li>4. После входа доступ активируется, и продукты появятся в разделе «Мои приложения».</li>
              </ol>
            </div>
            {tokenError && (
              <p role="alert" className="mt-4 text-sm text-danger">
                Не удалось подготовить форму к отправке.{" "}
                <button type="button" className="font-semibold underline" onClick={() => void loadToken()}>Повторить</button>
              </p>
            )}
            {submitError && (
              <div role="alert" className="mt-4 rounded-xl border border-danger/20 bg-[#fdecea] px-4 py-3 text-sm text-danger">
                {submitError}
              </div>
            )}
          </section>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
              Назад
            </button>
          ) : (
            <Link href="/#products" className="btn btn-secondary">К каталогу</Link>
          )}
          {step < 2 ? (
            <button type="button" className="btn btn-primary" onClick={next} data-testid="wizard-next">
              Далее
            </button>
          ) : (
            <button type="button" className="btn btn-primary min-w-48" onClick={() => void submit()} disabled={submitting} data-testid="wizard-submit">
              {submitting ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Отправляем…
                </>
              ) : submitError ? (
                "Отправить ещё раз"
              ) : (
                "Отправить заявку"
              )}
            </button>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:self-start" aria-label="Итог заявки">
        <div className="card overflow-hidden">
          <div className="bg-navy-900 px-5 py-4 text-white">
            <p className="eyebrow text-ice-300">Ваша заявка</p>
            <p className="mt-1 text-2xl font-extrabold" aria-live="polite" data-testid="selected-count">
              {selected.length} {plural(selected.length, ["продукт", "продукта", "продуктов"])}
            </p>
          </div>
          <div className="p-5">
            {selected.length === 0 ? (
              <p className="text-sm text-muted">Отметьте продукты, которые хотите подключить.</p>
            ) : (
              <ul className="space-y-3">
                {selected.map((p) => (
                  <li key={p.key} className="flex items-center gap-3">
                    <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={32} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
                    {step === 0 && (
                      <button type="button" onClick={() => toggle(p.key)} className="rounded-md p-1 text-muted hover:bg-frost hover:text-ink" aria-label={`Убрать ${p.name}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex items-center gap-3 border-t border-line pt-4 text-sm text-slate-text">
              <ProductIcon k="id" color="#4c5268" onColor="#fff" size={32} />
              <span>SCADA ID — вход во все продукты</span>
            </div>
            <p className="mt-4 text-xs text-muted">Выбор сохраняется автоматически, пока открыта вкладка.</p>
          </div>
        </div>
      </aside>
    </div>
  )
}

function plural(n: number, f: [string, string, string]) {
  const a = n % 10
  const b = n % 100
  if (a === 1 && b !== 11) return f[0]
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return f[1]
  return f[2]
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  required,
  readOnly,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  hint?: string
  type?: string
  required?: boolean
  readOnly?: boolean
  autoComplete?: string
}) {
  const describedBy = error || hint ? `f-${id}-d` : undefined
  return (
    <div>
      <label htmlFor={`f-${id}`} className="text-sm font-semibold">
        {label}
        {required && <span className="text-danger" aria-hidden="true"> *</span>}
      </label>
      <input
        id={`f-${id}`}
        name={id}
        type={type}
        className={`field mt-1.5 ${readOnly ? "bg-frost text-slate-text" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-required={required}
        aria-describedby={describedBy}
        readOnly={readOnly}
        autoComplete={autoComplete}
      />
      {(error || hint) && (
        <p id={describedBy} className={`mt-1 text-xs ${error ? "font-semibold text-danger" : "text-muted"}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

function Summary({ title, children, onEdit, wide }: { title: string; children: React.ReactNode; onEdit: () => void; wide?: boolean }) {
  return (
    <div className={`rounded-2xl border border-line p-4 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">{title}</h2>
        <button type="button" onClick={onEdit} className="text-xs font-semibold text-brand-700 hover:underline">Изменить</button>
      </div>
      <div className="text-sm">{children}</div>
    </div>
  )
}
