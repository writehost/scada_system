import { expect, test } from "@playwright/test"
import { fillApplicant, formToken, mailsTo, payload, sql, uniqueEmail } from "./helpers"

test.describe("заявка на подключение", () => {
  test("карточка → мастер из трёх шагов → номер и статус, запись в БД и письма", async ({ page }) => {
    const email = uniqueEmail("wizard")
    await page.goto("/")
    await page.locator("#products").getByRole("link", { name: "Запросить доступ к SCADA WMS" }).click()
    await expect(page).toHaveURL(/modules=wms/)

    // шаг 1: WMS уже выбран, добавляем YMS и QPass
    await expect(page.getByTestId("module-wms")).toBeChecked()
    await expect(page.getByTestId("selected-count")).toHaveText("1 продукт")
    await page.getByTestId("module-yms").check({ force: true })
    await page.getByTestId("module-qpass").check({ force: true })
    await expect(page.getByTestId("selected-count")).toHaveText("3 продукта")
    await expect(page.getByTestId("module-ems")).toHaveCount(0)
    await page.getByTestId("wizard-next").click()

    // шаг 2: клиентская проверка
    await page.getByTestId("wizard-next").click()
    await expect(page.getByText("Укажите имя")).toBeVisible()
    await expect(page.getByText("Нужно согласие на обработку персональных данных")).toBeVisible()
    await fillApplicant(page, { firstName: "Анна", lastName: "Петрова", email, company: "ООО Склад и Ко", jobTitle: "Начальник склада", comment: "Склад ГП и двор" })

    // черновик переживает перезагрузку, выбранные модули сохраняются
    await page.reload()
    await expect(page.getByTestId("selected-count")).toHaveText("3 продукта")
    await page.getByTestId("wizard-next").click()
    await expect(page.locator("#f-email")).toHaveValue(email)
    await page.check("#f-consent")
    await page.getByTestId("wizard-next").click()

    // шаг 3: сводка
    await expect(page.getByRole("heading", { name: "Проверьте заявку" })).toBeVisible()
    await expect(page.getByText("ООО Склад и Ко")).toBeVisible()
    await expect(page.getByText("Выбранные продукты · 3")).toBeVisible()
    await page.getByTestId("wizard-submit").click()

    await expect(page.getByTestId("request-number")).toHaveText(/^SR-\d{6}$/)
    await expect(page.getByTestId("request-status")).toHaveText("На рассмотрении")
    await expect(page.getByText(`Подтверждение отправлено на ${email}`)).toBeVisible()
    const no = (await page.getByTestId("request-number").textContent())!

    const [row] = await sql<{ status: string; requested_modules: string[]; company: string }>(
      "SELECT status, requested_modules, company FROM portal_access_requests WHERE public_no = $1",
      [no]
    )
    expect(row.status).toBe("new")
    expect(row.requested_modules.sort()).toEqual(["qpass", "wms", "yms"])
    expect(row.company).toBe("ООО Склад и Ко")

    const toApplicant = await mailsTo(email)
    expect(toApplicant).toHaveLength(1)
    expect(toApplicant[0].subject).toContain(no)
    const toAdmin = (await mailsTo("owner@scada.test")).filter((m) => m.subject.includes(no))
    expect(toAdmin).toHaveLength(1)
    expect(toAdmin[0].text).toContain("SCADA YMS")

    const [ev] = await sql<{ action: string }>(
      "SELECT action FROM portal_request_events e JOIN portal_access_requests r ON r.id = e.request_id WHERE r.public_no = $1 ORDER BY e.id LIMIT 1",
      [no]
    )
    expect(ev.action).toBe("submitted")
  })

  test("ошибка сети и повторная отправка не создают дубликат", async ({ page }) => {
    const email = uniqueEmail("retry")
    await page.goto("/request?modules=wms")
    await page.getByTestId("wizard-next").click()
    await fillApplicant(page, { firstName: "Пётр", lastName: "Сеть", email, company: "ООО Связь", jobTitle: "Инженер" })
    await page.getByTestId("wizard-next").click()

    // первый POST доходит до сервера, но ответ теряется
    let dropped = false
    await page.route("**/api/requests", async (route) => {
      if (route.request().method() !== "POST" || dropped) return route.continue()
      dropped = true
      await route.fetch()
      await route.abort("connectionreset")
    })
    await page.waitForTimeout(400)
    await page.getByTestId("wizard-submit").click()
    await expect(page.getByRole("alert").filter({ hasText: "Нет связи с сервером" })).toBeVisible()
    await expect(page.getByTestId("wizard-submit")).toHaveText("Отправить ещё раз")
    await page.getByTestId("wizard-submit").click()
    await expect(page.getByTestId("request-number")).toBeVisible()

    const rows = await sql("SELECT id FROM portal_access_requests WHERE email = $1", [email])
    expect(rows).toHaveLength(1)
    expect(await mailsTo(email)).toHaveLength(1)
  })

  test("серверная проверка: поля, недоступные продукты, антиспам, лимиты", async ({ page }) => {
    await page.goto("/")
    const post = async (data: Record<string, unknown>) => page.request.post("/api/requests", { data, headers: { "Content-Type": "application/json" } })

    // без токена формы
    let r = await post(payload(uniqueEmail("nok")))
    expect(r.status()).toBe(400)
    expect((await r.json()).code).toBe("bad_form_token")

    // валидация полей и модулей
    r = await post({ ...payload("bad"), modules: ["ems"], consent: false, formToken: await formToken(page) })
    expect(r.status()).toBe(422)
    const body = await r.json()
    expect(Object.keys(body.fields).sort()).toEqual(["consent", "email", "modules"])

    // слишком быстрая отправка
    r = await post({ ...payload(uniqueEmail("fast")), formToken: await formToken(page) })
    expect(r.status()).toBe(429)
    expect((await r.json()).code).toBe("too_fast")

    // ловушка для ботов
    let token = await formToken(page)
    await page.waitForTimeout(400)
    r = await post({ ...payload(uniqueEmail("bot")), formToken: token, website: "http://spam" })
    expect(r.status()).toBe(400)
    expect((await r.json()).code).toBe("spam")

    // идемпотентность: тот же ключ — та же заявка
    const email = uniqueEmail("limit")
    const first = payload(email)
    token = await formToken(page)
    await page.waitForTimeout(400)
    const a = await post({ ...first, formToken: token })
    const b = await post({ ...first, formToken: token })
    expect(a.status()).toBe(201)
    expect(b.status()).toBe(200)
    expect((await a.json()).request.publicNo).toBe((await b.json()).request.publicNo)
    expect((await b.json()).replayed).toBe(true)

    // лимит: не больше 3 заявок с одного email за сутки
    for (let i = 0; i < 2; i++) expect((await post({ ...payload(email), formToken: token })).status()).toBe(201)
    r = await post({ ...payload(email), formToken: token })
    expect(r.status()).toBe(429)
    expect((await r.json()).code).toBe("rate_limited")
    expect(await sql("SELECT id FROM portal_access_requests WHERE email = $1", [email])).toHaveLength(3)

    // чужой Origin
    r = await page.request.post("/api/requests", { data: { ...payload(uniqueEmail("csrf")), formToken: token }, headers: { Origin: "https://evil.example", "Content-Type": "application/json" } })
    expect(r.status()).toBe(403)
  })
})
