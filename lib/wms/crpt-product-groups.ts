/** Товарные группы ЧЗ (productGroup) → русское название. */
export const CRPT_PRODUCT_GROUP_LABELS: Record<string, string> = {
  water: "Вода",
  milk: "Молочная продукция",
  softdrinks: "Безалкогольные напитки",
  juice: "Соки",
  nabeer: "Безалкогольное пиво",
  beer: "Пиво",
  alcohol: "Алкоголь",
  tobacco: "Табак",
  otp: "Альтернативная табачная продукция",
  ncp: "Никотиносодержащая продукция",
  shoes: "Обувь",
  clothes: "Одежда",
  textiles: "Текстиль",
  tires: "Шины",
  perfumery: "Парфюмерия",
  electronics: "Электроника",
  photo: "Фото",
  bicycle: "Велосипеды",
  wheelchairs: "Кресла-коляски",
  vetpharma: "Ветпрепараты",
  bio: "Биологически активные добавки",
  antiseptic: "Антисептики",
  petfood: "Корма для животных",
  seafood: "Морепродукты",
  conserve: "Консервы",
  vegetableoil: "Растительные масла",
  grocery: "Бакалея",
  sweets: "Сладости",
  autofluids: "Автомобильные жидкости",
  chemistry: "Бытовая химия",
  toys: "Игрушки",
  books: "Книги",
  construction: "Строительные материалы",
  fire: "Пиротехника",
  heater: "Отопительные приборы",
  cableraw: "Кабельная продукция",
  radio: "Радиоэлектроника",
  opticfiber: "Оптоволокно",
  medicals: "Медизделия",
  furs: "Меховые изделия",
  lp: "Легкая промышленность",
  beer_alcohol: "Пиво и алкоголь",
};

export function russifyCrptProductGroup(code: unknown): string {
  const key = String(code ?? "")
    .trim()
    .toLowerCase();
  if (!key) return "—";
  return CRPT_PRODUCT_GROUP_LABELS[key] ?? key;
}

const CRPT_LABEL_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CRPT_PRODUCT_GROUP_LABELS).flatMap(([code, label]) => [
    [code.toLowerCase(), code],
    [label.toLowerCase(), code],
  ])
);

/** Канонический код ЧЗ: alcohol вместо «Алкоголь», water вместо «Вода». */
export function normalizeCrptProductGroupCode(raw: unknown): string {
  const token = String(raw ?? "").trim();
  if (!token) return "";
  const lower = token.toLowerCase();
  if (CRPT_PRODUCT_GROUP_LABELS[lower]) return lower;
  const mapped = CRPT_LABEL_TO_CODE[lower];
  if (mapped) return mapped;
  return token;
}

export function hasCyrillicText(value: unknown): boolean {
  return /[а-яё]/i.test(String(value ?? ""));
}

/** Человекочитаемое название для справочника по сырому значению из номенклатуры. */
export function suggestItemGroupDisplayName(raw: string, canonicalCode: string): string {
  const trimmed = raw.trim();
  const fromCrpt = CRPT_PRODUCT_GROUP_LABELS[canonicalCode.toLowerCase()];
  if (fromCrpt) return fromCrpt;
  if (hasCyrillicText(trimmed)) return trimmed;
  return trimmed;
}

export function listCrptProductGroupOptions(): Array<{ code: string; name: string }> {
  return Object.entries(CRPT_PRODUCT_GROUP_LABELS)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function russifyCrptPackageType(generalPackageType: unknown): string {
  const key = String(generalPackageType ?? "")
    .trim()
    .toUpperCase();
  return (
    {
      GROUP: "Блок",
      BOX: "Короб",
      LEVEL1: "Уровень 1",
      LEVEL2: "Уровень 2",
      LEVEL3: "Уровень 3",
      UNIT: "Единица",
      BUNDLE: "Комплект",
      SET: "Набор",
      ATK: "АТК",
    }[key] ?? (key || "—")
  );
}
