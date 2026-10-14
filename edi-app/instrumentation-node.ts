import { tryGetPool } from "./lib/db.ts"
import { startWorker } from "./lib/edi/worker.ts"

// Фоновый исполнитель (сроки, сверка приёмки WMS, доставка уведомлений). EDI_WORKER=0 — выключить в этом процессе.
if (process.env.EDI_WORKER === "1" && process.env.NODE_ENV !== "production") {
  const pool = tryGetPool()
  if (pool) startWorker(pool, Number(process.env.EDI_WORKER_INTERVAL_MS || 60_000))
}
