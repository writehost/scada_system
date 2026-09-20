import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";

const LEGACY = new Set(["water", "stickers", "custom"]);

async function defsTableExists(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'wms_packaging_profile_defs'
     ) AS ok`
  );
  return Boolean(r.rows[0]?.ok);
}

async function defsCount(client: PoolClient, siteId: number): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM wms_packaging_profile_defs WHERE site_id = $1`,
    [siteId]
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Возвращает канонический `profile_code` из справочника.
 * - Если справочник заполнен для площадки — только активные коды из таблицы.
 * - Если таблицы нет или строк нет — допускаются legacy water/stickers/custom; прочее для импорта может смягчаться через looseUnknown.
 */
export async function canonicalPackagingProfile(
  client: PoolClient,
  siteId: number,
  raw: string,
  opts?: { looseUnknown?: boolean }
): Promise<string> {
  const looseUnknown = Boolean(opts?.looseUnknown);
  const key = raw.trim().toLowerCase();
  if (!key) {
    throw new WmsHttpError(400, "Профиль упаковки не может быть пустым", "invalid_field");
  }

  if (!(await defsTableExists(client))) {
    if (LEGACY.has(key)) return key;
    if (looseUnknown) return "custom";
    throw new WmsHttpError(400, "invalid packagingProfile", "invalid_field");
  }

  const n = await defsCount(client, siteId);
  if (n === 0) {
    if (LEGACY.has(key)) return key;
    if (looseUnknown) return "custom";
    throw new WmsHttpError(400, "invalid packagingProfile", "invalid_field");
  }

  const r = await client.query<{ profile_code: string }>(
    `SELECT profile_code FROM wms_packaging_profile_defs
     WHERE site_id = $1 AND LOWER(profile_code) = $2 AND is_active = TRUE`,
    [siteId, key]
  );
  if (r.rows[0]) return r.rows[0].profile_code;

  if (looseUnknown && LEGACY.has(key)) return key;
  throw new WmsHttpError(
    400,
    `Неизвестный профиль упаковки: ${raw.trim()}`,
    "invalid_packaging_profile"
  );
}

/** Импорт: пустое значение → `custom`; при отсутствии строк справочника неизвестные коды смягчаются до `custom`. */
export async function resolvePackagingProfileForImport(
  client: PoolClient,
  siteId: number,
  raw: unknown
): Promise<string> {
  const s = typeof raw === "string" ? raw.trim() : "";
  return canonicalPackagingProfile(client, siteId, s || "custom", { looseUnknown: true });
}
