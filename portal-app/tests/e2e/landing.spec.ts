import { expect, test } from "@playwright/test"

test.describe("главная страница", () => {
  test("hero, каталог и SEO", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("SCADA")
    await expect(page.getByText("Единая цифровая экосистема для управления вашим бизнесом.")).toBeVisible()
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /SCADA SYSTEM/)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^http:\/\/127\.0\.0\.1:3120\/?$/)

    const catalog = page.locator("#products")
    await expect(catalog.getByRole("heading", { level: 3 })).toHaveCount(9)
    // продукт в разработке нельзя запросить
    const ems = catalog.locator("li", { has: page.getByRole("heading", { name: "SCADA EMS" }) })
    await expect(ems.getByText("В разработке")).toBeVisible()
    await expect(ems.getByRole("link", { name: /Запросить доступ/ })).toHaveCount(0)
    // неавторизованный посетитель не видит «Открыть» и «Мои приложения»
    await expect(catalog.getByRole("link", { name: /^Открыть/ })).toHaveCount(0)
    await expect(page.locator("#my-apps")).toHaveCount(0)
  })

  test("фильтр каталога по категориям", async ({ page }) => {
    await page.goto("/")
    const catalog = page.locator("#products")
    await catalog.getByRole("button", { name: /^Логистика/ }).click()
    await expect(catalog.getByRole("heading", { level: 3 })).toHaveText(["SCADA WMS", "SCADA YMS"])
    await catalog.getByRole("button", { name: /^Медицина/ }).click()
    await expect(catalog.getByRole("heading", { level: 3 })).toHaveText(["SCADA XRAY"])
    await catalog.getByRole("button", { name: /^Все продукты/ }).click()
    await expect(catalog.getByRole("heading", { level: 3 })).toHaveCount(9)
  })

  test("узел карты экосистемы открывает карточку продукта", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: /^SCADA QPass:/ }).click()
    const dialog = page.getByRole("dialog", { name: "SCADA QPass" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Паспорт QPass в карточке номенклатуры")).toBeVisible()
    await dialog.getByRole("link", { name: "Запросить доступ" }).click()
    await expect(page).toHaveURL(/\/request\?modules=qpass/)
    await expect(page.getByTestId("module-qpass")).toBeChecked()
  })

  test("страница продукта и честные ограничения", async ({ page }) => {
    await page.goto("/products/yms")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("SCADA YMS")
    await expect(page.getByText("Пилотная версия").first()).toBeVisible()
    await expect(page.getByText("Нет календаря окон, SMS-уведомлений и распознавания номеров")).toBeVisible()
    const r = await page.goto("/products/unknown")
    expect(r?.status()).toBe(404)
  })

  test("robots и sitemap", async ({ request }) => {
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /admin")
    const sm = await (await request.get("/sitemap.xml")).text()
    expect(sm).toContain("/products/wms")
    expect(sm).toContain("/request")
  })
})
