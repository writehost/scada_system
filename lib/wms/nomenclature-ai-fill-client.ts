import { getSiteCode } from "@/lib/wms-api"
import { authRequestHeaders } from "@/lib/auth/client-token"

export type AiFillJobView = {
  id: string
  status: "running" | "stopping" | "stopped" | "done" | "error"
  apply: boolean
  limit: number
  total: number
  processed: number
  filledGroup: number
  filledClass: number
  placements: number
  skipped: number
  error: string | null
  log: Array<{
    itemCode: string
    name: string
    groupCode: string | null
    classCode: string | null
    locationCode: string | null
    action: "filled" | "preview" | "skipped" | "error"
    note: string
  }>
  startedAt: string
  finishedAt: string | null
}

async function readJson(res: Response): Promise<{ ok?: boolean; job?: AiFillJobView; error?: string }> {
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; job?: AiFillJobView; error?: string }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function startNomenclatureAiFill(input: {
  masterCode: string
  apply: boolean
  limit: number
}): Promise<AiFillJobView> {
  const res = await fetch("/api/wms/nomenclature/ai-fill", {
    method: "POST",
    cache: "no-store",
    headers: authRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      action: "start",
      siteCode: getSiteCode(),
      masterCode: input.masterCode,
      apply: input.apply,
      limit: input.limit,
    }),
  })
  const data = await readJson(res)
  if (!data.job) throw new Error("задача не создана")
  return data.job
}

export async function pollNomenclatureAiFill(jobId: string): Promise<AiFillJobView> {
  const qp = new URLSearchParams({ jobId })
  const res = await fetch(`/api/wms/nomenclature/ai-fill?${qp.toString()}`, {
    cache: "no-store",
    headers: authRequestHeaders(),
  })
  const data = await readJson(res)
  if (!data.job) throw new Error("задача не найдена")
  return data.job
}

export async function stopNomenclatureAiFill(jobId: string): Promise<AiFillJobView> {
  const res = await fetch("/api/wms/nomenclature/ai-fill", {
    method: "POST",
    cache: "no-store",
    headers: authRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ action: "stop", jobId }),
  })
  const data = await readJson(res)
  if (!data.job) throw new Error("задача не найдена")
  return data.job
}
