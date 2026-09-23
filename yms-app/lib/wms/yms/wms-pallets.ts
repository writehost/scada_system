import type { PoolClient } from "pg"
import { normalizeScanCode, type PalletOnOrder } from "@/lib/wms/yms/pallet-scan"

export type OrderPallets = {
  available: boolean
  gap: string | null
  pallets: PalletOnOrder[]
  wmsScanCodes: string[]
}

export async function readOrderPallets(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<OrderPallets> {
  if (!/^\d+$/.test(documentId)) {
    return { available: false, gap: "bad_document", pallets: [], wmsScanCodes: [] }
  }
  try {
    const units = await client.query<{
      loadUnitId: string
      code: string
      status: string | null
    }>(
      `SELECT load_unit_id::text AS "loadUnitId",
              load_unit_code AS code,
              status_code AS status
       FROM wms_load_units
       WHERE site_id = $1 AND document_id = $2::bigint
       ORDER BY load_unit_code`,
      [siteId, documentId]
    )
    const scans = await client.query<{ scans: unknown }>(
      `SELECT task_payload->'shipScans' AS scans
       FROM wms_tasks
       WHERE site_id = $1 AND document_id = $2::bigint`,
      [siteId, documentId]
    )
    const wmsScanCodes: string[] = []
    for (const row of scans.rows) {
      if (!Array.isArray(row.scans)) continue
      for (const item of row.scans) {
        if (!item || typeof item !== "object") continue
        const code = normalizeScanCode(String((item as { code?: string }).code || ""))
        if (code) wmsScanCodes.push(code)
      }
    }
    return {
      available: true,
      gap: units.rows.length ? null : "wms_pallets_missing",
      pallets: units.rows.map((row) => ({
        code: row.code,
        loadUnitId: row.loadUnitId,
        status: row.status || "planned",
        qty: 1,
      })),
      wmsScanCodes,
    }
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "42P01" || code === "42703") {
      return {
        available: false,
        gap: "wms_pallet_api_missing",
        pallets: [],
        wmsScanCodes: [],
      }
    }
    throw error
  }
}
