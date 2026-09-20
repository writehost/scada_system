import { NextResponse } from "next/server"
import { readLocalBuildMeta } from "@/lib/app-version"
import { readApplyJob, resolveApplyJobFile, setApplyJobFile, writeApplyJob } from "@/lib/update-apply-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  setApplyJobFile(resolveApplyJobFile(process.cwd()))
  const target = new URL(req.url).searchParams.get("targetBuildId")?.trim() || ""
  const local = readLocalBuildMeta()
  let job = readApplyJob()

  const installed = Boolean(target) && local.buildId === target
  if (installed && job?.status === "running" && job.targetBuildId === target) {
    job = {
      ...job,
      status: "done",
      finishedAt: new Date().toISOString(),
      message: "Обновление установлено",
    }
    writeApplyJob(job)
  }

  return NextResponse.json({
    local,
    job,
    installed,
    ready: installed || job?.status === "done",
  }, {
    headers: { "Cache-Control": "no-store" },
  })
}
