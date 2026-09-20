-- Базовые справочники для приёмки с ТСД / ЧЗ и заполнения карточек WMS.
-- Без этих значений возможны FK-ошибки вида:
-- "Ссылка на связанный справочник неверна (группа, единица измерения и т.п.)".
SET client_encoding TO 'UTF8';

INSERT INTO wms_item_groups (site_id, group_code, name, is_active, updated_at)
SELECT s.site_id, v.code, v.name, TRUE, now()
FROM wms_sites s
CROSS JOIN (
  VALUES
    ('water', 'Вода'),
    ('milk', 'Молочная продукция'),
    ('softdrinks', 'Безалкогольные напитки'),
    ('juice', 'Соки'),
    ('nabeer', 'Безалкогольное пиво'),
    ('beer', 'Пиво'),
    ('alcohol', 'Алкоголь'),
    ('tobacco', 'Табак'),
    ('otp', 'Альтернативная табачная продукция'),
    ('ncp', 'Никотиносодержащая продукция'),
    ('shoes', 'Обувь'),
    ('clothes', 'Одежда'),
    ('textiles', 'Текстиль'),
    ('tires', 'Шины'),
    ('perfumery', 'Парфюмерия'),
    ('electronics', 'Электроника'),
    ('photo', 'Фото'),
    ('bicycle', 'Велосипеды'),
    ('wheelchairs', 'Кресла-коляски'),
    ('vetpharma', 'Ветпрепараты'),
    ('bio', 'Биологически активные добавки'),
    ('antiseptic', 'Антисептики'),
    ('petfood', 'Корма для животных'),
    ('seafood', 'Морепродукты'),
    ('conserve', 'Консервы'),
    ('vegetableoil', 'Растительные масла'),
    ('grocery', 'Бакалея'),
    ('sweets', 'Сладости'),
    ('autofluids', 'Автомобильные жидкости'),
    ('chemistry', 'Бытовая химия'),
    ('toys', 'Игрушки'),
    ('books', 'Книги'),
    ('construction', 'Строительные материалы'),
    ('fire', 'Пиротехника'),
    ('heater', 'Отопительные приборы'),
    ('cableraw', 'Кабельная продукция'),
    ('radio', 'Радиоэлектроника'),
    ('opticfiber', 'Оптоволокно'),
    ('medicals', 'Медизделия'),
    ('furs', 'Меховые изделия'),
    ('lp', 'Легкая промышленность'),
    ('beer_alcohol', 'Пиво и алкоголь')
) AS v(code, name)
ON CONFLICT (site_id, group_code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = TRUE,
  updated_at = now();

-- Старые ТСД/импорты иногда присылали русское имя как код группы.
INSERT INTO wms_item_groups (site_id, group_code, name, is_active, updated_at)
SELECT s.site_id, v.name, v.name, TRUE, now()
FROM wms_sites s
CROSS JOIN (
  VALUES
    ('Вода'),
    ('Молочная продукция'),
    ('Безалкогольные напитки'),
    ('Соки'),
    ('Безалкогольное пиво'),
    ('Пиво'),
    ('Алкоголь'),
    ('Табак')
) AS v(name)
ON CONFLICT (site_id, group_code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = TRUE,
  updated_at = now();

INSERT INTO wms_packaging_profile_defs (site_id, profile_code, name, description, sort_order)
SELECT s.site_id, v.code, v.name, v.description, v.ord
FROM wms_sites s
CROSS JOIN (
  VALUES
    ('custom', 'Универсальный', 'Без специализированной логики упаковки (по умолчанию).', 10),
    ('stickers', 'Этикетки и стикеры', 'Рулоны этикеток, маркировка; учёт шт/рулон, принтеры этикеток.', 20),
    ('water', 'Питьевая вода', 'Бутилированная вода: палеты, короба, срок годности.', 30)
) AS v(code, name, description, ord)
ON CONFLICT (site_id, profile_code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = now();

INSERT INTO wms_nomenclature_type_defs (site_id, type_code, name, description, sort_order)
SELECT s.site_id, v.code, v.name, v.description, v.ord
FROM wms_sites s
CROSS JOIN (
  VALUES
    ('PRODUCT', 'Товар / продукция', 'Готовая продукция и товары для продажи.', 10),
    ('STICKER', 'Стикер маркировки', 'Стикеры для маркировки и ЧЗ.', 20),
    ('LABEL', 'Этикетка', 'Этикетки без рулона как отдельная категория.', 30),
    ('PACKAGING', 'Упаковка', 'Тара, короба, плёнка.', 40),
    ('SPARE_PART', 'Запчасть', 'Комплектующие и запасные части.', 50),
    ('CONSUMABLE', 'Расходник', 'Расходные материалы производства.', 60),
    ('RAW_MATERIAL', 'Сырьё', 'Входное сырьё.', 70),
    ('SEMI_FINISHED', 'Полуфабрикат', 'Промежуточная продукция.', 80),
    ('SERVICE', 'Услуга', 'Услуги (не физический остаток).', 90),
    ('OTHER', 'Прочее', 'Иное.', 100)
) AS v(code, name, description, ord)
ON CONFLICT (site_id, type_code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = now();

INSERT INTO wms_slot_profile_option_defs (site_id, field_key, option_code, name, sort_order)
SELECT s.site_id, v.field_key, v.option_code, v.name, v.sort_order
FROM wms_sites s
CROSS JOIN (
  VALUES
    ('materialType', 'ST', 'Стикеры', 10),
    ('materialType', 'LB', 'Этикетки', 20),
    ('materialType', 'PK', 'Упаковка', 30),
    ('materialType', 'CP', 'Пробки', 40),
    ('materialType', 'PL', 'Палетные', 50),
    ('materialType', 'ANY', 'Любой', 999),
    ('processType', 'SER', 'Сериализация', 10),
    ('processType', 'BAGG', 'Блочная агрегация', 20),
    ('processType', 'PAGG', 'Палетная агрегация', 30),
    ('processType', 'CAGG', 'Коробочная агрегация', 40),
    ('processType', 'PACK-WATER', 'Упакованная вода', 50),
    ('processType', 'DRINK', 'Напитки', 60),
    ('processType', 'STORE', 'Складской материал', 70),
    ('processType', 'RECV', 'Приёмка', 80),
    ('processType', 'QUARANTINE', 'Карантин', 90),
    ('processType', 'DEFECT', 'Брак', 100),
    ('processType', 'WRITEOFF', 'Списание', 110),
    ('processType', 'ANY', 'Любой', 999),
    ('stickerShape', 'RND', 'Круглые', 10),
    ('stickerShape', 'SQR', 'Квадратные', 20),
    ('stickerShape', 'RECT', 'Прямоугольные', 30),
    ('stickerShape', 'ANY', 'Любой', 999),
    ('productGroup', 'SLNG', 'Славда негаз', 10),
    ('productGroup', 'SLGZ', 'Славда газ', 20),
    ('productGroup', 'DSLV', 'Детская Славда', 30),
    ('productGroup', 'SLKR', 'Славда курортная', 40),
    ('productGroup', 'DRNK', 'Напитки', 50),
    ('productGroup', 'PWTR', 'Упак. вода', 60),
    ('productGroup', 'ANY', 'Любой', 999),
    ('volume', '05', '0,5 л', 10),
    ('volume', '10', '1 л', 20),
    ('volume', '15', '1,5 л', 30),
    ('volume', '50', '5 л', 40),
    ('volume', '190', '19 л', 50),
    ('volume', 'ANY', 'Любой', 999),
    ('applicationPlace', 'CAP', 'Пробка', 10),
    ('applicationPlace', 'BTL', 'Бутылка', 20),
    ('applicationPlace', 'BLOCK', 'Блок', 30),
    ('applicationPlace', 'BOX', 'Короб', 40),
    ('applicationPlace', 'PALLET', 'Палета', 50),
    ('applicationPlace', 'ANY', 'Любой', 999)
) AS v(field_key, option_code, name, sort_order)
ON CONFLICT (site_id, field_key, option_code) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = now();

-- Минимальные склад/зона/ячейка приёмки, чтобы проведение приёмки не падало на missing RECV.
INSERT INTO wms_warehouses (site_id, warehouse_code, name)
SELECT s.site_id, 'OS', 'Склад материалов'
FROM wms_sites s
ON CONFLICT (site_id, warehouse_code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = TRUE;

INSERT INTO wms_zones (warehouse_id, zone_code, name, purpose)
SELECT w.warehouse_id, 'RECV', 'Приёмка', 'receiving'
FROM wms_warehouses w
ON CONFLICT (warehouse_id, zone_code) DO UPDATE SET
  name = EXCLUDED.name,
  purpose = EXCLUDED.purpose,
  is_active = TRUE;

INSERT INTO wms_zones (warehouse_id, zone_code, name, purpose)
SELECT w.warehouse_id, 'ST-BAGG', 'Стикеры / Блочная агрегация', 'storage'
FROM wms_warehouses w
ON CONFLICT (warehouse_id, zone_code) DO UPDATE SET
  name = EXCLUDED.name,
  purpose = EXCLUDED.purpose,
  is_active = TRUE;

INSERT INTO wms_locations (
  site_id, warehouse_id, zone_id, location_code, display_name, location_attrs_json, updated_at
)
SELECT
  w.site_id,
  w.warehouse_id,
  z.zone_id,
  'OS-RECV-ST01-S01-P01-B01',
  'Приёмка / временная ячейка',
  '{"slotProfile":{"materialType":"ANY","processType":"RECV","storagePurpose":"receiving","allowMixedNomenclature":true,"allowMixedBatches":true,"capacityUnits":999999999}}'::jsonb,
  now()
FROM wms_warehouses w
JOIN wms_zones z ON z.warehouse_id = w.warehouse_id AND z.zone_code = 'RECV'
WHERE w.warehouse_code = 'OS'
ON CONFLICT (site_id, location_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  location_attrs_json = EXCLUDED.location_attrs_json,
  updated_at = now();
