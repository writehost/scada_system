export const DEFAULT_EXPIRY_MAIL_TIME_ZONE = "Asia/Vladivostok";
export const DEFAULT_EXPIRY_MAIL_SEND_HOUR = 8;

export const EXPIRY_MAIL_TIME_ZONES = [
  { id: "Asia/Vladivostok", label: "Владивосток (UTC+10)", short: "Владивосток" },
  { id: "Asia/Sakhalin", label: "Сахалин (UTC+11)", short: "Сахалин" },
  { id: "Asia/Kamchatka", label: "Камчатка (UTC+12)", short: "Камчатка" },
  { id: "Asia/Magadan", label: "Магадан (UTC+11)", short: "Магадан" },
  { id: "Asia/Yakutsk", label: "Якутск (UTC+9)", short: "Якутск" },
  { id: "Asia/Irkutsk", label: "Иркутск (UTC+8)", short: "Иркутск" },
  { id: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)", short: "Красноярск" },
  { id: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)", short: "Новосибирск" },
  { id: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)", short: "Екатеринбург" },
  { id: "Europe/Moscow", label: "Москва (UTC+3)", short: "МСК" },
  { id: "Europe/Kaliningrad", label: "Калининград (UTC+2)", short: "Калининград" },
] as const;

export type ExpiryMailTimeZoneId = (typeof EXPIRY_MAIL_TIME_ZONES)[number]["id"];

export function isExpiryMailTimeZone(value: string): value is ExpiryMailTimeZoneId {
  return EXPIRY_MAIL_TIME_ZONES.some((zone) => zone.id === value);
}

export function parseExpiryMailTimeZone(raw: unknown): string {
  if (typeof raw === "string" && isExpiryMailTimeZone(raw.trim())) return raw.trim();
  return DEFAULT_EXPIRY_MAIL_TIME_ZONE;
}

export function parseExpiryMailSendHour(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_MAIL_SEND_HOUR;
  return Math.min(23, Math.max(0, Math.round(n)));
}

export function dateKeyInTimeZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function hourInTimeZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
}

export function formatDateTimeInTimeZone(iso: string | Date, timeZone: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return typeof iso === "string" ? iso : "";
  return date.toLocaleString("ru-RU", { timeZone });
}

export function expiryMailTimeZoneShort(timeZone: string): string {
  return EXPIRY_MAIL_TIME_ZONES.find((zone) => zone.id === timeZone)?.short ?? timeZone;
}

export function alreadySentOnLocalDay(
  lastSentAt: string | null,
  timeZone: string,
  now = new Date()
): boolean {
  if (!lastSentAt) return false;
  const last = new Date(lastSentAt);
  if (Number.isNaN(last.getTime())) return false;
  return dateKeyInTimeZone(last, timeZone) === dateKeyInTimeZone(now, timeZone);
}

export function isBeforeSendHour(timeZone: string, sendHour: number, now = new Date()): boolean {
  return hourInTimeZone(now, timeZone) < sendHour;
}

export function formatSendHour(hour: number): string {
  return `${String(parseExpiryMailSendHour(hour)).padStart(2, "0")}:00`;
}
