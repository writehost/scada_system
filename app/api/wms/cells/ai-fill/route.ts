import { NextResponse } from "next/server"
import { getCellsAiJob, requestCellsAiStop, startCellsAiJob } from "@/lib/wms/cells-ai-fill"
import { assertLabelOrderMasterCode } from "@/lib/wms/label-order-master"
import { tryGetPool } from "@/lib/wms/pool"
import { requireWmsSession } from "@/lib/wms/require-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function publicJob(job: ReturnType<typeof getCellsAiJob>) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    apply: job.apply,
    limit: job.limit,
    total: job.total,
    processed: job.processed,
    filled: job.filled,
    skipped: job.skipped,
    error: job.error,
    log: job.log,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}

export async function GET(req: Request) {
  const auth = await requireWmsSession(req)
  if ("error" in auth) return auth.error
  const jobId = new URL(req.url).searchParams.get("jobId")?.trim() || ""
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })
  const job = getCellsAiJob(jobId)
  if (!job) return NextResponse.json({ error: "задача не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true, job: publicJob(job) })
}

export async function POST(req: Request) {
  const auth = await requireWmsSession(req)
  if ("error" in auth) return auth.error
  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    siteCode?: string
    masterCode?: string
    jobId?: string
    apply?: boolean
    limit?: number
    warehouseCode?: string
    zoneCode?: string
  }
  const action = String(body.action || "start").trim()
  if (action === "stop") {
    const jobId = String(body.jobId || "").trim()
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })
    const job = requestCellsAiStop(jobId)
    if (!job) return NextResponse.json({ error: "задача не найдена" }, { status: 404 })
    return NextResponse.json({ ok: true, job: publicJob(job) })
  }
  if (!assertLabelOrderMasterCode(body.masterCode)) {
    return NextResponse.json({ error: "Неверный мастер-ключ" }, { status: 403 })
  }
  const siteCode = String(body.siteCode || "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  try {
    const job = startCellsAiJob({
      pool,
      siteCode,
      apply: body.apply === true,
      limit: Number(body.limit) || 30,
      warehouseCode: String(body.warehouseCode || "").trim(),
      zoneCode: String(body.zoneCode || "").trim(),
    })
    return NextResponse.json({ ok: true, job: publicJob(getCellsAiJob(job.id)) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "не удалось запустить настройку ячеек"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
