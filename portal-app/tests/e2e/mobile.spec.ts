import { expect, test } from "@playwright/test"

test("мобильная версия: упрощённая схема, меню, без горизонтальной прокрутки", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("group", { name: "Продукты экосистемы" })).toBeVisible()
  await page.getByRole("button", { name: /SCADA WMS\. Работает/ }).click()
  await expect(page.getByRole("dialog", { name: "SCADA WMS" })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.getByRole("button", { name: "Открыть меню" }).click()
  await page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link", { name: "Вопросы" }).click()
  await expect(page.getByRole("heading", { name: "Частые вопросы" })).toBeInViewport()
})
