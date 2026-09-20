import type { PoolClient } from "pg";
import {
  computeStickerExpiryTier,
  daysSinceEmission,
  DEFAULT_STICKER_SHELF_LIFE_DAYS,
  formatStickerAlertBody,
  formatStickerAlertTitle,
  stickerExpiryRefKey,
  type StickerExpiryTier,
} from "@/lib/wms/expiry-sticker";

type ActiveLotRow = {
  itemCode: string;
  itemName: string;
  lotCode: string;
  manufacturedAt: string;
  shelfLifeDays: number;
  qty: number;
  locationCode: string | null;
};

export type ExpiryStickerAlertRow = {
  itemCode: string;
  itemName: string;
  lotCode: string;
  tier: "warning" | "critical" | "expired";
  daysSinceEmission: number;
  shelfLifeDays: number;
  qty: number;
  emissionLabel: string;
  locationCode?: string | null;
};

function toAlertTier(tier: StickerExpiryTier): "warning" | "critical" | "expired" | null {
  if (tier === "warning" || tier === "critical" || tier === "expired") return tier;
  return null;
}

function notificationSeverity(
  tier: "warning" | "critical" | "expired"
): "expiry_warning" | "expiry_critical" {
  return tier === "warning" ? "expiry_warning" : "expiry_critical";
}

export async function listExpiryStickerAlerts(
  client: PoolClient,
  siteId: number
): Promise<ExpiryStickerAlertRow[]> {
  const lots = await listActivePerishableLots(client, siteId);
  const out: ExpiryStickerAlertRow[] = [];
  for (const lot of lots) {
    const daysSince = daysSinceEmission(lot.manufacturedAt);
    if (daysSince == null) continue;
    const tier = toAlertTier(computeStickerExpiryTier(daysSince));
    if (!tier) continue;
    out.push({
      itemCode: lot.itemCode,
      itemName: lot.itemName,
      lotCode: lot.lotCode,
      tier,
      daysSinceEmission: daysSince,
      shelfLifeDays: lot.shelfLifeDays,
      qty: lot.qty,
      emissionLabel: new Date(lot.manufacturedAt).toLocaleDateString("ru-RU"),
      locationCode: lot.locationCode,
    });
  }
  out.sort((a, b) => {
    const rank = (t: ExpiryStickerAlertRow["tier"]) =>
      t === "expired" ? 3 : t === "critical" ? 2 : 1;
    const d = rank(b.tier) - rank(a.tier);
    if (d !== 0) return d;
    return b.daysSinceEmission - a.daysSinceEmission;
  });
  return out;
}

async function listActivePerishableLots(client: PoolClient, siteId: number): Promise<ActiveLotRow[]> {
  const r = await client.query<{
    itemCode: string;
    itemName: string;
    lotCode: string;
    manufacturedAt: string;
    shelfLifeDays: number;
    qty: string;
    locationCode: string | null;
  }>(
    `
    SELECT
      i.item_code AS "itemCode",
      i.name AS "itemName",
      COALESCE(NULLIF(TRIM(wl.lot_code), ''), NULLIF(TRIM(sl.lot_code), ''), 'NO-LOT') AS "lotCode",
      COALESCE(wl.manufactured_at, sl.received_at)::text AS "manufacturedAt",
      COALESCE(i.shelf_life_days, $2)::int AS "shelfLifeDays",
      SUM(COALESCE(sl.available_qty, 0) + COALESCE(sl.in_production_qty, 0))::text AS qty,
      l.location_code AS "locationCode"
    FROM wms_stock_balances sb
    JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
    JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
    JOIN wms_stock_lots sl ON sl.balance_id = sb.balance_id
      AND (COALESCE(sl.available_qty, 0) + COALESCE(sl.in_production_qty, 0)) > 0
    LEFT JOIN wms_lots wl ON (
      (sl.lot_id IS NOT NULL AND wl.lot_id = sl.lot_id)
      OR (sl.lot_id IS NULL AND wl.site_id = sb.site_id AND wl.item_id = sb.item_id AND wl.lot_code = sl.lot_code)
    )
    WHERE sb.site_id = $1
      AND (
        i.is_perishable = TRUE
        OR COALESCE(i.shelf_life_days, 0) > 0
      )
      AND COALESCE(wl.manufactured_at, sl.received_at) IS NOT NULL
    GROUP BY
      i.item_code,
      i.name,
      COALESCE(NULLIF(TRIM(wl.lot_code), ''), NULLIF(TRIM(sl.lot_code), ''), 'NO-LOT'),
      wl.manufactured_at,
      sl.received_at,
      i.shelf_life_days,
      l.location_code
    HAVING SUM(COALESCE(sl.available_qty, 0) + COALESCE(sl.in_production_qty, 0)) > 0
    `,
    [siteId, DEFAULT_STICKER_SHELF_LIFE_DAYS]
  );

  return r.rows.map((row) => ({
    itemCode: row.itemCode,
    itemName: row.itemName,
    lotCode: row.lotCode,
    manufacturedAt: row.manufacturedAt,
    shelfLifeDays: Number(row.shelfLifeDays) || DEFAULT_STICKER_SHELF_LIFE_DAYS,
    qty: Number(row.qty) || 0,
    locationCode: row.locationCode || null,
  }));
}

async function listActiveUserIds(client: PoolClient, siteId: number): Promise<string[]> {
  const r = await client.query<{ userId: string }>(
    `SELECT user_id::text AS "userId" FROM wms_users WHERE site_id = $1 AND is_active ORDER BY user_id`,
    [siteId]
  );
  return r.rows.map((row) => row.userId);
}

async function markResolvedExpiryAlerts(
  client: PoolClient,
  siteId: number,
  activeRefKeys: Set<string>
) {
  const existing = await client.query<{ notificationId: string; refKey: string }>(
    `SELECT notification_id::text AS "notificationId", ref_key AS "refKey"
     FROM wms_notifications
     WHERE site_id = $1 AND ref_key LIKE 'expiry_sticker:%'`,
    [siteId]
  );

  for (const row of existing.rows) {
    if (activeRefKeys.has(row.refKey)) continue;
    await client.query(
      `UPDATE wms_notification_recipients nr
       SET read_at = COALESCE(nr.read_at, now())
       FROM wms_notifications n
       WHERE n.notification_id = nr.notification_id
         AND n.notification_id = $1::bigint
         AND nr.read_at IS NULL`,
      [row.notificationId]
    );
  }
}

async function ensureExpiryNotification(
  client: PoolClient,
  siteId: number,
  userIds: string[],
  input: {
    refKey: string;
    severity: "expiry_warning" | "expiry_critical";
    title: string;
    body: string;
  }
) {
  const existing = await client.query<{ notificationId: string }>(
    `SELECT notification_id::text AS "notificationId"
     FROM wms_notifications
     WHERE site_id = $1 AND ref_key = $2
     LIMIT 1`,
    [siteId, input.refKey]
  );

  let notificationId = existing.rows[0]?.notificationId;
  if (!notificationId) {
    const created = await client.query<{ notificationId: string }>(
      `
      INSERT INTO wms_notifications (site_id, title, body, severity, ref_key)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING notification_id::text AS "notificationId"
      `,
      [siteId, input.title, input.body, input.severity, input.refKey]
    );
    notificationId = created.rows[0]?.notificationId;
  } else {
    await client.query(
      `UPDATE wms_notifications
       SET title = $2, body = $3, severity = $4
       WHERE notification_id = $1::bigint`,
      [notificationId, input.title, input.body, input.severity]
    );
  }

  if (!notificationId) return;
  for (const userId of userIds) {
    await client.query(
      `INSERT INTO wms_notification_recipients (notification_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [notificationId, userId]
    );
  }
}

export async function syncExpiryStickerAlerts(client: PoolClient, siteId: number) {
  const lots = await listActivePerishableLots(client, siteId);
  const userIds = await listActiveUserIds(client, siteId);
  const activeRefKeys = new Set<string>();
  let createdOrUpdated = 0;

  for (const lot of lots) {
    const daysSince = daysSinceEmission(lot.manufacturedAt);
    if (daysSince == null) continue;
    const tier = toAlertTier(computeStickerExpiryTier(daysSince));
    if (!tier) continue;

    const refKey = stickerExpiryRefKey(lot.itemCode, lot.lotCode, tier, lot.locationCode);
    activeRefKeys.add(refKey);
    const emissionLabel = new Date(lot.manufacturedAt).toLocaleDateString("ru-RU");
    await ensureExpiryNotification(client, siteId, userIds, {
      refKey,
      severity: notificationSeverity(tier),
      title: formatStickerAlertTitle({
        itemName: lot.itemName,
        itemCode: lot.itemCode,
        locationCode: lot.locationCode,
        expired: tier === "expired",
      }),
      body: formatStickerAlertBody({
        itemCode: lot.itemCode,
        lotCode: lot.lotCode,
        emissionLabel,
        daysSinceEmission: daysSince,
        shelfLifeDays: lot.shelfLifeDays,
        qty: lot.qty,
        tier,
        locationCode: lot.locationCode,
      }),
    });
    createdOrUpdated += 1;
  }

  await markResolvedExpiryAlerts(client, siteId, activeRefKeys);
  return { synced: createdOrUpdated, activeAlerts: activeRefKeys.size };
}
