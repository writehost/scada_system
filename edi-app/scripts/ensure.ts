/**
 * Создание/обновление схемы EDI в общей базе (только добавляющие операции) и справочных данных.
 * Запуск при деплое: DATABASE_URL=… npm run ensure
 */
import { poolFromUrl } from "../lib/db.ts"
import { ensureEdiSchema, EDI_SCHEMA_VERSION } from "../lib/edi/schema.ts"
import { seedReference } from "../lib/edi/seed.ts"

const url = process.env.DATABASE_URL || process.env.PG_URL || ""
if (!url) throw new Error("DATABASE_URL is missing")
const pool = poolFromUrl(url, 1)
const client = await pool.connect()
try {
  const wms = await client.query<{ ok: boolean }>(`SELECT to_regclass('public.wms_sites') IS NOT NULL AND to_regclass('public.wms_users') IS NOT NULL AS ok`)
  if (!wms.rows[0].ok) throw new Error("В базе нет таблиц WMS (wms_sites, wms_users): EDI ставится в общую базу SCADA System")
  await ensureEdiSchema(client)
  await seedReference(client)
  const t = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'edi\\_%'`)
  console.log(`edi_ready schema=${EDI_SCHEMA_VERSION} tables=${t.rows[0].n}`)
} finally {
  client.release()
  await pool.end()
}
