"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, Factory, Home } from "lucide-react"
import { api } from "@/lib/client/api"
import { Button, Checkbox, ErrorBox, Field, Input, Notice, Panel, Segmented, Select } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { Stepper } from "@/components/ems/stepper"
import { IndustrialOnboarding } from "@/components/ems/industrial-onboarding"

const SERVICES = [
  { id: "electricity", label: "Электричество", meter: true },
  { id: "cold_water", label: "Холодная вода", meter: true },
  { id: "hot_water", label: "Горячая вода", meter: true },
  { id: "wastewater", label: "Водоотведение", meter: false },
  { id: "heating", label: "Отопление", meter: false },
  { id: "gas", label: "Газ", meter: false },
  { id: "internet", label: "Интернет", meter: false },
  { id: "other", label: "Другая регулярная услуга", meter: false },
] as const

type Svc = {
  enabled: boolean
  providerName: string
  accountNumber: string
  dueDay: string
  readingsDay: string
  remindDays: string
  tariffKind: string
  price: string
  priceNight: string
  coldPrice: string
  heatPerM3: string
  heatPrice: string
  fixedAmount: string
  input: "manual" | "auto" | "none"
  initial: Record<string, string>
}

const empty = (): Svc => ({ enabled: false, providerName: "", accountNumber: "", dueDay: "10", readingsDay: "", remindDays: "3", tariffKind: "single", price: "", priceNight: "", coldPrice: "", heatPerM3: "", heatPrice: "", fixedAmount: "", input: "manual", initial: {} })

function OnboardingInner() {
  const { industrial } = useApp()
  const mode = useSearchParams().get("mode")
  const [choice, setChoice] = useState<"home" | "industrial" | null>(mode === "industrial" ? "industrial" : mode === "home" ? "home" : industrial ? "industrial" : null)
  if (!choice) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Добро пожаловать в SCADA EMS" subtitle="Выберите сценарий — интерфейс подстроится под задачу." />
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setChoice("home")} className="ems-panel flex flex-col items-start gap-2 p-5 text-left hover:border-primary/60">
            <Home className="size-6" />
            <p className="font-semibold">Дом, квартира, гараж</p>
            <p className="text-[13px] text-muted-foreground">Расход и стоимость коммунальных услуг, напоминания об оплате, ручной ввод показаний или умные счётчики.</p>
          </button>
          <button type="button" onClick={() => setChoice("industrial")} className="ems-panel flex flex-col items-start gap-2 p-5 text-left hover:border-primary/60">
            <Factory className="size-6" />
            <p className="font-semibold">Предприятие, склад, здание</p>
            <p className="text-[13px] text-muted-foreground">Площадки, цеха и линии, шлюзы и приборы Modbus, мощность, смены, удельное потребление.</p>
          </button>
        </div>
      </div>
    )
  }
  return choice === "home" ? <HomeOnboarding /> : <IndustrialOnboarding />
}

function HomeOnboarding() {
  const router = useRouter()
  const { reloadSites, me } = useApp()
  const steps = ["Вход через SCADA ID", "Объект", "Услуги", "Тарифы и платежи", "Счётчики", "Уведомления", "Готово"]
  const [step, setStep] = useState(1)
  const [site, setSite] = useState({ name: "Моя квартира", kind: "apartment", address: "", timezone: "Europe/Moscow" })
  const [svc, setSvc] = useState<Record<string, Svc>>(() => Object.fromEntries(SERVICES.map((s) => [s.id, { ...empty(), enabled: s.id === "electricity" || s.id === "cold_water" || s.id === "hot_water" }])))
  const [email, setEmail] = useState(me.user.email ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  const upd = (id: string, patch: Partial<Svc>) => setSvc((s) => ({ ...s, [id]: { ...s[id], ...patch } }))
  const enabled = SERVICES.filter((s) => svc[s.id].enabled)

  const tariffPayload = (id: string, s: Svc) => {
    if (id === "internet" || id === "other" || id === "heating" || id === "gas") return null
    if (!s.price && !s.coldPrice) return null
    if (id === "electricity" && s.tariffKind === "zones") {
      return { kind: "zones", config: { zones: [{ code: "T1", name: "День", price: s.price, ranges: [{ from: "07:00", to: "23:00" }] }, { code: "T2", name: "Ночь", price: s.priceNight, ranges: [{ from: "23:00", to: "07:00" }] }] } }
    }
    if (id === "hot_water" && s.tariffKind === "two_component") return { kind: "hot_water", config: { mode: "two_component", coldPrice: s.coldPrice, heatPerM3: s.heatPerM3, heatPrice: s.heatPrice } }
    if (id === "hot_water") return { kind: "hot_water", config: { mode: "one_component", price: s.price } }
    if (id === "wastewater") return { kind: "wastewater", config: { price: s.price, basis: "cold_plus_hot" } }
    return { kind: "single", config: { price: s.price } }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api("/api/v1/onboarding/home", {
        body: {
          site,
          notifyEmail: email || null,
          services: enabled.map((s) => {
            const v = svc[s.id]
            const fixed = ["internet", "other", "heating", "gas"].includes(s.id) && v.fixedAmount !== ""
            return {
              service: s.id,
              providerName: v.providerName || null,
              accountNumber: v.accountNumber || null,
              dueDay: v.dueDay ? Number(v.dueDay) : null,
              readingsDay: v.readingsDay ? Number(v.readingsDay) : null,
              remindDays: v.remindDays ? Number(v.remindDays) : 3,
              fixedAmount: fixed ? v.fixedAmount : null,
              tariff: fixed ? null : tariffPayload(s.id, v),
              meter: s.meter && v.input === "manual" ? { template: s.id === "electricity" ? (v.tariffKind === "zones" ? "two_zone" : "single") : "water", initialReadings: v.initial } : null,
            }
          }),
        },
      })
      reloadSites()
      const needsAuto = enabled.some((s) => s.meter && svc[s.id].input === "auto")
      router.replace(needsAuto ? "/meters/new" : "/")
    } catch (e) {
      setError(e as Error)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Первый запуск" subtitle="Несколько минут — и вы увидите расходы, стоимость и ближайшие платежи." />
      <Stepper steps={steps} current={step} />
      <Panel>
        {step === 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название" htmlFor="s-name" required>
              <Input id="s-name" value={site.name} onChange={(e) => setSite({ ...site, name: e.target.value })} maxLength={120} />
            </Field>
            <Field label="Тип объекта">
              <Select value={site.kind} onChange={(e) => setSite({ ...site, kind: e.target.value })}>
                <option value="apartment">Квартира</option>
                <option value="house">Частный дом</option>
                <option value="garage">Гараж</option>
                <option value="office">Небольшой офис</option>
                <option value="workshop">Мастерская</option>
              </Select>
            </Field>
            <Field label="Адрес" hint="Необязательно" className="sm:col-span-2">
              <Input value={site.address} onChange={(e) => setSite({ ...site, address: e.target.value })} maxLength={300} />
            </Field>
            <Field label="Часовой пояс" hint="Нужен для суток, ночных зон тарифа и сроков оплаты">
              <Select value={site.timezone} onChange={(e) => setSite({ ...site, timezone: e.target.value })}>
                {["Europe/Kaliningrad", "Europe/Moscow", "Europe/Samara", "Asia/Yekaterinburg", "Asia/Omsk", "Asia/Novosibirsk", "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Yakutsk", "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka"].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {SERVICES.map((s) => (
              <div key={s.id} className="rounded-lg border border-border/70 p-3">
                <Checkbox checked={svc[s.id].enabled} onChange={(v) => upd(s.id, { enabled: v })} label={s.label} hint={s.meter ? "по счётчику" : s.id === "wastewater" ? "по сумме ХВС и ГВС" : "фиксированная сумма или ввод вручную"} />
              </div>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <Notice>Цены возьмите из последней квитанции. SCADA EMS не подставляет «средние» тарифы: без цены расход считается, а стоимость — нет. Тарифы можно изменить позже.</Notice>
            {enabled.map((s) => {
              const v = svc[s.id]
              return (
                <fieldset key={s.id} className="rounded-xl border border-border/70 p-3">
                  <legend className="px-1 text-sm font-semibold">{s.label}</legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {s.id === "electricity" ? (
                      <Field label="Учёт" className="sm:col-span-3">
                        <Segmented value={v.tariffKind} onChange={(k) => upd(s.id, { tariffKind: k })} options={[{ value: "single", label: "Однотарифный" }, { value: "zones", label: "День / ночь" }]} />
                      </Field>
                    ) : null}
                    {s.id === "hot_water" ? (
                      <Field label="Схема ГВС" className="sm:col-span-3">
                        <Segmented value={v.tariffKind === "two_component" ? "two_component" : "single"} onChange={(k) => upd(s.id, { tariffKind: k })} options={[{ value: "single", label: "Цена за м³" }, { value: "two_component", label: "Двухкомпонентная" }]} />
                      </Field>
                    ) : null}
                    {["internet", "other", "heating", "gas"].includes(s.id) ? (
                      <Field label="Сумма в месяц, ₽" hint="Пусто — будете вносить сумму вручную">
                        <Input inputMode="decimal" value={v.fixedAmount} onChange={(e) => upd(s.id, { fixedAmount: e.target.value })} placeholder="750" />
                      </Field>
                    ) : s.id === "hot_water" && v.tariffKind === "two_component" ? (
                      <>
                        <Field label="Компонент ХВС, ₽/м³">
                          <Input inputMode="decimal" value={v.coldPrice} onChange={(e) => upd(s.id, { coldPrice: e.target.value })} />
                        </Field>
                        <Field label="Норматив тепла, Гкал/м³">
                          <Input inputMode="decimal" value={v.heatPerM3} onChange={(e) => upd(s.id, { heatPerM3: e.target.value })} placeholder="из квитанции" />
                        </Field>
                        <Field label="Тепловая энергия, ₽/Гкал">
                          <Input inputMode="decimal" value={v.heatPrice} onChange={(e) => upd(s.id, { heatPrice: e.target.value })} />
                        </Field>
                      </>
                    ) : (
                      <>
                        <Field label={s.id === "electricity" && v.tariffKind === "zones" ? "День, ₽/кВт·ч" : s.id === "electricity" ? "Цена, ₽/кВт·ч" : "Цена, ₽/м³"}>
                          <Input inputMode="decimal" value={v.price} onChange={(e) => upd(s.id, { price: e.target.value })} />
                        </Field>
                        {s.id === "electricity" && v.tariffKind === "zones" ? (
                          <Field label="Ночь, ₽/кВт·ч" hint="Ночь 23:00–07:00">
                            <Input inputMode="decimal" value={v.priceNight} onChange={(e) => upd(s.id, { priceNight: e.target.value })} />
                          </Field>
                        ) : null}
                      </>
                    )}
                    <Field label="Поставщик">
                      <Input value={v.providerName} onChange={(e) => upd(s.id, { providerName: e.target.value })} maxLength={120} />
                    </Field>
                    <Field label="Лицевой счёт">
                      <Input value={v.accountNumber} onChange={(e) => upd(s.id, { accountNumber: e.target.value })} maxLength={60} />
                    </Field>
                    <Field label="Оплата до числа" hint="Пусто — без напоминаний">
                      <Input inputMode="numeric" value={v.dueDay} onChange={(e) => upd(s.id, { dueDay: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
                    </Field>
                    {s.meter ? (
                      <Field label="Показания до числа" hint="Отдельное напоминание">
                        <Input inputMode="numeric" value={v.readingsDay} onChange={(e) => upd(s.id, { readingsDay: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
                      </Field>
                    ) : null}
                    <Field label="Напомнить за, дней">
                      <Input inputMode="numeric" value={v.remindDays} onChange={(e) => upd(s.id, { remindDays: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
                    </Field>
                  </div>
                </fieldset>
              )
            })}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            {enabled.filter((s) => s.meter).length === 0 ? <p className="text-[13px] text-muted-foreground">Выбранные услуги без счётчиков — переходите к следующему шагу.</p> : null}
            {enabled
              .filter((s) => s.meter)
              .map((s) => {
                const v = svc[s.id]
                const zones = s.id === "electricity" && v.tariffKind === "zones"
                const codes = s.id === "electricity" ? (zones ? [["energy_t1", "Т1 (день), кВт·ч"], ["energy_t2", "Т2 (ночь), кВт·ч"]] : [["energy", "Показание, кВт·ч"]]) : [["volume", "Показание, м³"]]
                return (
                  <fieldset key={s.id} className="rounded-xl border border-border/70 p-3">
                    <legend className="px-1 text-sm font-semibold">{s.label}</legend>
                    <Segmented
                      value={v.input}
                      onChange={(k) => upd(s.id, { input: k })}
                      options={[
                        { value: "manual", label: "Ручной ввод показаний" },
                        { value: "auto", label: "Автоматический прибор" },
                        { value: "none", label: "Пока без счётчика" },
                      ]}
                    />
                    {v.input === "manual" ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {codes.map(([code, label]) => (
                          <Field key={code} label={label} hint="Текущее показание на табло — точка отсчёта">
                            <Input inputMode="decimal" value={v.initial[code] ?? ""} onChange={(e) => upd(s.id, { initial: { ...v.initial, [code]: e.target.value } })} />
                          </Field>
                        ))}
                      </div>
                    ) : v.input === "auto" ? (
                      <p className="mt-3 text-[13px] text-muted-foreground">
                        После мастера откроется подключение прибора. Обычный счётчик без интерфейса нельзя подключить к облаку напрямую — понадобится импульсный модуль или шлюз. Совместимые варианты — в{" "}
                        <Link href="/catalog" className="underline" target="_blank">
                          каталоге приборов
                        </Link>
                        .
                      </p>
                    ) : null}
                  </fieldset>
                )
              })}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-3">
            <Field label="Email для напоминаний" hint="Пришлём письмо для подтверждения. Можно добавить ещё адреса в настройках." htmlFor="ob-email">
              <Input id="ob-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.ru" />
            </Field>
            <p className="text-[13px] text-muted-foreground">Например: «Через 3 дня необходимо оплатить электричество. Ожидаемая сумма — 1 450 ₽».</p>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-2 text-[13px]">
            <p className="flex items-center gap-2 font-semibold">
              <Building2 className="size-4" /> {site.name}
            </p>
            <ul className="list-inside list-disc text-muted-foreground">
              {enabled.map((s) => (
                <li key={s.id}>
                  {s.label}
                  {svc[s.id].dueDay ? `, оплата до ${svc[s.id].dueDay} числа` : ""}
                  {s.meter && svc[s.id].input === "manual" ? ", ручной ввод" : s.meter && svc[s.id].input === "auto" ? ", автоматический прибор (подключим дальше)" : ""}
                </li>
              ))}
            </ul>
            {email ? <p className="text-muted-foreground">Напоминания: {email} (после подтверждения)</p> : null}
            <ErrorBox error={error} />
          </div>
        ) : null}

        <div className="mt-5 flex justify-between gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" disabled={step <= 1 || busy} onClick={() => setStep(step - 1)}>
            Назад
          </Button>
          {step < 6 ? (
            <Button onClick={() => setStep(step + 1)} disabled={(step === 1 && !site.name.trim()) || (step === 2 && enabled.length === 0)}>
              Далее
            </Button>
          ) : (
            <Button onClick={submit} loading={busy}>
              Перейти на главную панель
            </Button>
          )}
        </div>
      </Panel>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingInner />
    </Suspense>
  )
}
