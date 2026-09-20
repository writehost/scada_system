import type { MarkingUiStatus } from "@/lib/types";

/** Совпадает с ref_status в БД (см. db/schema.sql). */
export const STATUS_LABEL_RU: Record<number, string> = {
  1: "Получен от ЧЗ",
  2: "В очереди на печать",
  3: "Напечатан",
  4: "Нанесён",
  5: "Введён в оборот",
  6: "Перемещён",
  7: "Отгружен",
  8: "Списан",
};

export function statusIdToUi(statusId: number): {
  label: string;
  ui: MarkingUiStatus;
} {
  const label = STATUS_LABEL_RU[statusId] ?? `Статус ${statusId}`;
  let ui: MarkingUiStatus = "in_circulation";
  if (statusId === 8) ui = "retired";
  else if (statusId === 2 || statusId === 6) ui = "withdrawn";
  return { label, ui };
}
