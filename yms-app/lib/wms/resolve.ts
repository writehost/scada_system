import type { PoolClient } from "pg"
import { canonicalSiteCode, PRIMARY_SITE_CODE } from "@/lib/wms/site-code"

const SITE_ID_TTL_MS = 10 * 60 * 1000
const siteIdCache = new Map<string, { siteId: number; at: number }>()

export async function getSiteId(client: PoolClient, siteCode: string): Promise<number | null> {
  const requested = siteCode.trim()
  const key = canonicalSiteCode(requested)
  const cached = siteIdCache.get(key)
  if (cached && Date.now() - cached.at < SITE_ID_TTL_MS) return cached.siteId

  const candidates = [...new Set([key, requested, PRIMARY_SITE_CODE, "DEFAULT"].filter(Boolean))]
  const r = await client.query<{ site_id: number }>(
    `SELECT site_id FROM wms_sites
     WHERE is_active AND site_code = ANY($1::text[])
     ORDER BY CASE WHEN site_code = $2 THEN 0 WHEN site_code = $3 THEN 1 ELSE 2 END
     LIMIT 1`,
    [candidates, key, requested]
  )
  const siteId = r.rows[0]?.site_id ?? null
  if (siteId != null) siteIdCache.set(key, { siteId, at: Date.now() })
  return siteId
}
