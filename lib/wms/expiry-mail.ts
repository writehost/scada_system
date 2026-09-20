import { spawn } from "node:child_process";
import { access, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PoolClient } from "pg";
import {
  attentionKindLabel,
  buildAttentionItems,
  type ExpiryStickerAlertBrief,
} from "@/lib/wms/attention-items";
import {
  listExpiryStickerAlerts,
  type ExpiryStickerAlertRow,
} from "@/lib/wms/expiry-alerts-sync";
import {
  DEFAULT_EXPIRY_MAIL_SEND_HOUR,
  DEFAULT_EXPIRY_MAIL_TIME_ZONE,
  alreadySentOnLocalDay,
  expiryMailTimeZoneShort,
  formatDateTimeInTimeZone,
  isBeforeSendHour,
  parseExpiryMailSendHour,
  parseExpiryMailTimeZone,
} from "@/lib/wms/expiry-mail-schedule";

export const EXPIRY_PRODUCT_MAIL_SETTING_KEY = "expiry_product_mail";
export const EXPIRY_PRODUCT_MAIL_TITLE = "Уведомление о просроченной продукции на складе";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 50;
const DEFAULT_MAIL_HELPER = "/usr/local/bin/wms-send-mail.py";

export type ExpiryProductMailSettings = {
  enabled: boolean;
  recipients: string[];
  includeWarning: boolean;
  includeCritical: boolean;
  includeExpired: boolean;
  timeZone: string;
  sendHour: number;
  lastSentAt: string | null;
  lastSentCount: number;
  lastError: string | null;
  lastSkipReason: string | null;
  updatedAt?: string | null;
};

export type ExpiryMailCompose = {
  subject: string;
  text: string;
  html: string;
  recipients: string[];
  alerts: ExpiryStickerAlertRow[];
};

export const DEFAULT_EXPIRY_PRODUCT_MAIL_SETTINGS: ExpiryProductMailSettings = {
  enabled: true,
  recipients: [],
  includeWarning: false,
  includeCritical: true,
  includeExpired: true,
  timeZone: DEFAULT_EXPIRY_MAIL_TIME_ZONE,
  sendHour: DEFAULT_EXPIRY_MAIL_SEND_HOUR,
  lastSentAt: null,
  lastSentCount: 0,
  lastError: null,
  lastSkipReason: null,
};

export function parseEmails(raw: unknown): string[] {
  const chunks: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) chunks.push(String(item ?? ""));
  } else if (typeof raw === "string") {
    chunks.push(raw);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const part of chunk.split(/[\s,;]+/)) {
      const email = part.trim().toLowerCase();
      if (!EMAIL_RE.test(email) || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
      if (out.length >= MAX_RECIPIENTS) return out;
    }
  }
  return out;
}

export function parseExpiryProductMailSettings(raw: unknown): ExpiryProductMailSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lastCount = Number(o.lastSentCount);
  return {
    enabled: o.enabled !== false,
    recipients: parseEmails(o.recipients),
    includeWarning: o.includeWarning === true,
    includeCritical: o.includeCritical !== false,
    includeExpired: o.includeExpired !== false,
    timeZone: parseExpiryMailTimeZone(o.timeZone),
    sendHour: parseExpiryMailSendHour(o.sendHour),
    lastSentAt: typeof o.lastSentAt === "string" && o.lastSentAt.trim() ? o.lastSentAt : null,
    lastSentCount: Number.isFinite(lastCount) ? Math.max(0, Math.round(lastCount)) : 0,
    lastError: typeof o.lastError === "string" && o.lastError.trim() ? o.lastError.slice(0, 500) : null,
    lastSkipReason:
      typeof o.lastSkipReason === "string" && o.lastSkipReason.trim()
        ? o.lastSkipReason.slice(0, 200)
        : null,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
  };
}

export function mergeExpiryProductMailSettings(
  current: ExpiryProductMailSettings,
  patch: unknown
): ExpiryProductMailSettings {
  const o = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const next = { ...current };
  if ("enabled" in o) next.enabled = o.enabled !== false && o.enabled !== "false";
  if ("includeWarning" in o) next.includeWarning = o.includeWarning === true || o.includeWarning === "true";
  if ("includeCritical" in o) next.includeCritical = o.includeCritical !== false && o.includeCritical !== "false";
  if ("includeExpired" in o) next.includeExpired = o.includeExpired !== false && o.includeExpired !== "false";
  if (typeof o.recipientsText === "string") next.recipients = parseEmails(o.recipientsText);
  else if ("recipients" in o) next.recipients = parseEmails(o.recipients);
  if ("timeZone" in o) next.timeZone = parseExpiryMailTimeZone(o.timeZone);
  if ("sendHour" in o) next.sendHour = parseExpiryMailSendHour(o.sendHour);
  if ("lastSentAt" in o) {
    next.lastSentAt = typeof o.lastSentAt === "string" && o.lastSentAt.trim() ? o.lastSentAt : null;
  }
  if ("lastSentCount" in o) {
    const lastCount = Number(o.lastSentCount);
    next.lastSentCount = Number.isFinite(lastCount) ? Math.max(0, Math.round(lastCount)) : 0;
  }
  if ("lastError" in o) {
    next.lastError = typeof o.lastError === "string" && o.lastError.trim() ? o.lastError.slice(0, 500) : null;
  }
  if ("lastSkipReason" in o) {
    next.lastSkipReason =
      typeof o.lastSkipReason === "string" && o.lastSkipReason.trim()
        ? o.lastSkipReason.slice(0, 200)
        : null;
  }
  return next;
}

export function filterAlertsForMail(
  alerts: ExpiryStickerAlertRow[],
  settings: Pick<ExpiryProductMailSettings, "includeWarning" | "includeCritical" | "includeExpired">
): ExpiryStickerAlertRow[] {
  return alerts.filter((alert) => {
    if (alert.tier === "expired") return settings.includeExpired;
    if (alert.tier === "critical") return settings.includeCritical;
    if (alert.tier === "warning") return settings.includeWarning;
    return false;
  });
}

export function moscowDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function alreadySentToday(
  lastSentAt: string | null,
  now = new Date(),
  timeZone = DEFAULT_EXPIRY_MAIL_TIME_ZONE
): boolean {
  return alreadySentOnLocalDay(lastSentAt, timeZone, now);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publicWmsUrl(): string {
  return (process.env.WMS_PUBLIC_URL || "https://wms.scada25.ru").replace(/\/+$/, "");
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function mailRows(alerts: ExpiryStickerAlertRow[]) {
  return alerts.map((alert) => {
    const items = buildAttentionItems({
      tasks: [],
      zones: [],
      expiryAlerts: [alert as ExpiryStickerAlertBrief],
    });
    const item = items[0];
    const title = item?.title || alert.itemName || alert.itemCode;
    const description = item?.description || `${alert.itemName}: нужно списание.`;
    return {
      title,
      description,
      badge: item ? attentionKindLabel(item.kind) : "Просрочка",
      href: `${publicWmsUrl()}${item?.href || "/attention"}`,
      tier: alert.tier,
    };
  });
}

export function composeExpiryProductMail(
  alerts: ExpiryStickerAlertRow[],
  recipients: string[],
  options: { timeZone?: string } = {}
): ExpiryMailCompose {
  const timeZone = parseExpiryMailTimeZone(options.timeZone);
  const zoneShort = expiryMailTimeZoneShort(timeZone);
  const rows = mailRows(alerts);
  const expired = alerts.filter((a) => a.tier === "expired").length;
  const critical = alerts.filter((a) => a.tier === "critical").length;
  const warning = alerts.filter((a) => a.tier === "warning").length;
  const summaryParts = [
    `${alerts.length} ${pluralRu(alerts.length, "позиция", "позиции", "позиций")}`,
  ];
  if (expired) {
    summaryParts.push(
      `${expired} ${pluralRu(expired, "просрочена", "просрочены", "просрочены")}`
    );
  }
  if (critical) {
    summaryParts.push(
      `${critical} ${pluralRu(critical, "на исходе срока", "на исходе срока", "на исходе срока")}`
    );
  }
  if (warning) {
    summaryParts.push(
      `${warning} ${pluralRu(warning, "предупреждение", "предупреждения", "предупреждений")}`
    );
  }
  const summary = summaryParts.join(" · ");
  const attentionUrl = `${publicWmsUrl()}/attention`;
  const generated = formatDateTimeInTimeZone(new Date(), timeZone);

  const textLines = [
    EXPIRY_PRODUCT_MAIL_TITLE,
    "",
    `На складе есть партии, которые нужно списать. ${summary}.`,
    "Письмо приходит каждый день, пока этот остаток не спишут.",
    "",
    ...rows.flatMap((row, i) => [
      `${i + 1}. [${row.badge}] ${row.title}`,
      `   ${row.description}`,
      "",
    ]),
    `Открыть в WMS: ${attentionUrl}`,
    `Сформировано ${generated} (${zoneShort}). Отправитель: support@scada25.ru`,
  ];

  const cards = rows
    .map((row) => {
      const expiredCard = row.tier === "expired" || row.tier === "critical";
      const border = expiredCard ? "#f0c4c0" : "#ead8a8";
      const bg = expiredCard ? "#fdf4f2" : "#fbf6ea";
      const titleColor = expiredCard ? "#b91c1c" : "#92400e";
      const badgeBg = expiredCard ? "#dc2626" : "#d97706";
      return `
        <tr>
          <td style="padding:0 0 12px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${bg};border:1px solid ${border};border-radius:12px;">
              <tr>
                <td style="padding:16px 18px;">
                  <span style="display:inline-block;background:${badgeBg};color:#fff;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;letter-spacing:0.02em;">${escapeHtml(row.badge)}</span>
                  <div style="margin:10px 0 6px;font-size:18px;line-height:1.3;font-weight:700;color:${titleColor};">${escapeHtml(row.title)}</div>
                  <div style="font-size:14px;line-height:1.5;color:#3f3f46;">${escapeHtml(row.description)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(EXPIRY_PRODUCT_MAIL_TITLE)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f1ec;color:#18181b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;">
          <tr>
            <td style="padding:8px 8px 18px;font-family:Arial,Helvetica,sans-serif;">
              <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#a16207;font-weight:700;">WMS · склад</div>
              <h1 style="margin:8px 0 8px;font-size:24px;line-height:1.25;color:#18181b;">${escapeHtml(EXPIRY_PRODUCT_MAIL_TITLE)}</h1>
              <p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#3f3f46;">
                На складе есть партии, которые нужно списать. Пока остаток не уберут, это письмо будет приходить каждый день.
              </p>
              <p style="margin:0 0 18px;font-size:14px;color:#71717a;">${escapeHtml(summary)}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${cards}</table>
              <p style="margin:8px 0 0;">
                <a href="${escapeHtml(attentionUrl)}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:600;">Открыть в WMS</a>
              </p>
              <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa;">
                Сформировано ${escapeHtml(generated)} (${escapeHtml(zoneShort)}). Отправитель support@scada25.ru — почта GSMT.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: `${EXPIRY_PRODUCT_MAIL_TITLE} — ${alerts.length} ${pluralRu(alerts.length, "позиция", "позиции", "позиций")}`,
    text: textLines.join("\n"),
    html,
    recipients,
    alerts,
  };
}

async function ensureAppSettingsTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_app_settings (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, setting_key)
    )`);
}

function persistPayload(settings: ExpiryProductMailSettings) {
  return {
    enabled: settings.enabled,
    recipients: settings.recipients,
    includeWarning: settings.includeWarning,
    includeCritical: settings.includeCritical,
    includeExpired: settings.includeExpired,
    timeZone: settings.timeZone,
    sendHour: settings.sendHour,
    lastSentAt: settings.lastSentAt,
    lastSentCount: settings.lastSentCount,
    lastError: settings.lastError,
    lastSkipReason: settings.lastSkipReason,
  };
}

export async function getExpiryProductMailSettings(
  client: PoolClient,
  siteId: number
): Promise<ExpiryProductMailSettings> {
  await ensureAppSettingsTable(client);
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `SELECT setting_value, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS updated_at
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, EXPIRY_PRODUCT_MAIL_SETTING_KEY]
  );
  if (r.rows.length === 0) return { ...DEFAULT_EXPIRY_PRODUCT_MAIL_SETTINGS };
  const parsed = parseExpiryProductMailSettings(r.rows[0]?.setting_value);
  return { ...parsed, updatedAt: r.rows[0]?.updated_at ?? null };
}

export async function saveExpiryProductMailSettings(
  client: PoolClient,
  siteId: number,
  input: unknown
): Promise<ExpiryProductMailSettings> {
  const current = await getExpiryProductMailSettings(client, siteId);
  const next = mergeExpiryProductMailSettings(current, input);
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()
     RETURNING setting_value, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS updated_at`,
    [siteId, EXPIRY_PRODUCT_MAIL_SETTING_KEY, JSON.stringify(persistPayload(next))]
  );
  const parsed = parseExpiryProductMailSettings(r.rows[0]?.setting_value);
  return { ...parsed, updatedAt: r.rows[0]?.updated_at ?? null };
}

async function writeMailStatus(
  client: PoolClient,
  siteId: number,
  current: ExpiryProductMailSettings,
  patch: Partial<ExpiryProductMailSettings>
): Promise<ExpiryProductMailSettings> {
  return saveExpiryProductMailSettings(client, siteId, {
    ...persistPayload(current),
    ...patch,
  });
}

function runHelper(helper: string, payloadPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [helper, payloadPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function deliverExpiryMail(compose: ExpiryMailCompose): Promise<void> {
  const helper = process.env.WMS_SEND_MAIL_BIN || DEFAULT_MAIL_HELPER;
  try {
    await access(helper, fsConstants.R_OK);
  } catch {
    throw new Error(`Почтовый помощник не установлен: ${helper}`);
  }
  const payloadPath = join(tmpdir(), `wms-expiry-mail-${process.pid}-${Date.now()}.json`);
  await writeFile(
    payloadPath,
    JSON.stringify({
      subject: compose.subject,
      text: compose.text,
      html: compose.html,
      recipients: compose.recipients,
      fromName: "WMS склад",
    }),
    { encoding: "utf8", mode: 0o600 }
  );
  try {
    const result = await runHelper(helper, payloadPath);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || `mail helper exit ${result.code}`).trim();
      throw new Error(detail.slice(0, 500));
    }
  } finally {
    await unlink(payloadPath).catch(() => undefined);
  }
}

export async function previewExpiryProductMail(
  client: PoolClient,
  siteId: number
): Promise<{ settings: ExpiryProductMailSettings; alerts: ExpiryStickerAlertRow[] }> {
  const settings = await getExpiryProductMailSettings(client, siteId);
  const alerts = filterAlertsForMail(await listExpiryStickerAlerts(client, siteId), settings);
  return { settings, alerts };
}

export async function sendExpiryProductMailDigest(
  client: PoolClient,
  siteId: number,
  options: { cron?: boolean; force?: boolean; dryRun?: boolean } = {}
): Promise<{
  ok: boolean;
  skipped: boolean;
  reason?: string;
  sentCount: number;
  alertCount: number;
  recipients: string[];
  subject?: string;
  settings: ExpiryProductMailSettings;
}> {
  const settings = await getExpiryProductMailSettings(client, siteId);
  const cron = options.cron === true;
  const force = options.force === true;
  const dryRun = options.dryRun === true;

  if (cron && !settings.enabled) {
    const next = await writeMailStatus(client, siteId, settings, {
      lastSkipReason: "disabled",
      lastError: null,
    });
    return { ok: true, skipped: true, reason: "disabled", sentCount: 0, alertCount: 0, recipients: [], settings: next };
  }
  if (settings.recipients.length === 0) {
    const next = await writeMailStatus(client, siteId, settings, {
      lastSkipReason: "no_recipients",
      lastError: null,
    });
    return {
      ok: true,
      skipped: true,
      reason: "no_recipients",
      sentCount: 0,
      alertCount: 0,
      recipients: [],
      settings: next,
    };
  }
  if (cron && !force && alreadySentToday(settings.lastSentAt, new Date(), settings.timeZone)) {
    return {
      ok: true,
      skipped: true,
      reason: "already_sent_today",
      sentCount: 0,
      alertCount: 0,
      recipients: settings.recipients,
      settings,
    };
  }
  if (cron && !force && isBeforeSendHour(settings.timeZone, settings.sendHour)) {
    return {
      ok: true,
      skipped: true,
      reason: "too_early",
      sentCount: 0,
      alertCount: 0,
      recipients: settings.recipients,
      settings,
    };
  }

  const alerts = filterAlertsForMail(await listExpiryStickerAlerts(client, siteId), settings);
  if (alerts.length === 0) {
    const next = await writeMailStatus(client, siteId, settings, {
      lastSkipReason: "no_alerts",
      lastError: null,
    });
    return {
      ok: true,
      skipped: true,
      reason: "no_alerts",
      sentCount: 0,
      alertCount: 0,
      recipients: settings.recipients,
      settings: next,
    };
  }

  const compose = composeExpiryProductMail(alerts, settings.recipients, {
    timeZone: settings.timeZone,
  });
  if (dryRun) {
    return {
      ok: true,
      skipped: false,
      reason: "dry_run",
      sentCount: 0,
      alertCount: alerts.length,
      recipients: settings.recipients,
      subject: compose.subject,
      settings,
    };
  }

  try {
    await deliverExpiryMail(compose);
    const next = await writeMailStatus(client, siteId, settings, {
      lastSentAt: new Date().toISOString(),
      lastSentCount: alerts.length,
      lastError: null,
      lastSkipReason: null,
    });
    return {
      ok: true,
      skipped: false,
      sentCount: settings.recipients.length,
      alertCount: alerts.length,
      recipients: settings.recipients,
      subject: compose.subject,
      settings: next,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить письмо";
    const next = await writeMailStatus(client, siteId, settings, {
      lastError: message,
      lastSkipReason: "send_failed",
    });
    return {
      ok: false,
      skipped: false,
      reason: "send_failed",
      sentCount: 0,
      alertCount: alerts.length,
      recipients: settings.recipients,
      subject: compose.subject,
      settings: next,
    };
  }
}
