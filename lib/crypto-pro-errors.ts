/** Сообщения из КриптоПро / crypto-pro / CAPICOM → понятный текст. */
export function humanizeCryptoProError(raw: unknown): string {
  const s =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? raw.message
        : (() => {
            if (raw && typeof raw === "object") {
              const rec = raw as Record<string, unknown>
              const message = typeof rec.message === "string" ? rec.message : ""
              const code = typeof rec.code === "string" || typeof rec.code === "number" ? String(rec.code) : ""
              const name = typeof rec.name === "string" ? rec.name : ""
              const detail = [name, code, message].filter(Boolean).join(" ")
              if (detail) return detail
              try {
                return JSON.stringify(rec)
              } catch {
                return String(raw)
              }
            }
            return String(raw)
          })()
  const m = s.trim()
  if (!m || m === "undefined" || m === "[object Object]" || m === "{}") {
    return (
      "Не удалось связаться с КриптоПро: пустой ответ плагина. Установите КриптоПро CSP, расширение «КриптоПро ЭЦП Browser plug-in», " +
      "разрешите его для этого сайта и обновите список сертификатов."
    )
  }
  const low = m.toLowerCase()
  if (/rutoken|рутокен|e[\s-]?token|смарт[\s-]?карт|smart\s*card|pc\/sc|scard/i.test(m)) {
    return "Не удалось обратиться к носителю ключей. Проверьте подключение Рутокена/смарт-карты и драйверы."
  }
  if (/0x80090011|pin|пин|wrong pin|blocked/i.test(m)) {
    return "Неверный PIN-код ключа или ключ заблокирован."
  }
  if (/плагин|plugin|cadesplugin|cades|extension|расширен|not\s*available|unavailable/i.test(m)) {
    return "Плагин КриптоПро недоступен. Установите «КриптоПро ЭЦП Browser plug-in» и разрешите доступ."
  }
  if (/cancel|отмен|user\s*denied/i.test(low)) {
    return "Операция отменена или доступ к ключу запрещён."
  }
  return `Ошибка КриптоПро: ${m}`
}
