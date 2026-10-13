import { expect, test } from "@playwright/test"
import { linkFrom, loginAs, mailsTo, sql, stubState, submitViaApi, uniqueEmail } from "./helpers"

test.describe("обработка заявок и приглашение SCADA ID", () => {
  test("новый пользователь: частичное одобрение → приглашение → регистрация → доступ только к одобренному", async ({ browser }) => {
    const email = uniqueEmail("newbie")
    const anon = await browser.newPage()
    await anon.goto("/")
    const { no, id } = await submitViaApi(anon, email, ["wms", "yms"], { firstName: "Нина", lastName: "Новикова", company: "ООО Тестовая организация" })
    await anon.close()

    // администратор экосистемы
    const admin = await browser.newPage()
    await loginAs(admin, "owner@scada.test", "/admin/requests")
    await expect(admin).toHaveURL(/\/admin\/requests$/)
    const row = admin.getByTestId(`row-${no}`)
    await expect(row).toContainText(email)
    await expect(row).toContainText("Новая")
    await row.click()
    await expect(admin.getByRole("heading", { name: no })).toBeVisible()

    await admin.getByTestId("assign-me").click()
    await expect(admin.getByTestId("flash")).toHaveText("Вы назначены ответственным")
    await expect(admin.getByText("На рассмотрении").first()).toBeVisible()

    // частичное одобрение: только WMS, организация из SCADA ID
    await admin.getByTestId("approve-yms").uncheck()
    await expect(admin.getByText(/Частичное одобрение/)).toBeVisible()
    await admin.getByTestId("org-select").selectOption("org-test")
    await admin.locator("#note").fill("YMS подключим после пилота")
    await admin.getByTestId("approve").click()
    await expect(admin.getByTestId("flash")).toHaveText("Заявка одобрена")

    await admin.getByTestId("invite").click()
    await expect(admin.getByTestId("flash")).toHaveText("Приглашение отправлено")
    await expect(admin.getByText("Новый пользователь — регистрация")).toBeVisible()
    await expect(admin.getByTestId("grants")).toContainText("Ожидает активации")

    // SCADA ID: пользователь создан с подтверждённым email и данными из заявки, письмо регистрации отправлено
    const st = await stubState()
    const created = st.users.find((u) => u.email === email)!
    expect(created.emailVerified).toBe(true)
    expect(created.firstName).toBe("Нина")
    expect(created.groups).toEqual([])
    const kc = st.actionEmails.find((e) => e.email === email)!
    expect(kc.actions).toEqual(["UPDATE_PROFILE", "UPDATE_PASSWORD"])
    expect(kc.clientId).toBe("scada-portal")
    expect(kc.redirectUri).toMatch(/\/activate\?token=/)

    const invite = (await mailsTo(email)).find((m) => m.subject.includes("одобрен"))!
    expect(invite.text).toContain("одобрена частично")
    expect(invite.text).toContain("Не одобрено: SCADA YMS")
    expect(invite.text).toContain("YMS подключим после пилота")
    const link = linkFrom(invite)
    expect(kc.redirectUri).toBe(link)

    // заявитель: чужая учётная запись не может активировать
    const intruder = await browser.newContext()
    const ip = await intruder.newPage()
    await loginAs(ip, "viewer@client.test", "/")
    await ip.goto(link)
    await expect(ip.getByText(/приглашение выдано для/)).toBeVisible()
    await expect(ip.getByTestId("activate")).toHaveCount(0)
    const tokenParam = new URL(link).searchParams.get("token")!
    const forced = await ip.request.post("/api/activate", { data: { token: tokenParam }, headers: { "Content-Type": "application/json" } })
    expect(forced.status()).toBe(403)
    await intruder.close()

    // заявитель: вход под своей учётной записью и активация
    const ctx = await browser.newContext()
    const user = await ctx.newPage()
    await user.goto(link)
    await expect(user.getByRole("heading", { name: `Заявка ${no}` })).toBeVisible()
    await expect(user.locator("main").getByText("SCADA WMS", { exact: true })).toBeVisible()
    await user.getByTestId("login-to-activate").click()
    await expect(user.locator("#stub-email")).toHaveValue(email)
    await user.locator("#stub-login").click()
    await user.getByTestId("activate").click()
    await expect(user.getByTestId("activation-result")).toHaveAttribute("data-status", "access_granted")

    // SCADA ID: выдан только WMS и только в выбранной организации
    const after = (await stubState()).users.find((u) => u.email === email)!
    expect(after.groups).toEqual(["g-wms-op"])
    expect(after.orgs).toEqual(["org-test"])

    // «Мои приложения» после обновления сессии
    await user.getByTestId("refresh-session").click()
    // на реальном SCADA ID здесь сработает SSO-сессия; стенд просит войти ещё раз
    await user.locator("#stub-email").fill(email)
    await user.locator("#stub-login").click()
    const myApps = user.locator("#my-apps")
    await expect(myApps.getByRole("heading", { name: "Мои приложения" })).toBeVisible()
    await expect(myApps.getByRole("link", { name: "Открыть SCADA WMS" })).toHaveAttribute("href", "https://wms.scada25.ru")
    await expect(myApps.getByRole("link", { name: "Открыть SCADA YMS" })).toHaveCount(0)
    await expect(myApps.getByText("ООО Тестовая организация").first()).toBeVisible()
    await expect(myApps.getByText(no)).toBeVisible()
    await expect(myApps.getByText("Доступ предоставлен")).toBeVisible()
    // в каталоге YMS по-прежнему только «Запросить доступ»
    await expect(user.locator("#products").getByRole("link", { name: "Запросить доступ к SCADA YMS" })).toBeVisible()
    await expect(user.locator("#products").getByRole("link", { name: "Открыть SCADA WMS" })).toBeVisible()

    const [r] = await sql<{ status: string; approved_modules: string[] }>("SELECT status, approved_modules FROM portal_access_requests WHERE id = $1", [id])
    expect(r.status).toBe("access_granted")
    expect(r.approved_modules).toEqual(["wms"])

    // журнал действий
    await admin.reload()
    const events = admin.getByTestId("events")
    for (const t of ["Заявка отправлена", "Назначен ответственный", "Выбраны модули для одобрения", "Статус изменён: Одобрена", "Отправлено приглашение SCADA ID", "Заявитель активировал доступ", "Статус изменён: Доступ предоставлен"]) {
      await expect(events.getByText(t, { exact: true }).first()).toBeVisible()
    }
    await ctx.close()
  })

  test("существующий пользователь и ручная выдача, если группа приложения не настроена", async ({ browser }) => {
    const email = "existing@client.test"
    const anon = await browser.newPage()
    await anon.goto("/")
    const { no, id } = await submitViaApi(anon, email, ["qpass"])
    await anon.close()

    const admin = await browser.newPage()
    await loginAs(admin, "owner@scada.test", `/admin/requests/${id}`)
    await admin.getByTestId("to-review").click()
    await admin.getByTestId("org-select").selectOption("org-skit")
    await admin.getByTestId("approve").click()
    await expect(admin.getByTestId("flash")).toHaveText("Заявка одобрена")
    await admin.getByTestId("invite").click()
    await expect(admin.getByText("Существующая учётная запись")).toBeVisible()
    expect((await stubState()).actionEmails.filter((e) => e.email === email)).toHaveLength(0)

    const invite = (await mailsTo(email)).find((m) => m.subject.includes(no) && m.subject.includes("одобрен"))!
    expect(invite.text).toContain("У вас уже есть учётная запись SCADA ID")
    const link = linkFrom(invite)

    const user = await browser.newPage()
    await loginAs(user, email, new URL(link).pathname + new URL(link).search)
    await user.getByTestId("activate").click()
    await expect(user.getByTestId("activation-result")).toHaveAttribute("data-status", "invited")
    await expect(user.getByText("выдаст администратор")).toBeVisible()

    const notice = (await mailsTo("owner@scada.test")).find((m) => m.subject.includes(`${no}: ручная выдача`))
    expect(notice).toBeTruthy()

    await admin.reload()
    await expect(admin.getByTestId("grants")).toContainText("Выдать вручную")
    await admin.locator("#manual").fill("Роль viewer в scada-qpass выдана в консоли SCADA ID")
    await admin.getByRole("button", { name: "Подтвердить" }).click()
    await expect(admin.getByTestId("flash")).toHaveText("Доступ отмечен выданным")
    const [r] = await sql<{ status: string }>("SELECT status FROM portal_access_requests WHERE id = $1", [id])
    expect(r.status).toBe("access_granted")
  })

  test("отклонение с уведомлением и запрет недопустимых переходов", async ({ browser }) => {
    const email = uniqueEmail("reject")
    const anon = await browser.newPage()
    await anon.goto("/")
    const { no, id } = await submitViaApi(anon, email, ["xray"])
    await anon.close()

    const admin = await browser.newPage()
    await loginAs(admin, "owner@scada.test", `/admin/requests/${id}`)

    // нельзя одобрить «Новую» в обход рассмотрения и нельзя одобрить незапрошенное
    let r = await admin.request.patch(`/api/admin/requests/${id}`, { data: { status: "approved" }, headers: { "Content-Type": "application/json" } })
    expect(r.status()).toBe(409)
    r = await admin.request.patch(`/api/admin/requests/${id}`, { data: { approvedModules: ["wms"] }, headers: { "Content-Type": "application/json" } })
    expect(r.status()).toBe(400)
    r = await admin.request.post(`/api/admin/requests/${id}/invite`, { data: {}, headers: { "Content-Type": "application/json" } })
    expect(r.status()).toBe(409)

    admin.once("dialog", (d) => d.accept())
    await admin.locator("#note").fill("Медицинский контур разворачивается только по договору")
    await admin.getByTestId("reject").click()
    await expect(admin.getByTestId("flash")).toHaveText("Заявка отклонена")
    const mail = (await mailsTo(email)).find((m) => m.subject.includes(`решение по заявке ${no}`))!
    expect(mail.text).toContain("Медицинский контур разворачивается только по договору")
    const [row] = await sql<{ status: string }>("SELECT status FROM portal_access_requests WHERE id = $1", [id])
    expect(row.status).toBe("rejected")
  })
})

test.describe("права доступа", () => {
  test("админка закрыта для анонимов и обычных пользователей", async ({ browser, request }) => {
    expect((await request.get("/api/admin/requests")).status()).toBe(401)
    expect((await request.get("/api/requests/mine")).status()).toBe(401)
    expect((await request.post("/api/activate", { data: { token: "x".repeat(40) }, headers: { "Content-Type": "application/json" } })).status()).toBe(401)

    const anon = await browser.newPage()
    await anon.goto("/admin/requests")
    await expect(anon.locator("#stub-email")).toBeVisible() // ушли на вход SCADA ID
    await anon.close()

    const page = await browser.newPage()
    await loginAs(page, "viewer@client.test", "/admin/requests")
    await expect(page.getByRole("heading", { name: "Нет доступа" })).toBeVisible()
    expect((await page.request.get("/api/admin/requests")).status()).toBe(403)
    expect((await page.request.get("/api/admin/requests/1")).status()).toBe(403)
  })

  test("авторизованный пользователь: свои приложения и подстановка профиля в заявку", async ({ page }) => {
    await loginAs(page, "viewer@client.test", "/")
    const myApps = page.locator("#my-apps")
    await expect(myApps.getByRole("link", { name: "Открыть SCADA WMS" })).toBeVisible()
    await expect(myApps.getByText("Завод Скит").first()).toBeVisible()
    await expect(myApps.getByText("Заявок с вашего email пока нет.")).toBeVisible()
    await myApps.getByRole("link", { name: /Запросить ещё модули/ }).click()
    await page.getByTestId("module-yms").check({ force: true })
    await page.getByTestId("wizard-next").click()
    await expect(page.locator("#f-firstName")).toHaveValue("Вера")
    await expect(page.locator("#f-lastName")).toHaveValue("Наблюдатель")
    await expect(page.locator("#f-email")).toHaveValue("viewer@client.test")
    await expect(page.locator("#f-email")).toHaveAttribute("readonly", "")
    await expect(page.locator("#f-company")).toHaveValue("Завод Скит")
  })
})
