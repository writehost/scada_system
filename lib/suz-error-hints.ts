/** Человекочитаемые подсказки к типовым кодам ошибок СУЗ / ЧЗ в теле ответа. */

const HINT_BUFFER_EXHAUSTED =
  "Буфер по этому заказу и GTIN исчерпан (статус EXHAUSTED): свободных КМ для выдачи нет — они уже забраны или заказ закрыт. Нужен новый заказ эмиссии в СУЗ или другая строка заказа/GTIN с активным буфером."

const HINT_UOT_SUZ_ID =
  "Проверьте маркер безопасности (clientToken), omsId СУЗ и подпись КЭП: участник и СУЗ должны совпадать с данными в личном кабинете; токен не должен быть просрочен."

export function appendSuzDiagnosticHints(summary: string): string {
  const s = summary.trim()
  if (!s) return s
  const hints: string[] = []

  if (
    (/\b3390\b|EXHAUSTED|buffer status not ACTIVE/i.test(s)) &&
    !s.includes("новый заказ эмиссии в СУЗ")
  ) {
    hints.push(HINT_BUFFER_EXHAUSTED)
  }

  if (
    (/\b1110\b|UOT credentials|SUZ identifier value not specified/i.test(s)) &&
    !s.includes("маркер безопасности (clientToken)")
  ) {
    hints.push(HINT_UOT_SUZ_ID)
  }

  if (hints.length === 0) return s
  return `${s}\n\n${hints.join("\n\n")}`
}
