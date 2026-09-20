import { getDbHealthResponse } from "@/lib/wms/db-health-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Диагностика подключения к PostgreSQL.
 * GET /api/wms/health — когда интерфейс подхватывает junction `app/api/wms`.
 */
export async function GET() {
  return getDbHealthResponse();
}
