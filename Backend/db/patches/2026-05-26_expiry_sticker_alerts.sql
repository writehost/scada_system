-- Срок годности партий: backfill expiry_at из даты эмиссии + shelf_life_days.
-- ref_key для идемпотентных уведомлений о сроке стикера.

UPDATE wms_lots wl
SET expiry_at = wl.manufactured_at + (COALESCE(i.shelf_life_days, 365)::text || ' days')::interval,
    updated_at = now()
FROM wms_items i
WHERE wl.item_id = i.item_id
  AND wl.site_id = i.site_id
  AND wl.expiry_at IS NULL
  AND wl.manufactured_at IS NOT NULL
  AND COALESCE(i.shelf_life_days, 365) > 0;

UPDATE wms_stock_lots sl
SET expiry_at = src.expiry_at,
    updated_at = now()
FROM (
  SELECT sl2.stock_lot_id, wl.expiry_at
  FROM wms_stock_lots sl2
  JOIN wms_stock_balances sb ON sb.balance_id = sl2.balance_id
  JOIN wms_lots wl ON wl.site_id = sb.site_id
    AND wl.item_id = sb.item_id
    AND wl.lot_code = sl2.lot_code
  WHERE sl2.expiry_at IS NULL
    AND wl.expiry_at IS NOT NULL
) src
WHERE sl.stock_lot_id = src.stock_lot_id;

ALTER TABLE wms_notifications
  ADD COLUMN IF NOT EXISTS ref_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_wms_notifications_site_ref_key
  ON wms_notifications(site_id, ref_key)
  WHERE ref_key IS NOT NULL;
