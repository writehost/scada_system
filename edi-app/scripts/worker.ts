import { tryGetPool } from "../lib/db.ts"
import { startWorker } from "../lib/edi/worker.ts"
import { assertSchemaReady } from "../lib/edi/schema.ts"

const pool = tryGetPool()
if (!pool) throw new Error("DATABASE_URL is required")
const client = await pool.connect()
try { await assertSchemaReady(client) } finally { client.release() }
const stop = startWorker(pool, Number(process.env.EDI_WORKER_INTERVAL_MS || 60_000))
let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await stop()
  await pool!.end()
}
process.once("SIGTERM", () => void shutdown())
process.once("SIGINT", () => void shutdown())
