import { getSiteCode } from "@/lib/wms-api"
import { authRequestHeaders } from "@/lib/auth/client-token"

export const CELLS_AI_MAX_LIMIT = 700

export type CellsAiJobView = {
  id: string
  status: "running" | "stopping" | "stopped" | "done" | "error"
  apply: boolean
  limit: number
  total: number
  processed: number
  filled: number
  skipped: number
  error: string | null
  log: Array<{
    locationCode: string
    warehouseCode: string
    zoneCode: string
    materialType: string | null
    processType: string | null
    title: string | null
    lane?: string | null
    action: "filled" | "preview" | "skipped" | "error"
    note: string
  }>
  startedAt: string
  finishedAt: string | null
}

async function readJson(res: Response): Promise<{ ok?: boolean; job?: CellsAiJobView; error?: string }> {
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; job?: CellsAiJobView; error?: string }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function startCellsAiFill(input: {
  masterCode: string
  apply: boolean
  limit: number
  warehouseCode?: string
  zoneCode?: string
}): Promise<CellsAiJobView> {
  const res = await fetch("/api/wms/cells/ai-fill", {
    method: "POST",
    cache: "no-store",
    headers: authRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      action: "start",
      siteCode: getSiteCode(),
      masterCode: input.masterCode,
      apply: input.apply,
      limit: input.limit,
      warehouseCode: input.warehouseCode || "",
      zoneCode: input.zoneCode || "",
    }),
  })
  const data = await readJson(res)
  if (!data.job) throw new Error("задача не создана")
  return data.job
}

export async function pollCellsAiFill(jobId: string): Promise<CellsAiJobView> {
  const res = await fetch(`/api/wms/cells/ai-fill?jobId=${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    headers: authRequestHeaders(),
  })
  const data = await readJson(res)
  if (!data.job) throw new Error("задача не найдена")
  return data.job
}

export async function stopCellsAiFill(jobId: string): Promise<CellsAiJobView> {
  const res = await fetch("/api/wms/cells/ai-fill", {
    method: "POST",
    cache: "no-store",
    headers: authRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ action: "stop", jobId }),
  })
  const data = await readJson(res)
  if (!data.job) throw new Error("задача не найдена")
  return data.job
}
