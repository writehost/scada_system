-- ТСД/приёмка: подтянуть недостающие группы по уже записанным item_group_code (в т.ч. русские подписи).
SET client_encoding TO 'UTF8';

INSERT INTO wms_item_groups (site_id, group_code, name, is_active, updated_at)
SELECT DISTINCT i.site_id, i.item_group_code, i.item_group_code, TRUE, now()
FROM wms_items i
WHERE i.item_group_code IS NOT NULL
  AND btrim(i.item_group_code) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM wms_item_groups g
    WHERE g.site_id = i.site_id AND g.group_code = i.item_group_code
  )
ON CONFLICT (site_id, group_code) DO UPDATE SET
  is_active = TRUE,
  updated_at = now();
