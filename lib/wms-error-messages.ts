import { getWmsClientErrorMeta } from "@/lib/wms-api"

const CODE_MESSAGES_RU: Record<string, string> = {
  receiving_storage_cell_missing:
    "Нет подходящей ячейки хранения для этой номенклатуры. Создайте ячейку с нужным профилем в разделе «Ячейки» или укажите ячейку в настройках приёмки.",
  receiving_location_missing:
    "Не настроена ячейка приёмки (зона RECV). Укажите её в настройках приёмки или создайте в разделе «Ячейки».",
  receiving_location_not_found: "Указанная ячейка не найдена. Проверьте код в настройках приёмки.",
  receiving_session_not_closed:
    "Документ ещё открыт — сначала закройте его на ТСД или кнопкой «Закрыть» в списке приёмки.",
  receiving_no_allowed_lines: "В документе нет успешных сканов для проведения на остаток.",
  item_not_found: "Номенклатура из скана не найдена в справочнике WMS.",
  location_not_found: "Ячейка не найдена — проверьте код в настройках приёмки или в карточке ячейки.",
  no_balance: "В выбранной ячейке нет остатка по этой номенклатуре.",
  no_postable_scans: "Нет сканов, которые можно провести на остаток (только EMITTED, не просроченные).",
  scan_event_not_found: "Скан не найден — возможно, его уже удалили. Обновите страницу.",
  unknown_site: "Неизвестная площадка WMS (siteCode). Проверьте настройки.",
  device_not_found:
    "Не зарегистрировано служебное устройство веб-интерфейса (web-operator). Обновите страницу; если не помогло — перезапустите backend WMS (:3001).",
  not_waiting_cell:
    "Передача на линию доступна для точек ожидания (WAITING) или ячеек цеха с остатком.",
  cell_empty: "Ячейка пустая — передавать на линию нечего.",
  item_mismatch: "Номенклатура в форме не совпадает с остатком в ячейке.",
}

function stripTechnicalNoise(msg: string): string {
  return msg.trim()
}

/** Сервер уже вернул понятное сообщение — не затираем его общей фразой. */
function isDescriptiveServerMessage(msg: string): boolean {
  const m = msg.trim()
  if (!m || m.startsWith("HTTP ")) return false
  const lower = m.toLowerCase()
  if (lower.includes("device not found")) return false
  if (/[«»]/.test(m)) return true
  if (/[а-яё]/i.test(m) && (m.length > 28 || /:\s*\S/.test(m))) return true
  return false
}

/** Человекочитаемое сообщение об ошибке WMS для операторских экранов. */
export function mapWmsError(e: unknown): string {
  const { code, status } = getWmsClientErrorMeta(e)
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "Неизвестная ошибка"
  const msg = stripTechnicalNoise(raw)
  const lower = msg.toLowerCase()

  if (isDescriptiveServerMessage(msg)) {
    return msg
  }

  if (code && CODE_MESSAGES_RU[code]) {
    return CODE_MESSAGES_RU[code]
  }

  if (msg.startsWith("HTTP 500") || lower.includes("internal error")) {
    return "Ошибка сервера. Обновите страницу или обратитесь к администратору."
  }

  if (lower.includes("device not found")) {
    return CODE_MESSAGES_RU.device_not_found
  }
  if (lower.includes("unknown sitecode") || lower.includes("unknown site")) {
    return CODE_MESSAGES_RU.unknown_site
  }
  if (lower.includes("item not found") || lower.includes("item or location not found")) {
    if (lower.includes("location")) {
      return "Номенклатура или ячейка не найдены. Проверьте коды."
    }
    return CODE_MESSAGES_RU.item_not_found
  }
  if (lower.includes("location not found")) {
    return CODE_MESSAGES_RU.location_not_found
  }
  if (lower.includes("no stock") || lower.includes("no balance")) {
    return CODE_MESSAGES_RU.no_balance
  }
  if (lower.includes("insufficient") || lower.includes("недостаточно")) {
    return "Недостаточно остатка для операции."
  }
  if (lower.includes("blocked") || lower.includes("заблокирован")) {
    return "Ячейка или документ заблокирован."
  }

  if (status === 404 && (lower === "not found" || msg.startsWith("HTTP 404"))) {
    return "Запись не найдена на сервере. Обновите страницу или проверьте код."
  }

  return msg || "Ошибка операции"
}

/** Убрать из баннера строки по документам, которые уже проведены. */
export function prunePostedDocErrors(
  error: string | null,
  postedDocumentIds: string[]
): string | null {
  if (!error?.trim() || postedDocumentIds.length === 0) return error
  const posted = new Set(postedDocumentIds.map((id) => id.trim().toUpperCase()).filter(Boolean))
  const kept = error
    .split("\n")
    .filter((line) => {
      const m = line.match(/^\[([A-F0-9]+)\]/i)
      if (!m) return true
      return !posted.has(m[1].toUpperCase())
    })
  const next = kept.join("\n").trim()
  return next || null
}

export function appendWmsErrorLine(prev: string | null, line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return prev ?? ""
  if (!prev?.trim()) return trimmed
  if (prev.includes(trimmed)) return prev
  return `${prev}\n${trimmed}`
}
