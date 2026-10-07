import { designHtmlToJinja } from "./jinja/exporter.ts"
import { escapeText } from "./jinja/markers.ts"
import { cleanCss } from "./jinja/sanitize.ts"
import { documentBaseCss, type PageSettings } from "./page.ts"

export type DesignPageExport = {
  /** HTML страницы дизайна в разметке редактора (data-jinja-*). */
  html: string
}

/**
 * Собирает итоговый Jinja-документ: базовый CSS листа + CSS редактора + страницы дизайна.
 * Каждая страница дизайна — <section class="doc-page">, со второй начинается новый лист;
 * динамические таблицы могут дать больше листов PDF, чем страниц дизайна.
 */
export function buildJinjaDocument(input: { title: string; page: PageSettings; css: string; pages: DesignPageExport[] }): string {
  const body = input.pages
    .map((p, i) => `<section class="doc-page" data-doc-page="${i + 1}">\n${designHtmlToJinja(p.html).trim()}\n</section>`)
    .join("\n")
  return wrapJinjaDocument({ title: input.title, page: input.page, css: input.css, body })
}

/** Обёртка готового Jinja-тела в документ с CSS листа. */
export function wrapJinjaDocument(input: { title: string; page: PageSettings; css: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeText(input.title)}</title>
<style data-doc-base>
${documentBaseCss(input.page)}
</style>
<style>
${cleanCss(input.css).trim()}
</style>
</head>
<body>
${input.body}
</body>
</html>
`
}

/** Разбивает тело импортированного документа на страницы дизайна по <section class="doc-page">. */
export function splitDesignPages(html: string): string[] {
  const re = /<section\b[^>]*class="[^"]*\bdoc-page\b[^"]*"[^>]*>/gi
  const starts: { index: number; length: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) starts.push({ index: m.index, length: m[0].length })
  if (!starts.length) return [html]
  const before = html.slice(0, starts[0].index).trim()
  const pages = starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length
    return html
      .slice(s.index + s.length, end)
      .replace(/<\/section>\s*$/i, "")
      .trim()
  })
  if (before) pages[0] = `${before}\n${pages[0]}`
  return pages
}
