import type { PoolClient } from "pg"

export type SkitLabelMatch = {
  itemCode: string
  itemName: string
  score: number
}

function labelTokens(label: string): string[] {
  const normalized = label
    .toLowerCase()
    .replace(/№/g, " ")
    .replace(/[^\p{L}\p{N}\s,.]/gu, " ")
  return [
    ...new Set(
      normalized
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !["газ", "план", "славда", "напитки", "тоник"].includes(t))
    ),
  ].slice(0, 5)
}

export async function resolveSkitProductLabels(
  client: PoolClient,
  siteId: number,
  labels: string[]
): Promise<Record<string, SkitLabelMatch | null>> {
  const unique = [...new Set(labels.map((l) => l.trim()).filter(Boolean))]
  const out: Record<string, SkitLabelMatch | null> = {}

  for (const label of unique) {
    const tokens = labelTokens(label)
    if (tokens.length === 0) {
      out[label] = null
      continue
    }

    const params: unknown[] = [siteId]
    const clauses: string[] = ["i.site_id = $1", "COALESCE(i.is_active, true) = true"]
    for (const token of tokens) {
      params.push(`%${token}%`)
      clauses.push(`lower(i.name) LIKE $${params.length}`)
    }

    const r = await client.query<{ item_code: string; name: string }>(
      `SELECT i.item_code, i.name
       FROM wms_items i
       WHERE ${clauses.join(" AND ")}
       ORDER BY
         CASE WHEN EXISTS (
           SELECT 1 FROM wms_item_specs s
           WHERE s.site_id = i.site_id AND s.parent_item_id = i.item_id AND s.is_active = true
         ) THEN 0 ELSE 1 END,
         length(i.name) ASC
       LIMIT 8`,
      params
    )

    if (r.rows.length === 0) {
      out[label] = null
      continue
    }

    const best = r.rows[0]!
    out[label] = {
      itemCode: best.item_code,
      itemName: best.name,
      score: r.rows.length === 1 ? 1 : 0.7,
    }
  }

  return out
}

export function mergeSkitLabelMappings(
  auto: Record<string, SkitLabelMatch | null>,
  overrides: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [label, match] of Object.entries(auto)) {
    const override = overrides[label]?.trim()
    if (override) merged[label] = override
    else if (match?.itemCode) merged[label] = match.itemCode
  }
  for (const [label, code] of Object.entries(overrides)) {
    if (code.trim()) merged[label] = code.trim()
  }
  return merged
}

export type SkitImportRowInput = {
  externalId: string
  planDate: string
  planDateTo?: string | null
  productLabel: string
  lineCode?: string | null
  plannedQty: number
  workshopCode?: string | null
  note?: string | null
}

export type SkitImportRowResult = {
  externalId: string
  productLabel: string
  planDate: string
  status: "created" | "updated" | "skipped" | "error"
  planCode?: string
  error?: string
}
