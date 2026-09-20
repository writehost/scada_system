import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type UpdateApplyJob = {
  jobId: string
  status: "running" | "done" | "failed"
  targetBuildId: string
  startedAt: string
  finishedAt?: string
  message?: string
  log?: string
}

function repoRootFromCwd(cwd = process.cwd()): string {
  const norm = cwd.replace(/\\/g, "/")
  if (norm.endsWith("/Frontend") || norm.endsWith("/interface")) {
    return path.resolve(cwd, "..")
  }
  if (norm.endsWith("/Frontend/interface") || norm.endsWith("/web/interface")) {
    return path.resolve(cwd, "..", "..")
  }
  return path.resolve(cwd, "..")
}

/** Job state in shared/ (writable by scadatable UI), not inside root-owned Frontend/. */
export function resolveApplyJobFile(uiCwd?: string): string {
  const fromEnv = process.env.WMS_UPDATE_JOB_FILE?.trim()
  if (fromEnv) return fromEnv

  const cwd = uiCwd?.trim() || process.cwd()
  const sharedDir = path.join(repoRootFromCwd(cwd), "shared")
  try {
    fs.mkdirSync(sharedDir, { recursive: true })
    return path.join(sharedDir, ".wms-update-job.json")
  } catch {
    return path.join(os.tmpdir(), "wms-update-job.json")
  }
}

let jobFilePath = resolveApplyJobFile()

export function getApplyJobFile(): string {
  return jobFilePath
}

export function setApplyJobFile(filePath: string) {
  jobFilePath = filePath
}

export function readApplyJob(): UpdateApplyJob | null {
  if (!fs.existsSync(jobFilePath)) return null
  try {
    return JSON.parse(fs.readFileSync(jobFilePath, "utf8")) as UpdateApplyJob
  } catch {
    return null
  }
}

export function patchApplyJob(patch: Partial<UpdateApplyJob>) {
  const current = readApplyJob()
  if (!current) return
  writeApplyJob({ ...current, ...patch })
}

export function writeApplyJob(job: UpdateApplyJob) {
  const dir = path.dirname(jobFilePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${jobFilePath}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(job, null, 2)}\n`, "utf8")
  fs.renameSync(tmp, jobFilePath)
}

export function clearApplyJob() {
  if (fs.existsSync(jobFilePath)) fs.unlinkSync(jobFilePath)
}
