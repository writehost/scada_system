import { importJinjaTemplate } from "./jinja/importer.ts"
import { decodeEntities } from "./jinja/markers.ts"

/** Блоки Advanced Jinja, которые получатся при импорте Jinja-исходника (проекта Studio ещё нет). */
export function rawBlocksFromJinja(jinja: string): string[] {
  const { html } = importJinjaTemplate(jinja)
  return [...html.matchAll(/data-jinja-raw="([^"]*)"/g)].map((m) => decodeEntities(m[1])).sort()
}
