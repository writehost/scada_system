import type { Editor } from "grapesjs"
import { DOC_COMPONENTS_CSS } from "@/lib/doc-templates/components-css"
import { buildJinjaDocument, splitDesignPages } from "@/lib/doc-templates/document"
import { importJinjaTemplate, type ImportResult } from "@/lib/doc-templates/jinja/importer"
import type { PageSettings } from "@/lib/doc-templates/page"

/**
 * Мост «проект Studio ↔ Jinja».
 * Экспорт: HTML страниц редактора (data-jinja-*) → exporter → Jinja-документ.
 * Импорт: Jinja → importer → страницы и стили редактора.
 */

function stripBody(html: string): string {
  const m = /^\s*<body[^>]*>([\s\S]*)<\/body>\s*$/i.exec(html)
  return m ? m[1] : html
}

export function exportDesignPages(editor: Editor): { html: string }[] {
  return editor.Pages.getAll().map((page) => ({
    html: stripBody(editor.getHtml({ component: page.getMainComponent() } as never)),
  }))
}

export function exportJinja(editor: Editor, title: string, page: PageSettings): string {
  const css = editor.getCss({ avoidProtected: true, keepUnusedStyles: true } as never) ?? ""
  return buildJinjaDocument({ title, page, css, pages: exportDesignPages(editor) })
}

/** Стили документных блоков — часть проекта (их можно переопределить), добавляются один раз. */
export function ensureComponentRules(editor: Editor) {
  if (!editor.Css.getRule(".doc-signature")) editor.Css.addRules(DOC_COMPONENTS_CSS)
}

export function importJinjaIntoEditor(editor: Editor, jinja: string): ImportResult {
  const result = importJinjaTemplate(jinja)
  const pages = splitDesignPages(result.html)
  const pm = editor.Pages
  const existing = pm.getAll().slice()
  const created = pages.map((html, i) => pm.add({ name: `Страница ${i + 1}`, component: html } as never)!)
  if (created[0]) pm.select(created[0])
  existing.forEach((p) => pm.remove(p))
  editor.Css.clear()
  if (result.css) editor.Css.addRules(result.css)
  ensureComponentRules(editor)
  return result
}
