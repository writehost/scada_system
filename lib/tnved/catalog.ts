/** Разделы, главы и позиции ТН ВЭД ЕАЭС — справочник для WMS. */

import { TNVED_CHAPTER_NAMES } from "./chapters"
import { TNVED_ALL_POSITIONS, TNVED_POSITIONS_BY_CHAPTER } from "./positions"

export type TnvedNode = {
  code: string
  name: string
  level: "section" | "chapter" | "position"
  parentCode?: string
  codeFrom?: string
  codeTo?: string
}

export const TNVED_SECTIONS: TnvedNode[] = [
  { code: "I", name: "Живые животные; продукты животного происхождения", level: "section", codeFrom: "01", codeTo: "05" },
  { code: "II", name: "Продукты растительного происхождения", level: "section", codeFrom: "06", codeTo: "14" },
  { code: "III", name: "Жиры и масла животного, растительного или микробного происхождения", level: "section", codeFrom: "15", codeTo: "15" },
  { code: "IV", name: "Пищевые продукты; алкогольные и безалкогольные напитки; табак", level: "section", codeFrom: "16", codeTo: "24" },
  { code: "V", name: "Минеральные продукты", level: "section", codeFrom: "25", codeTo: "27" },
  { code: "VI", name: "Продукция химической и связанных с ней отраслей промышленности", level: "section", codeFrom: "28", codeTo: "38" },
  { code: "VII", name: "Пластмассы и изделия из них; каучук и изделия из него", level: "section", codeFrom: "39", codeTo: "40" },
  { code: "VIII", name: "Необработанные шкуры, выделанная кожа, мех и изделия из них", level: "section", codeFrom: "41", codeTo: "43" },
  { code: "IX", name: "Древесина и изделия из неё; древесный уголь; пробка и изделия из неё", level: "section", codeFrom: "44", codeTo: "46" },
  { code: "X", name: "Масса из древесины; бумага и картон", level: "section", codeFrom: "47", codeTo: "49" },
  { code: "XI", name: "Текстильные материалы и текстильные изделия", level: "section", codeFrom: "50", codeTo: "63" },
  { code: "XII", name: "Обувь, головные уборы, зонты, трости", level: "section", codeFrom: "64", codeTo: "67" },
  { code: "XIII", name: "Изделия из камня, гипса, цемента; керамика; стекло", level: "section", codeFrom: "68", codeTo: "70" },
  { code: "XIV", name: "Жемчуг, драгоценные камни, металлы и изделия из них", level: "section", codeFrom: "71", codeTo: "71" },
  { code: "XV", name: "Недрагоценные металлы и изделия из них", level: "section", codeFrom: "72", codeTo: "83" },
  { code: "XVI", name: "Машины, оборудование и механизмы; электротехническое оборудование", level: "section", codeFrom: "84", codeTo: "85" },
  { code: "XVII", name: "Средства наземного транспорта, летательные аппараты, плавучие средства", level: "section", codeFrom: "86", codeTo: "89" },
  { code: "XVIII", name: "Оптические, фотографические, измерительные приборы; часы; музыкальные инструменты", level: "section", codeFrom: "90", codeTo: "92" },
  { code: "XIX", name: "Оружие и боеприпасы", level: "section", codeFrom: "93", codeTo: "93" },
  { code: "XX", name: "Разные промышленные товары", level: "section", codeFrom: "94", codeTo: "96" },
  { code: "XXI", name: "Произведения искусства, предметы коллекционирования и антиквариат", level: "section", codeFrom: "97", codeTo: "97" },
]

function padChapter(n: number): string {
  return String(n).padStart(2, "0")
}

function chaptersForSection(sectionCode: string): TnvedNode[] {
  const section = TNVED_SECTIONS.find((s) => s.code === sectionCode)
  if (!section?.codeFrom || !section.codeTo) return []
  const from = Number(section.codeFrom)
  const to = Number(section.codeTo)
  const out: TnvedNode[] = []
  for (let n = from; n <= to; n++) {
    const code = padChapter(n)
    const name = TNVED_CHAPTER_NAMES[code]
    if (!name) continue
    out.push({ code, name, level: "chapter", parentCode: sectionCode })
  }
  return out
}

function positionsForChapter(chapterCode: string): TnvedNode[] {
  const ch = chapterCode.trim().slice(0, 2)
  return (TNVED_POSITIONS_BY_CHAPTER[ch] ?? []).map((p) => ({
    code: p.code,
    name: p.name,
    level: "position" as const,
    parentCode: ch,
  }))
}

/** Все главы (01–97) с привязкой к разделу. */
export const TNVED_CHAPTERS: TnvedNode[] = TNVED_SECTIONS.flatMap((s) => chaptersForSection(s.code))

export function tnvedSectionForChapter(chapterCode: string): TnvedNode | undefined {
  const ch = chapterCode.trim().slice(0, 2)
  const chapter = TNVED_CHAPTERS.find((c) => c.code === ch)
  if (chapter?.parentCode) {
    return TNVED_SECTIONS.find((s) => s.code === chapter.parentCode)
  }
  const num = Number(ch)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return TNVED_SECTIONS.find((s) => {
    const from = Number(s.codeFrom ?? "0")
    const to = Number(s.codeTo ?? "99")
    return num >= from && num <= to
  })
}

export function getTnvedChildren(parent: string): TnvedNode[] {
  const p = parent.trim()
  if (!p) return TNVED_SECTIONS

  const section = TNVED_SECTIONS.find((s) => s.code === p)
  if (section) return chaptersForSection(p)

  if (/^\d{2}$/.test(p)) return positionsForChapter(p)

  return []
}

export function searchTnved(query: string, limit = 40): TnvedNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const positions: TnvedNode[] = TNVED_ALL_POSITIONS.map((p) => ({
    code: p.code,
    name: p.name,
    level: "position",
    parentCode: p.code.slice(0, 2),
  }))
  const all = [...TNVED_SECTIONS, ...TNVED_CHAPTERS, ...positions]
  const hits = all.filter(
    (n) =>
      n.code.toLowerCase().includes(q) ||
      n.name.toLowerCase().includes(q) ||
      (n.codeFrom && `${n.codeFrom}-${n.codeTo}`.includes(q))
  )
  return hits.slice(0, limit)
}

export function formatTnvedLabel(code: string): string {
  const c = code.trim()
  if (!c) return ""
  const pos = TNVED_ALL_POSITIONS.find((n) => c.startsWith(n.code))
  if (pos) return `${c} · ${pos.name}`
  const chapter = TNVED_CHAPTERS.find((n) => c.startsWith(n.code))
  if (chapter) return `${c} · ${chapter.name}`
  const section = tnvedSectionForChapter(c)
  if (section) return `${c} · ${section.name}`
  return c
}

export function tnvedHasPositions(chapterCode: string): boolean {
  return (TNVED_POSITIONS_BY_CHAPTER[chapterCode.trim().slice(0, 2)]?.length ?? 0) > 0
}
