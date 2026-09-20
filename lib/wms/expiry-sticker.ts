/** Пороги «срока стикера» — дни с даты эмиссии кода (не до expiry). */
export const STICKER_WARN_DAYS_SINCE_EMISSION = 330;
export const STICKER_CRITICAL_DAYS_SINCE_EMISSION = 350;
export const DEFAULT_STICKER_SHELF_LIFE_DAYS = 365;

export type StickerExpiryTier = "ok" | "warning" | "critical" | "expired";

const MS_DAY = 86_400_000;

function startOfLocalDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Календарные дни с даты эмиссии (положительное = эмиссия в прошлом). */
export function daysSinceEmission(emissionIso: string, now = new Date()): number | null {
  const emission = new Date(emissionIso);
  if (Number.isNaN(emission.getTime())) return null;
  return Math.round((startOfLocalDay(now) - startOfLocalDay(emission)) / MS_DAY);
}

export function computeStickerExpiryTier(daysSince: number): StickerExpiryTier {
  if (daysSince >= DEFAULT_STICKER_SHELF_LIFE_DAYS) return "expired";
  if (daysSince >= STICKER_CRITICAL_DAYS_SINCE_EMISSION) return "critical";
  if (daysSince >= STICKER_WARN_DAYS_SINCE_EMISSION) return "warning";
  return "ok";
}

/** Календарный срок годности уже прошёл (по expiry / «годен до»). */
export function isCalendarExpiryPast(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return false;
  return startOfLocalDay(end) < startOfLocalDay(now);
}

export function stickerExpiryRefKey(
  itemCode: string,
  lotCode: string,
  tier: "warning" | "critical" | "expired",
  locationCode?: string | null
): string {
  const loc = (locationCode || "_").trim() || "_";
  return `expiry_sticker:${itemCode}:${lotCode}:${loc}:${tier}`;
}

export function formatStickerAlertTitle(input: {
  itemName: string;
  itemCode: string;
  locationCode?: string | null;
  expired?: boolean;
}): string {
  const code = (input.locationCode || "").trim();
  if (code && input.expired) return `Ячейка ${code} просрочена`;
  if (code) return `Ячейка ${code} · срок стикера`;
  const short = input.itemName.length > 48 ? `${input.itemName.slice(0, 45)}…` : input.itemName;
  return `Срок стикера · ${short || input.itemCode}`;
}

export function formatStickerAlertBody(input: {
  itemCode: string;
  lotCode: string;
  emissionLabel: string;
  daysSinceEmission: number;
  shelfLifeDays: number;
  qty: number;
  tier: "warning" | "critical" | "expired";
  locationCode?: string | null;
}): string {
  const daysLeft = Math.max(0, input.shelfLifeDays - input.daysSinceEmission);
  const intro =
    input.tier === "expired"
      ? `Срок годности стикера истёк: со дня эмиссии прошло ${input.daysSinceEmission} дн. (лимит ${input.shelfLifeDays}). Спишите просроченный объём.`
      : input.tier === "critical"
        ? `Со дня эмиссии кода прошло ${input.daysSinceEmission} дн. (из ${input.shelfLifeDays}). Срок годности стикера истекает — проведите списание просроченного объёма.`
        : `Со дня эмиссии кода прошло ${input.daysSinceEmission} дн. (из ${input.shelfLifeDays}). Срок годности стикера скоро истечёт — проверьте партию.`;
  const lines = [
    `itemCode:${input.itemCode}`,
    `lotCode:${input.lotCode}`,
  ];
  if (input.locationCode) lines.push(`locationCode:${input.locationCode}`);
  lines.push(
    intro,
    input.tier === "expired"
      ? `Эмиссия: ${input.emissionLabel}. На остатке: ${input.qty} шт.`
      : `Эмиссия: ${input.emissionLabel}. Осталось ~${daysLeft} дн. до конца срока. На складе: ${input.qty} шт.`,
    "Уведомление исчезнет после списания этого объёма."
  );
  return lines.join("\n");
}
