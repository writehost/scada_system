import type { PoolClient } from "pg";
import {
  mergeSupplierMeta,
  type SupplierMeta,
} from "@/lib/wms/supplier-directory-meta";

export type SupplierDirectoryRow = {
  supplierId: string;
  code: string;
  name: string;
  taxId: string | null;
  meta: SupplierMeta;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function rowToDto(r: {
  supplier_id: string;
  supplier_code: string;
  name: string;
  tax_id: string | null;
  meta_json: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): SupplierDirectoryRow {
  return {
    supplierId: r.supplier_id,
    code: r.supplier_code,
    name: r.name,
    taxId: r.tax_id,
    meta: mergeSupplierMeta(r.meta_json as Record<string, unknown>),
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function supplierCodeFromName(name: string): string {
  const raw = name
    .trim()
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  if (!raw) return `SUP_${Date.now().toString(36).toUpperCase()}`;
  if (/^[A-Z0-9_]+$/.test(raw)) return raw;
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return `SUP_${h.toString(36).toUpperCase()}`;
}

export function normalizeSupplierCode(raw: string): string {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_]{1,64}$/.test(c)) {
    throw new Error("code: только A–Z, цифры и _, до 64 символов");
  }
  return c;
}

const SUPPLIER_SELECT = `SELECT supplier_id::text, supplier_code, name, tax_id,
  COALESCE(meta_json, '{}'::jsonb) AS meta_json,
  is_active, created_at::text, updated_at::text
 FROM wms_suppliers`;

export async function listSupplierDefs(
  client: PoolClient,
  siteId: number,
  opts?: { activeOnly?: boolean }
): Promise<SupplierDirectoryRow[]> {
  const activeOnly = opts?.activeOnly ?? false;
  const result = await client.query<{
    supplier_id: string;
    supplier_code: string;
    name: string;
    tax_id: string | null;
    meta_json: unknown;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `${SUPPLIER_SELECT}
     WHERE site_id = $1
       AND ($2::boolean = false OR is_active = true)
     ORDER BY is_active DESC, name ASC, supplier_code ASC`,
    [siteId, activeOnly]
  );
  return result.rows.map(rowToDto);
}

export async function createSupplierDef(
  client: PoolClient,
  siteId: number,
  input: { code?: string; name: string; taxId?: string | null; meta?: SupplierMeta }
) {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  const code = input.code?.trim() ? normalizeSupplierCode(input.code) : supplierCodeFromName(name);
  const taxId = input.taxId?.trim() || null;
  const meta = mergeSupplierMeta(undefined, input.meta);

  const result = await client.query<{
    supplier_id: string;
    supplier_code: string;
    name: string;
    tax_id: string | null;
    meta_json: unknown;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO wms_suppliers (site_id, supplier_code, name, tax_id, meta_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING supplier_id::text, supplier_code, name, tax_id,
       COALESCE(meta_json, '{}'::jsonb) AS meta_json,
       is_active, created_at::text, updated_at::text`,
    [siteId, code, name, taxId, JSON.stringify(meta)]
  );
  return rowToDto(result.rows[0]);
}

export async function patchSupplierDef(
  client: PoolClient,
  siteId: number,
  supplierCode: string,
  patch: Partial<{ name: string; taxId: string | null; isActive: boolean; meta: SupplierMeta }>
) {
  const existing = await client.query<{ meta_json: unknown }>(
    `SELECT COALESCE(meta_json, '{}'::jsonb) AS meta_json
     FROM wms_suppliers
     WHERE site_id = $1 AND upper(supplier_code) = $2`,
    [siteId, supplierCode.toUpperCase()]
  );
  if (!existing.rows[0]) return null;

  const fields: string[] = [];
  const values: unknown[] = [siteId, supplierCode.toUpperCase()];
  let idx = 3;

  if (typeof patch.name === "string" && patch.name.trim()) {
    fields.push(`name = $${idx++}`);
    values.push(patch.name.trim());
  }
  if (patch.taxId !== undefined) {
    fields.push(`tax_id = $${idx++}`);
    values.push(patch.taxId?.trim() || null);
  }
  if (typeof patch.isActive === "boolean") {
    fields.push(`is_active = $${idx++}`);
    values.push(patch.isActive);
  }
  if (patch.meta !== undefined) {
    const merged = mergeSupplierMeta(existing.rows[0].meta_json as Record<string, unknown>, patch.meta);
    fields.push(`meta_json = $${idx++}::jsonb`);
    values.push(JSON.stringify(merged));
  }
  if (fields.length === 0) return null;

  fields.push("updated_at = now()");

  const result = await client.query<{
    supplier_id: string;
    supplier_code: string;
    name: string;
    tax_id: string | null;
    meta_json: unknown;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE wms_suppliers
     SET ${fields.join(", ")}
     WHERE site_id = $1 AND upper(supplier_code) = $2
     RETURNING supplier_id::text, supplier_code, name, tax_id,
       COALESCE(meta_json, '{}'::jsonb) AS meta_json,
       is_active, created_at::text, updated_at::text`,
    values
  );
  return result.rows[0] ? rowToDto(result.rows[0]) : null;
}

export async function deleteSupplierDef(client: PoolClient, siteId: number, supplierCode: string) {
  const result = await client.query(
    `UPDATE wms_suppliers SET is_active = false, updated_at = now()
     WHERE site_id = $1 AND upper(supplier_code) = $2`,
    [siteId, supplierCode.toUpperCase()]
  );
  return (result.rowCount ?? 0) > 0;
}
