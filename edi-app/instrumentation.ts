export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.EDI_WORKER === "0") return
  const { tryGetPool } = await import("./lib/db.ts")
  const pool = tryGetPool()
  if (!pool) return
  const { startWorker } = await import("./lib/edi/worker.ts")
  startWorker(pool, Number(process.env.EDI_WORKER_INTERVAL_MS || 60_000))
}
