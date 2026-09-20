import { slotLabel, type StorageSlotProfile } from "@/lib/storage-slot-ui"

export type LocationCodeSegment = {
  code: string
  label: string
  meaning: string
}

export type LocationCodeExplanation = {
  format: "legacy" | "semantic" | "mixed" | "unknown"
  title: string
  summary: string
  segments: LocationCodeSegment[]
  hint?: string
}

const WAREHOUSE_NAMES: Record<string, string> = {
  OS: "Склад материалов",
  MAT: "Склад материалов",
  FG: "Склад готовой продукции",
}

const ZONE_NAMES: Record<string, string> = {
  RECV: "Приёмка",
  MARK: "Стикеры",
  LINE: "Линия",
  RES: "Резерв",
  SHIP: "Отгрузка",
  "ST-SER": "Стикеры / сериализация",
  "ST-BAGG": "Стикеры / блочная агрегация",
  QUARANTINE: "Карантин",
}

const LEGACY_TAIL_LABELS: Record<string, { label: string; meaning: string }> = {
  ST: { label: "Блок стеллажа", meaning: "Номер стеллажного блока на зоне" },
  S: { label: "Секция", meaning: "Секция внутри блока (ряд / группа полок)" },
  P: { label: "Проход", meaning: "Проход или сторона стеллажа" },
  B: { label: "Ячейка", meaning: "Конкретная полка / bin" },
}

function parseLegacyTail(token: string): LocationCodeSegment | null {
  const m = token.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  const prefix = m[1].toUpperCase()
  const num = m[2]
  const meta = LEGACY_TAIL_LABELS[prefix]
  if (!meta) {
    return { code: token, label: token, meaning: "Часть физического адреса" }
  }
  return {
    code: token,
    label: `${meta.label} ${num}`,
    meaning: meta.meaning,
  }
}

function titleRu(token: string): string {
  const lower = token.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Топология на русском в коде ячейки (импорт / legacy). */
function explainRussianTopology(code: string): LocationCodeExplanation | null {
  if (!/[А-ЯЁ]/i.test(code)) return null
  const tokens = code.trim().split("-").filter(Boolean)
  if (tokens.length < 3) return null

  const segments: LocationCodeSegment[] = []
  let i = 0

  while (i < tokens.length) {
    const t0 = tokens[i]?.toUpperCase()
    const t1 = tokens[i + 1]?.toUpperCase()
    const t2 = tokens[i + 2]?.toUpperCase()
    const t3 = tokens[i + 3]?.toUpperCase()

    if (t0 === "СКЛАД" && t1 === "МАТЕРИАЛОВ") {
      segments.push({
        code: "СКЛАД-МАТЕРИАЛОВ",
        label: "Склад материалов",
        meaning: "Склад сырья и материалов (стикеры, этикетки, упаковка)",
      })
      i += 2
      continue
    }
    if (t0 === "СКЛАД" && t1 === "ГОТОВОЙ" && t2 === "ПРОДУКЦИИ") {
      segments.push({
        code: "СКЛАД-ГОТОВОЙ-ПРОДУКЦИИ",
        label: "Склад готовой продукции",
        meaning: "Склад ГП — отгрузка и хранение готовой продукции",
      })
      i += 3
      continue
    }
    if (t0 === "СТЕЛЛАЖ" && t1 === "С" && t2 === "ВОДОЙ") {
      segments.push({
        code: "СТЕЛЛАЖ-С-ВОДОЙ",
        label: "Стеллаж с водой",
        meaning: "Конкретный стеллаж (именованный участок хранения)",
      })
      i += 3
      continue
    }
    if (t0 === "ПОЛКА" && t1 && /^\d+$/.test(t1)) {
      segments.push({
        code: `${t0}-${t1}`,
        label: `Полка ${t1}`,
        meaning: "Полка внутри стеллажа",
      })
      i += 2
      continue
    }

    const token = tokens[i] ?? ""
    segments.push({
      code: token,
      label: titleRu(token),
      meaning:
        token.toUpperCase() === "СТЕЛЛАЖ"
          ? "Зона или ряд стеллажей (общий уровень топологии)"
          : token.toUpperCase() === "ПАЛЕТА"
            ? "Палетное место"
            : "Часть физического адреса",
    })
    i += 1
  }

  const stelazhParts = segments.filter((s) => /стеллаж/i.test(s.label))
  const duplicateStelazh = stelazhParts.length > 1

  return {
    format: "legacy",
    title: "Физическая топология (русский код)",
    summary:
      "Код собран из уровней склада слева направо. Склад и зона задаются в карточке ячейки отдельно — в коде остаётся только путь внутри склада.",
    segments,
    hint: duplicateStelazh
      ? "Слово «стеллаж» встречается дважды: первый уровень — общий ряд стеллажей, второй — имя конкретного стеллажа («Стеллаж с водой»). Для новых ячеек лучше назвать конкретный стеллаж без префикса: «С водой», «№2», «Линия А» — а зону выбрать в поле «Зона склада»."
      : "Для новых ячеек рекомендуем смысловой код (ST-SER-RND-SLNG-15-A01-01) и профиль хранения — так система точнее подберёт ячейку при приёмке.",
  }
}

/** Физический код вида OS-RECV-ST01-S01-P01-B01 */
function explainLegacy(code: string): LocationCodeExplanation | null {
  const parts = code.trim().split("-").filter(Boolean)
  if (parts.length < 4) return null

  const wh = parts[0]?.toUpperCase()
  const zone = parts[1]?.toUpperCase()
  if (!wh || !zone || wh.length > 3) return null

  const tail = parts.slice(2)
  const hasLegacyTail = tail.some((p) => /^(ST|S|P|B)\d+$/i.test(p))
  if (!hasLegacyTail) return null

  const segments: LocationCodeSegment[] = [
    {
      code: wh,
      label: `Склад ${wh}`,
      meaning: WAREHOUSE_NAMES[wh] ?? "Код склада в WMS",
    },
    {
      code: zone,
      label: `Зона ${zone}`,
      meaning: ZONE_NAMES[zone] ?? "Функциональная зона (приёмка, линия, хранение…)",
    },
  ]

  for (const token of tail) {
    const seg = parseLegacyTail(token)
    if (seg) segments.push(seg)
  }

  return {
    format: "legacy",
    title: "Физический адрес (старый формат)",
    summary:
      "Код читается слева направо: склад → зона → стеллаж → секция → проход → полка. Такие ячейки часто создавались демо-данными или импортом топологии склада.",
    segments,
    hint: "Для новых ячеек рекомендуем смысловой код (материал · процесс · форма · группа · объём · адрес).",
  }
}

/** Смысловой код вида ST-SER-RND-SLNG-15-A01-01 */
function explainSemantic(
  code: string,
  profile?: StorageSlotProfile | null
): LocationCodeExplanation | null {
  const parts = code.trim().split("-").filter(Boolean)
  if (parts.length < 6) return null

  const material = parts[0]?.toUpperCase()
  const process = parts[1]?.toUpperCase()
  const shape = parts[2]?.toUpperCase()
  const group = parts[3]?.toUpperCase()
  const volume = parts[4]?.toUpperCase()
  const physical = parts.slice(5).join("-")

  const knownMaterial = ["ST", "LB", "PK", "CP", "PL", "ANY"].includes(material)
  const knownProcess = [
    "SER",
    "BAGG",
    "PAGG",
    "CAGG",
    "PACK-WATER",
    "DRINK",
    "STORE",
    "RECV",
    "QUARANTINE",
    "DEFECT",
    "WRITEOFF",
    "ANY",
  ].includes(process)

  if (!knownMaterial || !knownProcess) return null

  const segments: LocationCodeSegment[] = [
    {
      code: material,
      label: slotLabel("materialType", material),
      meaning: "Тип материала (стикеры, этикетки, упаковка…)",
    },
    {
      code: process,
      label: slotLabel("processType", process),
      meaning: "Этап / назначение (сериализация, агрегация, приёмка…)",
    },
    {
      code: shape,
      label: slotLabel("stickerShape", shape),
      meaning: "Форма стикера или «любой»",
    },
    {
      code: group,
      label: slotLabel("productGroup", group),
      meaning: "Группа продукции (бренд / линейка)",
    },
    {
      code: volume,
      label: slotLabel("volume", volume),
      meaning: "Объём или «любой»",
    },
    {
      code: physical,
      label: `Адрес ${physical}`,
      meaning: profile?.physicalAddress
        ? `Физическое место на складе: ${profile.physicalAddress}`
        : "Физическое место на складе (полка, ряд, bin)",
    },
  ]

  return {
    format: "semantic",
    title: "Смысловой код ячейки",
    summary:
      "Код описывает, что и для чего хранится, а не только координаты стеллажа. Система использует его при подборе ячеек при приёмке.",
    segments,
    hint: "Профиль ячейки можно изменить на вкладке «Профиль» — код в справочнике при этом не меняется автоматически.",
  }
}

export function explainLocationCode(
  code: string,
  opts?: {
    slotProfile?: StorageSlotProfile | null
    warehouseCode?: string | null
    zoneCode?: string | null
  }
): LocationCodeExplanation {
  const trimmed = code.trim()
  if (!trimmed) {
    return {
      format: "unknown",
      title: "Код ячейки",
      summary: "Код не задан.",
      segments: [],
    }
  }

  const legacy = explainLegacy(trimmed)
  const semantic = explainSemantic(trimmed, opts?.slotProfile)
  const russian = explainRussianTopology(trimmed)

  if (russian && !legacy && !semantic) return russian
  if (legacy && !semantic) return legacy
  if (semantic && !legacy) return semantic

  if (legacy && semantic) {
    return {
      format: "mixed",
      title: "Составной код",
      summary: legacy.summary,
      segments: legacy.segments,
      hint: semantic.hint,
    }
  }

  const wh = opts?.warehouseCode?.trim()
  const zone = opts?.zoneCode?.trim()
  const segments: LocationCodeSegment[] = []
  if (wh) {
    segments.push({
      code: wh,
      label: `Склад ${wh}`,
      meaning: WAREHOUSE_NAMES[wh] ?? "Склад в WMS",
    })
  }
  if (zone) {
    segments.push({
      code: zone,
      label: `Зона ${zone}`,
      meaning: ZONE_NAMES[zone] ?? "Зона склада",
    })
  }
  segments.push({
    code: trimmed,
    label: "Полный код",
    meaning: "Формат не распознан автоматически — см. display name и профиль ячейки",
  })

  return {
    format: "unknown",
    title: "Код ячейки",
    summary: "Не удалось разобрать код по шаблону. Откройте профиль ячейки или обратитесь к схеме адресации вашего склада.",
    segments,
  }
}
