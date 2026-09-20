import { NextResponse } from "next/server"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import {
  clearApplyJob,
  patchApplyJob,
  readApplyJob,
  resolveApplyJobFile,
  setApplyJobFile,
  writeApplyJob,
  type UpdateApplyJob,
} from "@/lib/update-apply-job"
import { readLocalBuildMeta } from "@/lib/app-version"
import {
  bootstrapScriptsFromRelease,
  ensureUpdateEnvLocal,
} from "@/lib/server/bootstrap-update-scripts"
import { getUpdateServerBaseUrl, type WmsReleaseInfo } from "@/lib/update-server-client"
import { isWmsAdmin } from "@/lib/wms-admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function repoRootFromCwd(): string {
  const cwd = process.cwd()
  if (cwd.replace(/\\/g, "/").endsWith("/interface")) {
    return path.resolve(cwd, "..", "..")
  }
  if (cwd.replace(/\\/g, "/").endsWith("/Frontend")) {
    return path.resolve(cwd, "..")
  }
  return path.resolve(cwd, "..", "..")
}

function resolveApplyCommand(): { cmd: string; args: string[] } {
  const custom = process.env.WMS_UPDATE_APPLY_SCRIPT?.trim()
  if (custom) {
    if (process.platform === "win32") {
      return { cmd: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", custom] }
    }
    if (fs.existsSync(custom)) {
      return { cmd: "bash", args: [custom] }
    }
  }

  const root = repoRootFromCwd()
  const shellScript = path.join(root, "scripts", "apply-wms-update-10.26.sh")
  if (process.platform !== "win32") {
    return { cmd: "bash", args: [shellScript] }
  }
  const devScript = path.join(root, "scripts", "apply-wms-update.mjs")
  return { cmd: process.execPath, args: [devScript] }
}

export async function POST(req: Request) {
  const token = await readAuthTokenFromRequest(req)
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const session = await verifySessionToken(token)
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (!isWmsAdmin(session.roleCodes)) {
    return NextResponse.json({ error: "forbidden: admin only" }, { status: 403 })
  }

  let body: { release?: WmsReleaseInfo }
  try {
    body = (await req.json()) as { release?: WmsReleaseInfo }
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const release = body.release
  const targetBuildId = String(release?.buildId ?? "").trim()
  if (!targetBuildId) {
    return NextResponse.json({ error: "release.buildId is required" }, { status: 400 })
  }

  const uiCwd = process.cwd()
  setApplyJobFile(resolveApplyJobFile(uiCwd))

  const localBuild = readLocalBuildMeta()
  let running = readApplyJob()
  if (running?.status === "running") {
    const startedMs = Date.parse(running.startedAt)
    const stale =
      (Number.isFinite(startedMs) && Date.now() - startedMs > 20 * 60 * 1000) ||
      (targetBuildId && localBuild.buildId === targetBuildId)
    if (stale) {
      clearApplyJob()
      running = null
    } else {
      return NextResponse.json({ error: "update already running", job: running }, { status: 409 })
    }
  }

  const repoRoot = repoRootFromCwd()
  const jobFile = resolveApplyJobFile(uiCwd)

  const jobId = `job-${Date.now()}`
  const job: UpdateApplyJob = {
    jobId,
    status: "running",
    targetBuildId,
    startedAt: new Date().toISOString(),
    message: "Запуск обновления…",
  }

  try {
    writeApplyJob(job)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `Не удалось записать job обновления: ${msg}` },
      { status: 500 }
    )
  }
  const updateServerUrl = getUpdateServerBaseUrl() || "https://scada25.ru"

  try {
    writeApplyJob({ ...job, message: "Загрузка скриптов обновления с scada25…" })
    if (release?.packageUrl) {
      await bootstrapScriptsFromRelease(release, repoRoot, updateServerUrl)
    }
    ensureUpdateEnvLocal(uiCwd, updateServerUrl)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    writeApplyJob({
      ...job,
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: `Не удалось подготовить обновление: ${msg}`,
    })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const payload = JSON.stringify({
    release,
    uiCwd,
    repoRoot,
    updateServerUrl,
    jobFile,
  })

  const { cmd, args } = resolveApplyCommand()
  const child = spawn(cmd, [...args], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WMS_UPDATE_PAYLOAD: payload },
  })

  let log = ""
  child.stdout?.on("data", (chunk) => {
    log += String(chunk)
    patchApplyJob({ log: log.slice(-8000) })
  })
  child.stderr?.on("data", (chunk) => {
    log += String(chunk)
    patchApplyJob({ log: log.slice(-8000) })
  })

  child.on("close", (code) => {
    const current = readApplyJob() || job
    if (current.status !== "running") return
    if (code === 0) {
      writeApplyJob({
        ...current,
        status: "done",
        finishedAt: new Date().toISOString(),
        message: "Обновление установлено",
        log: log.slice(-8000),
      })
    } else {
      const logTail = log.trim().slice(-1200)
      const detail = logTail || current.message || ""
      writeApplyJob({
        ...current,
        status: "failed",
        finishedAt: new Date().toISOString(),
        message: detail
          ? detail.split("\n").slice(-3).join(" ").slice(0, 500)
          : `Ошибка обновления (код ${code ?? "?"})`,
        log: log.slice(-8000),
      })
    }
  })

  child.unref()

  return NextResponse.json({ ok: true, jobId, status: "running" })
}
