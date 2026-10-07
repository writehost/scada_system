import type { Browser } from "playwright-core"
import { PAGE_NUMBER_MARKUP, PAGE_TOTAL_MARKUP, placeRegions } from "./render.ts"

/**
 * PDF печатает тот же Chromium, что показывает HTML-предпросмотр и холст редактора,
 * поэтому все три выглядят одинаково. Сеть и JS в печатающей вкладке выключены:
 * шаблон получает только встроенные данные (data:-изображения, штрихкоды).
 *
 * Браузер: DOC_PDF_CHROMIUM_PATH, иначе Chromium, установленный Playwright
 * (`npx playwright install chromium`).
 */

export class PdfUnavailableError extends Error {}

let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null)
    if (b && b.isConnected()) return b
    browserPromise = null
  }
  browserPromise = (async () => {
    let chromium: typeof import("playwright-core").chromium
    try {
      chromium = (await import("playwright-core")).chromium
    } catch {
      throw new PdfUnavailableError("Пакет playwright-core не установлен на сервере")
    }
    const executablePath = process.env.DOC_PDF_CHROMIUM_PATH?.trim() || undefined
    try {
      const browser = await chromium.launch({ headless: true, executablePath, args: ["--disable-dev-shm-usage"] })
      browser.on("disconnected", () => {
        browserPromise = null
      })
      return browser
    } catch (e) {
      throw new PdfUnavailableError(
        `Не удалось запустить Chromium для PDF. Задайте DOC_PDF_CHROMIUM_PATH или выполните «npx playwright install chromium». ${(e as Error).message.split("\n")[0]}`
      )
    }
  })()
  try {
    return await browserPromise
  } catch (e) {
    browserPromise = null
    throw e
  }
}

function styleBlocks(html: string): string {
  return (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? []).join("\n")
}

/** Шаблоны колонтитулов Chromium живут в отдельном документе: переносим стили и ставим поля листа. */
function regionTemplate(content: string | null, html: string, side: "top" | "bottom"): string {
  if (!content) return "<span></span>"
  const marginMatch = /@page\s*\{[^}]*margin:\s*([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm/i.exec(html)
  const right = marginMatch ? marginMatch[2] : "15"
  const left = marginMatch ? marginMatch[4] : "15"
  const withNumbers = content
    .split(PAGE_NUMBER_MARKUP)
    .join('<span class="pageNumber"></span>')
    .split(PAGE_TOTAL_MARKUP)
    .join('<span class="totalPages"></span>')
  const pad = side === "top" ? "padding-top: 4mm;" : "padding-bottom: 4mm;"
  return `${styleBlocks(html)}<style>html,body{margin:0!important;padding:0!important;background:transparent!important;-webkit-print-color-adjust:exact;}</style>
<div style="width:100%;box-sizing:border-box;padding-left:${left}mm;padding-right:${right}mm;${pad}">${withNumbers}</div>`
}

export async function renderPdf(renderedHtml: string): Promise<Buffer> {
  const { html, header, footer } = placeRegions(renderedHtml, "pdf")
  const browser = await getBrowser()
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const page = await context.newPage()
    await page.route("**/*", (route) => {
      const url = route.request().url()
      return url.startsWith("data:") ? route.continue() : route.abort()
    })
    await page.setContent(html, { waitUntil: "load", timeout: 20000 })
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: !!(header || footer),
      headerTemplate: regionTemplate(header, html, "top"),
      footerTemplate: regionTemplate(footer, html, "bottom"),
      tagged: true,
    })
    return Buffer.from(pdf)
  } finally {
    await context.close().catch(() => {})
  }
}
