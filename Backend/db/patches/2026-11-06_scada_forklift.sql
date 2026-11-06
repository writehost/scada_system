-- SCADA System Forklift (поверх 2026-11-03_scada_route.sql).
-- Только таблицы route_*; таблицы WMS не меняются. Приложение выполняет то же самое при старте (ensureRouteSchema),
-- патч — для DBA, если права приложения на DDL ограничены. Все шаги идемпотентны.
BEGIN;

-- режим кары: REAL (эксплуатация) / SIMULATION (учебный, без складских транзакций)
ALTER TABLE route_forklift_profiles ADD COLUMN IF NOT EXISTS op_mode TEXT NOT NULL DEFAULT 'REAL';

-- учебные задания; уникальность «одно открытое задание на палету» — отдельно для реальных и учебных
ALTER TABLE route_tasks ADD COLUMN IF NOT EXISTS simulation BOOLEAN NOT NULL DEFAULT FALSE;
DROP INDEX IF EXISTS route_tasks_one_open_per_hu_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS route_tasks_one_open_per_hu_real_uidx
  ON route_tasks (site_id, hu_code) WHERE status NOT IN ('COMPLETED','CANCELLED') AND NOT simulation;
CREATE UNIQUE INDEX IF NOT EXISTS route_tasks_one_open_per_hu_sim_uidx
  ON route_tasks (site_id, hu_code) WHERE status NOT IN ('COMPLETED','CANCELLED') AND simulation;

-- крепление метки (ceiling | wall) и версия привязки
ALTER TABLE route_apriltag_markers ADD COLUMN IF NOT EXISTS mount TEXT NOT NULL DEFAULT 'ceiling';
ALTER TABLE route_apriltag_markers ADD COLUMN IF NOT EXISTS binding_version INT NOT NULL DEFAULT 1;

-- версия калибровки, по которой посчитана позиция; состояние сервиса позиционирования
ALTER TABLE route_positions ADD COLUMN IF NOT EXISTS calibration_version TEXT;
ALTER TABLE route_devices ADD COLUMN IF NOT EXISTS status JSONB;
ALTER TABLE route_devices ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;

COMMIT;

-- ОТКАТ (выполнять только после остановки новой версии приложения; учебные задания будут удалены):
-- BEGIN;
-- DELETE FROM route_tasks WHERE simulation;
-- DROP INDEX IF EXISTS route_tasks_one_open_per_hu_real_uidx;
-- DROP INDEX IF EXISTS route_tasks_one_open_per_hu_sim_uidx;
-- CREATE UNIQUE INDEX IF NOT EXISTS route_tasks_one_open_per_hu_uidx
--   ON route_tasks (site_id, hu_code) WHERE status NOT IN ('COMPLETED','CANCELLED');
-- ALTER TABLE route_tasks DROP COLUMN IF EXISTS simulation;
-- ALTER TABLE route_forklift_profiles DROP COLUMN IF EXISTS op_mode;
-- ALTER TABLE route_apriltag_markers DROP COLUMN IF EXISTS mount;
-- ALTER TABLE route_apriltag_markers DROP COLUMN IF EXISTS binding_version;
-- ALTER TABLE route_positions DROP COLUMN IF EXISTS calibration_version;
-- ALTER TABLE route_devices DROP COLUMN IF EXISTS status;
-- ALTER TABLE route_devices DROP COLUMN IF EXISTS status_at;
-- COMMIT;
