-- Справочник единиц измерения (подписи для UI; wms_items.uom_code остаётся текстом).
SET client_encoding TO 'UTF8';

CREATE TABLE IF NOT EXISTS wms_uom_defs (
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  uom_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, uom_code)
);

CREATE INDEX IF NOT EXISTS ix_wms_uom_defs_site_sort
  ON wms_uom_defs(site_id, sort_order, uom_code);

INSERT INTO wms_uom_defs (site_id, uom_code, name, description, sort_order)
SELECT s.site_id, v.code, v.name, v.description, v.ord
FROM wms_sites s
CROSS JOIN (
  VALUES
    ('pcs', 'Штука', 'Базовая единица (шт).', 10),
    ('bottle', 'Бутылка', 'Поштучная тара.', 20),
    ('block', 'Блок', 'Групповая упаковка.', 30),
    ('box', 'Короб', 'Транспортная упаковка.', 40),
    ('pallet', 'Палета', 'Палетная единица.', 50),
    ('roll', 'Рулон', 'Рулонный учёт (этикетки).', 60),
    ('kg', 'Килограмм', 'Весовой учёт.', 70),
    ('l', 'Литр', 'Объёмный учёт.', 80),
    ('m', 'Метр', 'Погонный метр.', 90),
    ('pack', 'Упаковка', 'Упаковка без детализации.', 100)
) AS v(code, name, description, ord)
ON CONFLICT (site_id, uom_code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = now();
