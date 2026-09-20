-- Оборудование линии (аппликатор Novexx и др.) — в справочнике полей ячейки, не в свободном тексте.
SET client_encoding TO 'UTF8';

ALTER TABLE wms_slot_profile_option_defs
  DROP CONSTRAINT IF EXISTS wms_slot_profile_option_defs_field_key_check;

ALTER TABLE wms_slot_profile_option_defs
  ADD CONSTRAINT wms_slot_profile_option_defs_field_key_check
  CHECK (field_key IN (
    'materialType', 'processType', 'stickerShape', 'productGroup',
    'volume', 'applicationPlace', 'equipment'
  ));

INSERT INTO wms_slot_profile_option_defs (site_id, field_key, option_code, name, sort_order)
SELECT s.site_id, v.field_key, v.option_code, v.name, v.sort_order
FROM wms_sites s
CROSS JOIN (
  VALUES
    ('equipment', 'ANY', 'Любое', 999),
    ('equipment', 'APPLICATOR', 'Аппликатор (общий)', 10),
    ('equipment', 'NOVEXX', 'Novexx', 20),
    ('equipment', 'APPLICATOR-NOVEXX', 'Аппликатор Novexx', 30),
    ('equipment', 'АППЛИКАТОР', 'Аппликатор', 40),
    ('equipment', 'АППЛИКАТОР-NOVEXX', 'Аппликатор Novexx', 50)
) AS v(field_key, option_code, name, sort_order)
ON CONFLICT (site_id, field_key, option_code) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = now();
