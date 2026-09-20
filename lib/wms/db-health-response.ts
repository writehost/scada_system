import { NextResponse } from "next/server"
import { describeDatabaseConfig, tryConnect, tryGetPool } from "./pool"

function publicDatabaseInfo(cfg: ReturnType<typeof describeDatabaseConfig>) {
  return {
    source: cfg.source,
    connected: false as boolean,
  }
}

/** Диагностика PostgreSQL для `/api/wms/health` — без путей и секретов. */
export async function getDbHealthResponse(): Promise<NextResponse> {
  const cfg = describeDatabaseConfig()
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json(
      {
        ok: false,
        database: {
          ...publicDatabaseInfo(cfg),
          hint:
            cfg.source === "none"
              ? "Нет DATABASE_URL/PG_URL. Задайте подключение в настройках."
              : "Конфиг найден, но пул не создан.",
        },
      },
      { status: 503 }
    )
  }

  const conn = await tryConnect(pool)
  if (!conn.ok) {
    return NextResponse.json(
      {
        ok: false,
        database: {
          ...publicDatabaseInfo(cfg),
          code: conn.code,
          hint:
            conn.code === "db_auth_failed"
              ? "Неверный логин или пароль базы."
              : "PostgreSQL не отвечает.",
        },
      },
      { status: 503 }
    )
  }

  conn.client.release()
  return NextResponse.json({
    ok: true,
    database: {
      ...publicDatabaseInfo(cfg),
      connected: true,
    },
  })
}
