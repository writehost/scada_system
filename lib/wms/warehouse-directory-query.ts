import type { PoolClient } from "pg"
import {
  defaultWarehouseMeta,
  mergeWarehouseMeta,
  statusToIsActive,
  WAREHOUSE_STATUS_CODES,
  type WarehouseMeta,
} from "@/lib/wms/warehouse-directory-meta"

export type WarehouseDirectoryDto = {
  id: string
  publicId: string
  code: string
  name: string
  shortName: string | null
  description: string | null
  status: string
  warehouseType: string
  isActive: boolean
  meta: WarehouseMeta
  createdAt: string
  updatedAt: string
}

type WarehouseSqlRow = {
  warehouse_id: string
  public_id?: string | null
  warehouse_code: string
  name: string
  short_name?: string | null
  description?: string | null
  status_code?: string | null
  warehouse_type?: string | null
  is_active?: boolean | null
  meta_json?: unknown
  created_at?: string | null
  updated_at?: string | null
}

function missingColumn(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes("does not exist") ||
    msg.includes("public_id") ||
    msg.includes("status_code") ||
    msg.includes("meta_json") ||
    msg.includes("short_name")
  )
}

export function rowToWarehouseDto(r: WarehouseSqlRow): WarehouseDirectoryDto {
  const isActive = r.is_active !== false
  return {
    id: String(r.warehouse_id),
    publicId: String(r.public_id || r.warehouse_id),
    code: r.warehouse_code,
    name: r.name,
    shortName: r.short_name ?? null,
    description: r.description ?? null,
    status: r.status_code || (isActive ? "ACTIVE" : "INACTIVE"),
    warehouseType: r.warehouse_type || "MAIN",
    isActive,
    meta: mergeWarehouseMeta(r.meta_json as Record<string, unknown>),
    createdAt: r.created_at || "",
    updatedAt: r.updated_at || "",
  }
}

const FULL_SELECT = `
  warehouse_id::text,
  COALESCE(public_id::text, warehouse_id::text) AS public_id,
  warehouse_code,
  name,
  short_name,
  description,
  status_code,
  warehouse_type,
  is_active,
  meta_json,
  created_at::text,
  updated_at::text
`

const FALLBACK_SELECT = `
  warehouse_id::text,
  warehouse_id::text AS public_id,
  warehouse_code,
  name,
  NULL::text AS short_name,
  NULL::text AS description,
  CASE WHEN COALESCE(is_active, TRUE) THEN 'ACTIVE' ELSE 'INACTIVE' END AS status_code,
  COALESCE(warehouse_type, 'MAIN') AS warehouse_type,
  COALESCE(is_active, TRUE) AS is_active,
  COALESCE(meta_json, '{}'::jsonb) AS meta_json,
  created_at::text,
  updated_at::text
`

const MINIMAL_SELECT = `
  warehouse_id::text,
  warehouse_id::text AS public_id,
  warehouse_code,
  name,
  NULL::text AS short_name,
  NULL::text AS description,
  CASE WHEN COALESCE(is_active, TRUE) THEN 'ACTIVE' ELSE 'INACTIVE' END AS status_code,
  'MAIN'::text AS warehouse_type,
  COALESCE(is_active, TRUE) AS is_active,
  '{}'::jsonb AS meta_json,
  created_at::text,
  updated_at::text
`

async function queryRows(client: PoolClient, where: string, params: unknown[]) {
  try {
    return await client.query<WarehouseSqlRow>(`SELECT ${FULL_SELECT} FROM wms_warehouses ${where}`, params)
  } catch (e) {
    if (!missingColumn(e)) throw e
    try {
      return await client.query<WarehouseSqlRow>(`SELECT ${FALLBACK_SELECT} FROM wms_warehouses ${where}`, params)
    } catch (e2) {
      if (!missingColumn(e2)) throw e2
      return await client.query<WarehouseSqlRow>(`SELECT ${MINIMAL_SELECT} FROM wms_warehouses ${where}`, params)
    }
  }
}

export async function listWarehouseRows(client: PoolClient, siteId: number) {
  const r = await queryRows(client, `WHERE site_id = $1 ORDER BY warehouse_code`, [siteId])
  return r.rows.map(rowToWarehouseDto)
}

export async function getWarehouseRow(client: PoolClient, siteId: number, id: string) {
  const r = await queryRows(client, `WHERE site_id = $1 AND warehouse_id = $2::bigint`, [siteId, id])
  return r.rows[0] ? rowToWarehouseDto(r.rows[0]) : null
}

export function normalizeWarehouseStatus(raw: string | undefined): string {
  const status = (raw ?? "").trim().toUpperCase()
  return (WAREHOUSE_STATUS_CODES as readonly string[]).includes(status) ? status : "ACTIVE"
}

export function warehouseMetaFromBody(meta?: Partial<WarehouseMeta> | null): WarehouseMeta {
  return { ...defaultWarehouseMeta(), ...(meta ?? {}) }
}

export { statusToIsActive, defaultWarehouseMeta }
