/** Извлекает имя столбца из типичного сообщения PostgreSQL (ru/en). */
function extractColumnName(raw: string): string | undefined {
  const ru = raw.match(/столбец\s+"([^"]+)"/i);
  if (ru?.[1]) return ru[1];
  const en = raw.match(/column\s+"([^"]+)"/i);
  if (en?.[1]) return en[1];
  return undefined;
}

const COLUMN_HINTS: Record<string, string> = {
  is_marked: "маркировка (Честный знак)",
  is_perishable: "скоропорт / FEFO",
  rotation_policy: "политика ротации (FIFO/FEFO)",
  packaging_profile: "профиль упаковки (custom / stickers / water)",
  uom_code: "единица измерения",
  item_code: "код номенклатуры",
  name: "название",
  site_id: "склад / сайт",
};

/** Короткое сообщение для UI по тексту ошибки БД (и при наличии — SQLSTATE). */
export function postgresErrorToRuMessage(raw: string, sqlState?: string): string {
  const m = raw.trim();
  if (!m) return "Ошибка при сохранении в базу данных.";

  if (sqlState === "23505" || /unique|duplicate key|нарушает ограничение unique/i.test(m)) {
    return "Такой код, штрихкод или другая уникальная комбинация уже есть. Измените код или откройте существующую запись.";
  }
  if (sqlState === "23503" || /foreign key|нарушает ограничение внешнего ключа/i.test(m)) {
    return "Ссылка на связанный справочник неверна (группа, единица измерения и т.п.). Проверьте значения или обратитесь к администратору.";
  }
  if (
    sqlState === "23502" ||
    /NOT NULL|not null|violates not-null|нарушает ограничение NOT NULL/i.test(m)
  ) {
    const col = extractColumnName(m);
    const hint = col ? COLUMN_HINTS[col] ?? col : undefined;
    if (hint) {
      return `Не удалось сохранить: для поля «${hint}» требуется значение. Заполните форму или сообщите администратору.`;
    }
    return "Не удалось сохранить: не хватает обязательного поля в базе. Проверьте форму или обратитесь к администратору.";
  }
  if (sqlState === "23514" || /check constraint|нарушает ограничение проверки/i.test(m)) {
    return "Значение не подходит под правила базы (например, допустимый список или формат). Проверьте введённые данные.";
  }
  if (
    sqlState === "42703" ||
    (/не существует|does not exist/i.test(m) && /столбец|column/i.test(m))
  ) {
    return "Схема базы не совпадает с приложением (нет ожидаемой колонки или таблицы). Обновите БД из актуального db/schema.sql или выполните блок ALTER в конце файла.";
  }

  return m.length > 280 ? `${m.slice(0, 277)}…` : m;
}

export function wmsDbErrorToUserMessage(err: unknown): string {
  const e = err as { message?: string; code?: string };
  const msg = typeof e?.message === "string" ? e.message : String(err);
  const code = typeof e?.code === "string" && /^\d{5}$/.test(e.code) ? e.code : undefined;
  return postgresErrorToRuMessage(msg, code);
}
