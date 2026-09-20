import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { canonicalPlanRowId } from "@/lib/wms/fg-plan-location-codes"
import type { FgPlanRowCatalogItem } from "./row-identify-types"

let cache: FgPlanRowCatalogItem[] | null = null

async function loadCatalog(): Promise<FgPlanRowCatalogItem[]> {
  if (cache) return cache
  const candidates = [
    process.env.WMS_FG_PLAN_ROWS_PATH?.trim(),
    join(process.cwd(), "data", "fg-plan-rows.json"),
    join(process.cwd(), "..", "warehouse_wms_fg", "src", "data", "warehouse-rows.json"),
    join(process.cwd(), "..", "..", "wms_map", "warehouse_wms_fg", "src", "data", "warehouse-rows.json"),
  ].filter((value): value is string => Boolean(value))

  for (const file of candidates) {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as { rows?: FgPlanRowCatalogItem[] }
      if (Array.isArray(raw.rows) && raw.rows.length > 0) {
        cache = raw.rows.map((row) => ({
          id: row.id,
          zone: row.zone,
          number: String(row.number),
          group: row.group ?? null,
          capacity: Number(row.capacity) || 0,
          sections: (row.sections ?? []).map((section) => ({
            code: section.code,
            label: section.label,
            count: Number(section.count) || 0,
          })),
        }))
        return cache
      }
    } catch {
      /* try next */
    }
  }
  cache = []
  return cache
}

export async function listPlanRows(query?: string): Promise<FgPlanRowCatalogItem[]> {
  const rows = await loadCatalog()
  const q = (query ?? "").trim().toLocaleLowerCase("ru")
  if (!q) return rows
  return rows.filter((row) => {
    const hay = `${row.id} ${row.zone} ${row.number} ${row.group ?? ""}`.toLocaleLowerCase("ru")
    return hay.includes(q)
  })
}

export async function findPlanRow(rowId: string): Promise<FgPlanRowCatalogItem | null> {
  const wanted = rowId.trim().toLocaleLowerCase("ru")
  if (!wanted) return null
  const rows = await loadCatalog()
  const direct =
    rows.find((row) => row.id.toLocaleLowerCase("ru") === wanted) ||
    rows.find((row) => `${row.zone}-${row.number}`.toLocaleLowerCase("ru") === wanted)
  if (direct) return direct
  const canon = canonicalPlanRowId(rowId).toLocaleLowerCase("ru")
  if (!canon || canon === wanted) return null
  return rows.find((row) => row.id.toLocaleLowerCase("ru") === canon) || null
}

export function slotAddressesForRow(row: FgPlanRowCatalogItem): string[] {
  const out: string[] = []
  for (const section of row.sections) {
    for (let position = 1; position <= section.count; position += 1) {
      out.push(`${row.id}-${section.code}-${String(position).padStart(3, "0")}`.toUpperCase())
    }
  }
  return out
}
