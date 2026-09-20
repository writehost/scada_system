import { NextResponse } from "next/server"
import { assertLabelOrderMasterCode } from "@/lib/wms/label-order-master"
import {
  getAiFillJob,
  requestAiFillStop,
  startAiFillJob,
} from "@/lib/wms/nomenclature-ai-fill"
import { tryGetPool } from "@/lib/wms/pool"
import { requireWmsSession } from "@/lib/wms/require-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function publicJob(job: ReturnType<typeof getAiFillJob>) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    apply: job.apply,
    limit: job.limit,
    total: job.total,
    processed: job.processed,
    filledGroup: job.filledGroup,
    filledClass: job.filledClass,
    placements: job.placements,
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
  const url = new URL(req.url)
  const jobId = url.searchParams.get("jobId")?.trim() || ""
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })
  const job = getAiFillJob(jobId)
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
  }
  const action = String(body.action || "start").trim()

  if (action === "stop") {
    const jobId = String(body.jobId || "").trim()
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })
    const job = requestAiFillStop(jobId)
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
    const job = startAiFillJob({
      pool,
      siteCode,
      apply: body.apply === true,
      limit: Number(body.limit) || 30,
    })
    return NextResponse.json({ ok: true, job: publicJob(getAiFillJob(job.id)) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "не удалось запустить заполнение"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
