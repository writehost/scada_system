import { printTimeKey } from "@/lib/wms/row-identify-print-time"

function adapterBase(): string {
  return (process.env.VEKAS_ADAPTER_URL || "http://127.0.0.1:8792").trim().replace(/\/$/, "")
}

async function adapterPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${adapterBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Vekas adapter HTTP ${res.status}`), { status: res.status >= 500 ? 502 : res.status })
  }
  return data
}

export type VekasBottleLookup = {
  server: string
  code: string
  gtin: string | null
  serial: string | null
  printedOn: string | null
  validatedOn: string | null
  productionDate: string | null
  batchNumber: string | null
  productName: string | null
  palletCode: string | null
  source: string
}

export type VekasRangeCode = {
  code: string
  printedOn: string | null
  validatedOn: string | null
  gtin: string | null
  serial: string | null
  batchNumber: string | null
  productName: string | null
  palletCode?: string | null
}

export type VekasRangePallet = {
  palletId: string
  quantity?: number | null
  batchNumber?: string | null
  productName?: string | null
  nomenclature?: string | null
  gtin?: string | null
}

export async function lookupVekasBottle(
  code: string,
  opts?: { producedFrom?: string }
): Promise<VekasBottleLookup> {
  const body: Record<string, unknown> = { code }
  if (opts?.producedFrom) body.producedFrom = opts.producedFrom
  return adapterPost("/api/wms/vekas/codes/lookup", body)
}

export async function listVekasCodesInPrintRange(input: {
  gtin: string
  timeFrom: string
  timeTo: string
  server?: string | null
}): Promise<{ total: number; items: VekasRangeCode[] }> {
  return adapterPost("/api/wms/vekas/codes/range", input)
}

export async function listVekasPalletsBetween(input: {
  gtin: string
  startPallet?: string | null
  endPallet?: string | null
  timeFrom?: string | null
  timeTo?: string | null
  server?: string | null
}): Promise<{ total: number; items: VekasRangePallet[] }> {
  return adapterPost("/api/wms/vekas/row-pallets", input)
}

/** Vekas PrintedOn без таймзоны — как в таблице партий WMS, не переводить в UTC. */
export function vekasTimeKey(value: string | null | undefined): string {
  return printTimeKey(value)
}
