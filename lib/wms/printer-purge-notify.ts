import type { PoolClient } from "pg";

export type PrinterPurgeJob = {
  jobId: string;
  gtin: string;
  count: number;
  name?: string;
};

export type PrinterPurgeInput = {
  deviceId?: string;
  deleted: number;
  retentionDays?: unknown;
  jobs?: unknown;
  appVersion?: string;
  purgedAt?: unknown;
};

function pluralCodes(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "кодов";
  if (last === 1) return "код";
  if (last >= 2 && last <= 4) return "кода";
  return "кодов";
}

function parseJobs(raw: unknown): PrinterPurgeJob[] {
  if (!Array.isArray(raw)) return [];
  const out: PrinterPurgeJob[] = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const count = Number(row.count);
    out.push({
      jobId: String(row.jobId ?? row.job_id ?? "").trim(),
      gtin: String(row.gtin ?? "").trim(),
      count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0,
    });
  }
  return out;
}

function refKeyOf(input: PrinterPurgeInput): string {
  const device = String(input.deviceId || "printer").slice(0, 80);
  const stamp =
    typeof input.purgedAt === "number" && Number.isFinite(input.purgedAt)
      ? String(Math.round(input.purgedAt))
      : typeof input.purgedAt === "string" && input.purgedAt.trim()
        ? input.purgedAt.trim().slice(0, 40)
        : String(Date.now());
  return `printer_purge:${device}:${stamp}`;
}

async function enrichJobNames(
  client: PoolClient,
  siteId: number,
  jobs: PrinterPurgeJob[]
): Promise<PrinterPurgeJob[]> {
  if (jobs.length === 0) return jobs;
  const ids = jobs.map((job) => job.jobId).filter(Boolean);
  const gtins = jobs.map((job) => job.gtin).filter(Boolean);
  try {
    const r = await client.query<{
      orderId: string;
      gtin: string | null;
      name: string | null;
    }>(
      `SELECT order_id AS "orderId", gtin, nomenclature_name AS name
       FROM wms_label_order_docs
       WHERE site_id = $1
         AND (
           (cardinality($2::text[]) > 0 AND order_id = ANY($2::text[]))
           OR (cardinality($3::text[]) > 0 AND gtin = ANY($3::text[]))
         )`,
      [siteId, ids, gtins]
    );
    const byId = new Map<string, string>();
    const byGtin = new Map<string, string>();
    for (const row of r.rows) {
      const name = String(row.name || "").trim();
      if (!name) continue;
      if (row.orderId) byId.set(row.orderId, name);
      if (row.gtin) byGtin.set(row.gtin, name);
    }
    return jobs.map((job) => ({
      ...job,
      name: byId.get(job.jobId) || byGtin.get(job.gtin) || "",
    }));
  } catch {
    return jobs;
  }
}

function composeBody(input: PrinterPurgeInput, jobs: PrinterPurgeJob[]): { title: string; body: string } {
  const deleted = Math.max(0, Math.round(Number(input.deleted) || 0));
  const device = String(input.deviceId || "терминал печати").trim() || "терминал печати";
  const days = input.retentionDays == null || input.retentionDays === "" ? null : String(input.retentionDays);
  const lines = [
    `Терминал ${device} удалил ${deleted} ${pluralCodes(deleted)} с планшета печати.`,
  ];
  if (days != null) lines.push(`Срок хранения на терминале: ${days} дн.`);
  for (const job of jobs.slice(0, 12)) {
    const name = job.name || (job.gtin ? `GTIN ${job.gtin}` : "Заказ");
    const parts = [name];
    if (job.jobId) parts.push(`задание ${job.jobId}`);
    if (job.count) parts.push(`${job.count} шт.`);
    lines.push(parts.join(" · "));
  }
  return {
    title: "Коды удалены с терминала печати",
    body: lines.join("\n"),
  };
}

async function listActiveUserIds(client: PoolClient, siteId: number): Promise<string[]> {
  const r = await client.query<{ userId: string }>(
    `SELECT user_id::text AS "userId" FROM wms_users WHERE site_id = $1 AND is_active ORDER BY user_id`,
    [siteId]
  );
  return r.rows.map((row) => row.userId);
}

export async function notifyPrinterCodesPurged(
  client: PoolClient,
  siteId: number,
  input: PrinterPurgeInput
): Promise<{ notificationId: string; recipientCount: number; created: boolean; refKey: string }> {
  const deleted = Math.max(0, Math.round(Number(input.deleted) || 0));
  if (deleted <= 0) {
    return { notificationId: "", recipientCount: 0, created: false, refKey: "" };
  }

  const refKey = refKeyOf(input);
  const existing = await client.query<{ notificationId: string }>(
    `SELECT notification_id::text AS "notificationId"
     FROM wms_notifications
     WHERE site_id = $1 AND ref_key = $2
     LIMIT 1`,
    [siteId, refKey]
  );
  if (existing.rows[0]?.notificationId) {
    return {
      notificationId: existing.rows[0].notificationId,
      recipientCount: 0,
      created: false,
      refKey,
    };
  }

  const jobs = await enrichJobNames(client, siteId, parseJobs(input.jobs));
  const { title, body } = composeBody(input, jobs);
  const userIds = await listActiveUserIds(client, siteId);
  if (userIds.length === 0) {
    return { notificationId: "", recipientCount: 0, created: false, refKey };
  }

  const created = await client.query<{ notificationId: string }>(
    `INSERT INTO wms_notifications (site_id, title, body, severity, ref_key)
     VALUES ($1, $2, $3, 'warning', $4)
     RETURNING notification_id::text AS "notificationId"`,
    [siteId, title, body, refKey]
  );
  const notificationId = created.rows[0]?.notificationId || "";
  for (const userId of userIds) {
    await client.query(
      `INSERT INTO wms_notification_recipients (notification_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [notificationId, userId]
    );
  }
  return { notificationId, recipientCount: userIds.length, created: true, refKey };
}
