/**
 * Проверка экранов Route в браузере (Playwright/Chromium) на стенде с настоящим API:
 *  - экран водителя без прокрутки на 1280×800, 1024×600, 800×480;
 *  - полный проход задания через интерфейс: выбор кары → принять → скан неверной/верной палеты (клавиатурный
 *    сканер) → погрузка → прибытие → скан адреса → постановка подтверждена WMS;
 *  - диспетчерская и редактор карты.
 * Запуск: node tests/route/preview/build.mjs /tmp/route-preview && node tests/route/ui.e2e.mjs /tmp/route-shots
 */
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { SSCC, api, base, psql, setupStand, teardownStand, YMS_PORT, SECRET } from "./stand.mjs"
import { createHmac } from "node:crypto"

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/home/claude/.npm-global/lib/node_modules/playwright")
const OUT = path.resolve(process.argv[2] || "/tmp/route-shots")
mkdirSync(OUT, { recursive: true })

function cookieValue(login) {
  const id = psql(`SELECT user_id FROM wms_users WHERE login = '${login}'`)
  const now = Date.now()
  const data = Buffer.from(JSON.stringify({ userId: id, login, fio: login, position: "t", iat: now, exp: now + 3600_000, aud: "yms" })).toString("base64url")
  return `${data}.${createHmac("sha256", SECRET).update(data).digest("base64url")}`
}

async function noScroll(page, label) {
  const m = await page.evaluate(() => {
    const se = document.scrollingElement
    const card = document.querySelector(".rt-card")?.getBoundingClientRect()
    const map = document.querySelector(".rt-mapwrap")?.getBoundingClientRect()
    const top = document.querySelector(".rt-top")?.getBoundingClientRect()
    const btn = document.querySelector(".rt-btn.primary")?.getBoundingClientRect()
    const overflow = [...document.querySelectorAll(".rt-driver *")].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1
    }).length
    return {
      vw: innerWidth,
      vh: innerHeight,
      sh: se.scrollHeight,
      sw: se.scrollWidth,
      card: card ? { top: card.top, bottom: card.bottom, h: card.height } : null,
      map: map ? { h: map.height } : null,
      top: top ? { h: top.height } : null,
      btn: btn ? { w: btn.width, h: btn.height } : null,
      overflow,
    }
  })
  assert.ok(m.sh <= m.vh + 1 && m.sw <= m.vw + 1, `${label}: прокрутка ${JSON.stringify(m)}`)
  assert.equal(m.overflow, 0, `${label}: элементы за краем экрана ${JSON.stringify(m)}`)
  if (m.card) assert.ok(m.card.bottom <= m.vh + 1, `${label}: карточка обрезана`)
  if (m.btn) assert.ok(m.btn.h >= 56 && m.btn.w >= 56, `${label}: основная кнопка меньше 56×56`)
  const share = m.map.h / m.vh
  console.log(`  ${label}: карта ${(share * 100).toFixed(0)}% высоты, верх ${m.top.h}px, карточка ${Math.round(m.card?.h ?? 0)}px, кнопка ${Math.round(m.btn?.h ?? 0)}px`)
  return m
}

async function main() {
  await setupStand({ staticDir: process.env.PREVIEW_DIR || "/tmp/route-preview" })
  try {
    // данные: опубликованная карта, задание из WMS, ручная позиция
    const v = await api("GET", "/api/route/map/versions", { as: "mapadmin" })
    const draft = v.body.versions.find((x) => x.status === "draft")
    const full = await api("GET", `/api/route/map/versions/${draft.mapId}`, { as: "mapadmin" })
    const g = full.body.map.geometry
    const near = g.nodes.filter((n) => n.kind !== "access").sort((a, b) => Math.hypot(a.x - 900, a.y - 1200) - Math.hypot(b.x - 900, b.y - 1200))[0]
    g.points.push({ id: "pt-sipa", code: "LINE-SIPA", kind: "line_pickup", nodeId: near.id, label: "Линия SIPA" })
    await api("PUT", `/api/route/map/versions/${draft.mapId}`, { as: "mapadmin", body: { geometry: g, expectedRevision: full.body.map.revision } })
    const pub = await api("POST", `/api/route/map/versions/${draft.mapId}/publish`, { as: "mapadmin", body: { note: "ui" } })
    assert.equal(pub.status, 200)
    await api("PUT", "/api/route/demand", { as: "disp", body: { wmsTasks: true } })
    await api("POST", "/api/route/demand", { as: "disp" })
    const start = g.nodes.find((n) => n.id === "acc-A-60")
    await api("POST", "/api/route/forklifts/kara-1/position", { as: "disp", body: { x: start.x, y: start.y, headingDeg: -90 } })
    await api("POST", "/api/route/forklifts/kara-2/position", { as: "disp", body: { x: start.x - 400, y: start.y + 120, headingDeg: 0 } })

    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
    await ctx.addCookies([{ name: "yms_session", value: cookieValue("driver1"), domain: "127.0.0.1", path: "/" }])
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)
    page.on("console", (m) => process.env.UI_DEBUG && console.log("[page]", m.type(), m.text()))
    const errors = []
    page.on("pageerror", (e) => errors.push(String(e)))
    page.on("console", (m) => m.type() === "error" && !/EventSource|404|net::/.test(m.text()) && errors.push(m.text()))

    await page.goto(`${base}/route`)
    await page.getByRole("button", { name: /Кара №1/ }).click()
    await page.getByText("Принять задание").waitFor()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/01-offered-1280x800.png` })
    await noScroll(page, "1280×800 предложено")

    for (const [w, h] of [
      [1024, 600],
      [800, 480],
    ]) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/01-offered-${w}x${h}.png` })
      await noScroll(page, `${w}×${h} предложено`)
    }
    await page.setViewportSize({ width: 1280, height: 800 })

    await page.getByText("Принять задание").click()
    await page.getByText("К месту получения — FG-A-1").waitFor()
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/02-to-pickup-1280x800.png` })
    await noScroll(page, "1280×800 к грузу")

    // аппаратный сканер: быстрый ввод + Enter
    const scanKeys = async (code) => {
      await page.keyboard.type(code, { delay: 4 })
      await page.keyboard.press("Enter")
    }
    await scanKeys(SSCC.P6)
    await page.getByText("Неверная палета", { exact: true }).waitFor()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/03-wrong-pallet-1280x800.png` })
    for (const [w, h] of [
      [1024, 600],
      [800, 480],
    ]) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/03-wrong-pallet-${w}x${h}.png` })
      await noScroll(page, `${w}×${h} неверная палета`)
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await scanKeys(SSCC.P1)
    await page.getByRole("button", { name: "Подтвердить погрузку" }).waitFor()
    await page.screenshot({ path: `${OUT}/04-pallet-ok-1280x800.png` })
    await page.getByRole("button", { name: "Подтвердить погрузку" }).click()
    await page.getByText("Доставьте палету в FG-A-32").waitFor()
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/05-to-dropoff-1280x800.png` })
    await page.setViewportSize({ width: 800, height: 480 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/05-to-dropoff-800x480.png` })
    await noScroll(page, "800×480 перевозка")
    await page.setViewportSize({ width: 1280, height: 800 })

    await page.getByRole("button", { name: "Я на месте" }).click()
    await page.getByText("Подтвердите адрес FG-A-32").waitFor()
    await scanKeys("https://wms.scada25.ru/s/c/FG-A-31")
    await page.getByText("Неверный адрес", { exact: true }).waitFor()
    await page.screenshot({ path: `${OUT}/06-wrong-address-1280x800.png` })
    await scanKeys("FG-A-32")
    await page.getByRole("button", { name: "Подтвердить постановку" }).waitFor()
    await page.screenshot({ path: `${OUT}/07-address-ok-1280x800.png` })
    await page.getByRole("button", { name: "Подтвердить постановку" }).click()
    await page.getByText(/Нет активных заданий|Новое задание/).waitFor()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/08-done-1280x800.png` })
    assert.equal(psql(`SELECT status FROM route_tasks ORDER BY task_id LIMIT 1`), "COMPLETED")
    const at = psql(`SELECT l.location_code FROM wms_item_codes mic JOIN codes c ON c.code_id = mic.code_id JOIN wms_locations l ON l.location_id = mic.current_location_id WHERE c.ai21_serial = '${SSCC.P1.slice(2)}'`)
    assert.equal(at, "FG-A-32", "WMS обновила адрес палеты после подтверждения в интерфейсе")

    // кнопка «Проблема» — компактное окно без перехода
    await api("POST", "/api/route/tasks", { as: "disp", body: { type: "RELOCATION", sourceCode: "FG-A-2", destCode: "FG-A-31", huCode: SSCC.P2 } })
    await page.reload()
    await page.getByText("Принять задание").waitFor()
    await page.getByText("Принять задание").click()
    await page.getByRole("button", { name: "Проблема" }).click()
    await page.getByRole("dialog", { name: "Проблема" }).waitFor()
    await page.screenshot({ path: `${OUT}/09-problem-1280x800.png` })
    await page.getByRole("button", { name: "Палеты нет на месте" }).click()
    await page.getByText(/Остановлено/).waitFor()
    await page.screenshot({ path: `${OUT}/10-blocked-1280x800.png` })

    // диспетчерская и редактор
    const d = await browser.newContext({ viewport: { width: 1600, height: 900 } })
    await d.addCookies([{ name: "yms_session", value: cookieValue("disp"), domain: "127.0.0.1", path: "/" }])
    const dp = await d.newPage()
    dp.on("pageerror", (e) => errors.push(String(e)))
    await dp.goto(`${base}/route/dispatch`)
    await dp.getByText("ДИСПЕТЧЕРСКАЯ").waitFor()
    await dp.waitForTimeout(1200)
    await dp.getByRole("button", { name: /Проблемы/ }).click()
    await dp.waitForTimeout(300)
    await dp.screenshot({ path: `${OUT}/11-dispatch-problems-1600x900.png` })
    await dp.getByRole("button", { name: /Задания/ }).click()
    await dp.locator(".rt-item").first().click()
    await dp.waitForTimeout(700)
    await dp.screenshot({ path: `${OUT}/12-dispatch-tasks-1600x900.png` })

    const e = await browser.newContext({ viewport: { width: 1600, height: 900 } })
    await e.addCookies([{ name: "yms_session", value: cookieValue("mapadmin"), domain: "127.0.0.1", path: "/" }])
    const ep = await e.newPage()
    ep.on("pageerror", (x) => errors.push(String(x)))
    await ep.goto(`${base}/route/editor`)
    await ep.getByText("КАРТА И МЕТКИ").waitFor()
    await ep.waitForTimeout(1500)
    await ep.screenshot({ path: `${OUT}/13-editor-1600x900.png` })

    // SCADA System Forklift: камера kara-1 по данным сервиса позиционирования, kara-2 в режиме симуляции
    const dev = await api("POST", "/api/route/devices", { as: "mapadmin", body: { karaId: "kara-1" } })
    await api("POST", "/api/route/localizer/status", {
      bearer: dev.body.token,
      body: { source: "apriltag-tracking", camera: "ok", captureFps: 7.1, lastFrameAt: Date.now() / 1000, visibleTags: ["tag16h5:3"],
        calibration: { version: "cal-demo", rmsPx: 0.16, accuracyChecked: false, note: "точность рулеткой не проверялась" } },
    })
    let r = await api("POST", "/api/route/forklifts/kara-2/mode", { as: "mapadmin", body: { mode: "SIMULATION", reason: "обучение водителей" } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    // стартовая точка учебной кары — ручная позиция диспетчера (после смены режима позиция сброшена)
    await api("POST", "/api/route/forklifts/kara-2/position", { as: "disp", body: { x: start.x - 400, y: start.y + 120, headingDeg: 0 } })
    r = await api("POST", "/api/route/tasks", { as: "disp", body: { type: "RELOCATION", sourceCode: "FG-A-40", destCode: "FG-A-34", huCode: SSCC.P4, simulation: true } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    r = await api("POST", `/api/route/tasks/${r.body.task.taskId}/dispatch`, { as: "disp", body: { action: "assign", karaId: "kara-2" } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const sc = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await sc.addCookies([{ name: "yms_session", value: cookieValue("driver2"), domain: "127.0.0.1", path: "/" }])
    const sp = await sc.newPage()
    sp.setDefaultTimeout(15000)
    sp.on("pageerror", (x) => errors.push(String(x)))
    await sp.goto(`${base}/route`)
    await sp.getByRole("button", { name: /Кара №2/ }).click()
    await sp.getByText("СИМУЛЯЦИЯ", { exact: true }).waitFor()
    await sp.getByText("Принять задание").click()
    await sp.getByRole("button", { name: /Ехать по маршруту/ }).click()
    await sp.waitForTimeout(3000)
    const simPos = psql(`SELECT source FROM route_positions WHERE kara_id = 'kara-2'`)
    assert.equal(simPos, "simulation", "симулятор пишет учебную позицию")
    await sp.screenshot({ path: `${OUT}/14-simulation-driver-1280x800.png` })
    await page.goto(`${base}/route`)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/15-real-driver-camera-1280x800.png` })
    await noScroll(page, "1280×800 REAL, камера и режим")
    await noScroll(sp, "1280×800 СИМУЛЯЦИЯ")
    await dp.reload()
    await dp.getByText("ДИСПЕТЧЕРСКАЯ").waitFor()
    await dp.getByRole("button", { name: /Погрузчики/ }).click()
    await dp.waitForTimeout(800)
    await dp.screenshot({ path: `${OUT}/16-dispatch-fleet-modes-1600x900.png` })

    await browser.close()
    assert.deepEqual(errors, [], `ошибки в браузере: ${errors.join("\n")}`)
    console.log("UI e2e: OK, скриншоты в", OUT)
  } finally {
    await teardownStand()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
  Promise.resolve(teardownStand()).finally(() => process.exit(1))
})
