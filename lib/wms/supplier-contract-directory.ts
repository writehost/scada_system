import type { PoolClient } from "pg";
import {
  contractCodeFromName,
  mergeContractMeta,
  normalizeContractCode,
  normalizeContractInput,
  type SupplierContractExternalSource,
  type SupplierContractMeta,
  type SupplierContractRow,
  type SupplierContractType,
} from "@/lib/wms/supplier-contract-meta";

export type { SupplierContractRow } from "@/lib/wms/supplier-contract-meta";

const CONTRACT_SELECT = `SELECT c.contract_id::text, s.supplier_code, c.contract_code, c.contract_number, c.name,
  c.contract_type, c.valid_from::text, c.valid_to::text, c.currency, c.is_default, c.is_active,
  c.external_source, c.external_id,
  COALESCE(c.external_ref_json, '{}'::jsonb) AS external_ref_json,
  COALESCE(c.meta_json, '{}'::jsonb) AS meta_json,
  c.note, c.created_at::text, c.updated_at::text
 FROM wms_supplier_contracts c
 JOIN wms_suppliers s ON s.site_id = c.site_id AND s.supplier_id = c.supplier_id`;

function rowToDto(r: {
  contract_id: string;
  supplier_code: string;
  contract_code: string;
  contract_number: string | null;
  name: string;
  contract_type: string;
  valid_from: string | null;
  valid_to: string | null;
  currency: string | null;
  is_default: boolean;
  is_active: boolean;
  external_source: string;
  external_id: string | null;
  external_ref_json: unknown;
  meta_json: unknown;
  note: string | null;
  created_at: string;
  updated_at: string;
}): SupplierContractRow {
  return {
    contractId: r.contract_id,
    supplierCode: r.supplier_code,
    code: r.contract_code,
    number: r.contract_number,
    name: r.name,
    contractType: r.contract_type as SupplierContractType,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    currency: r.currency,
    isDefault: r.is_default,
    isActive: r.is_active,
    externalSource: r.external_source as SupplierContractExternalSource,
    externalId: r.external_id,
    externalRef: (r.external_ref_json ?? {}) as SupplierContractMeta,
    meta: (r.meta_json ?? {}) as SupplierContractMeta,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function getSupplierId(
  client: PoolClient,
  siteId: number,
  supplierCode: string
): Promise<number | null> {
  const r = await client.query<{ supplier_id: string }>(
    `SELECT supplier_id FROM wms_suppliers
     WHERE site_id = $1 AND upper(supplier_code) = $2`,
    [siteId, supplierCode.toUpperCase()]
  );
  return r.rows[0] ? Number(r.rows[0].supplier_id) : null;
}

async function clearDefaultContract(
  client: PoolClient,
  siteId: number,
  supplierId: number,
  exceptContractId?: number
) {
  await client.query(
    `UPDATE wms_supplier_contracts
     SET is_default = false, updated_at = now()
     WHERE site_id = $1 AND supplier_id = $2
       AND ($3::bigint IS NULL OR contract_id <> $3)`,
    [siteId, supplierId, exceptContractId ?? null]
  );
}

export async function listSupplierContracts(
  client: PoolClient,
  siteId: number,
  supplierCode: string,
  opts?: { activeOnly?: boolean }
): Promise<SupplierContractRow[]> {
  const supplierId = await getSupplierId(client, siteId, supplierCode);
  if (supplierId == null) return [];
  const activeOnly = opts?.activeOnly ?? false;
  const result = await client.query<{
    contract_id: string;
    supplier_code: string;
    contract_code: string;
    contract_number: string | null;
    name: string;
    contract_type: string;
    valid_from: string | null;
    valid_to: string | null;
    currency: string | null;
    is_default: boolean;
    is_active: boolean;
    external_source: string;
    external_id: string | null;
    external_ref_json: unknown;
    meta_json: unknown;
    note: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `${CONTRACT_SELECT}
     WHERE c.site_id = $1 AND c.supplier_id = $2
       AND ($3::boolean = false OR c.is_active = true)
     ORDER BY c.is_default DESC, c.is_active DESC, c.valid_from DESC NULLS LAST, c.name ASC`,
    [siteId, supplierId, activeOnly]
  );
  return result.rows.map(rowToDto);
}

export async function createSupplierContract(
  client: PoolClient,
  siteId: number,
  supplierCode: string,
  input: Parameters<typeof normalizeContractInput>[0]
) {
  const supplierId = await getSupplierId(client, siteId, supplierCode);
  if (supplierId == null) throw new Error("supplier not found");

  const normalized = normalizeContractInput({ ...input, supplierCode });
  if (normalized.isDefault) {
    await clearDefaultContract(client, siteId, supplierId);
  }

  const result = await client.query<{
    contract_id: string;
    supplier_code: string;
    contract_code: string;
    contract_number: string | null;
    name: string;
    contract_type: string;
    valid_from: string | null;
    valid_to: string | null;
    currency: string | null;
    is_default: boolean;
    is_active: boolean;
    external_source: string;
    external_id: string | null;
    external_ref_json: unknown;
    meta_json: unknown;
    note: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO wms_supplier_contracts (
       site_id, supplier_id, contract_code, contract_number, name, contract_type,
       valid_from, valid_to, currency, is_default, is_active,
       external_source, external_id, external_ref_json, meta_json, note
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::date, $8::date, $9, $10, $11,
       $12, $13, $14::jsonb, $15::jsonb, $16
     )
     RETURNING contract_id::text, $17 AS supplier_code, contract_code, contract_number, name,
       contract_type, valid_from::text, valid_to::text, currency, is_default, is_active,
       external_source, external_id,
       COALESCE(external_ref_json, '{}'::jsonb) AS external_ref_json,
       COALESCE(meta_json, '{}'::jsonb) AS meta_json,
       note, created_at::text, updated_at::text`,
    [
      siteId,
      supplierId,
      normalized.code,
      normalized.number,
      normalized.name,
      normalized.contractType,
      normalized.validFrom,
      normalized.validTo,
      normalized.currency,
      normalized.isDefault,
      normalized.isActive,
      normalized.externalSource,
      normalized.externalId,
      JSON.stringify(normalized.externalRef),
      JSON.stringify(normalized.meta),
      normalized.note,
      supplierCode.toUpperCase(),
    ]
  );
  return rowToDto(result.rows[0]);
}

export async function patchSupplierContract(
  client: PoolClient,
  siteId: number,
  contractCode: string,
  patch: Partial<{
    number: string | null;
    name: string;
    contractType: string;
    validFrom: string | null;
    validTo: string | null;
    currency: string | null;
    isDefault: boolean;
    isActive: boolean;
    externalSource: string;
    externalId: string | null;
    externalRef: SupplierContractMeta;
    meta: SupplierContractMeta;
    note: string | null;
  }>
) {
  const existing = await client.query<{
    contract_id: string;
    supplier_id: string;
    meta_json: unknown;
    external_ref_json: unknown;
  }>(
    `SELECT contract_id::text, supplier_id::text,
       COALESCE(meta_json, '{}'::jsonb) AS meta_json,
       COALESCE(external_ref_json, '{}'::jsonb) AS external_ref_json
     FROM wms_supplier_contracts
     WHERE site_id = $1 AND upper(contract_code) = $2`,
    [siteId, contractCode.toUpperCase()]
  );
  if (!existing.rows[0]) return null;

  const supplierId = Number(existing.rows[0].supplier_id);
  const contractId = Number(existing.rows[0].contract_id);

  if (patch.isDefault === true) {
    await clearDefaultContract(client, siteId, supplierId, contractId);
  }

  const fields: string[] = [];
  const values: unknown[] = [siteId, contractCode.toUpperCase()];
  let idx = 3;

  if (typeof patch.name === "string" && patch.name.trim()) {
    fields.push(`name = $${idx++}`);
    values.push(patch.name.trim());
  }
  if (patch.number !== undefined) {
    fields.push(`contract_number = $${idx++}`);
    values.push(patch.number?.trim() || null);
  }
  if (patch.contractType !== undefined) {
    fields.push(`contract_type = $${idx++}`);
    values.push(normalizeContractInput({ name: "x", contractType: patch.contractType }).contractType);
  }
  if (patch.validFrom !== undefined) {
    fields.push(`valid_from = $${idx++}::date`);
    values.push(normalizeContractInput({ name: "x", validFrom: patch.validFrom }).validFrom);
  }
  if (patch.validTo !== undefined) {
    fields.push(`valid_to = $${idx++}::date`);
    values.push(normalizeContractInput({ name: "x", validTo: patch.validTo }).validTo);
  }
  if (patch.currency !== undefined) {
    fields.push(`currency = $${idx++}`);
    values.push(patch.currency?.trim() || "RUB");
  }
  if (typeof patch.isDefault === "boolean") {
    fields.push(`is_default = $${idx++}`);
    values.push(patch.isDefault);
  }
  if (typeof patch.isActive === "boolean") {
    fields.push(`is_active = $${idx++}`);
    values.push(patch.isActive);
  }
  if (patch.externalSource !== undefined) {
    fields.push(`external_source = $${idx++}`);
    values.push(normalizeContractInput({ name: "x", externalSource: patch.externalSource }).externalSource);
  }
  if (patch.externalId !== undefined) {
    fields.push(`external_id = $${idx++}`);
    values.push(patch.externalId?.trim() || null);
  }
  if (patch.externalRef !== undefined) {
    const merged = mergeContractMeta(
      existing.rows[0].external_ref_json as SupplierContractMeta,
      patch.externalRef
    );
    fields.push(`external_ref_json = $${idx++}::jsonb`);
    values.push(JSON.stringify(merged));
  }
  if (patch.meta !== undefined) {
    const merged = mergeContractMeta(existing.rows[0].meta_json as SupplierContractMeta, patch.meta);
    fields.push(`meta_json = $${idx++}::jsonb`);
    values.push(JSON.stringify(merged));
  }
  if (patch.note !== undefined) {
    fields.push(`note = $${idx++}`);
    values.push(patch.note?.trim() || null);
  }
  if (fields.length === 0) return null;

  fields.push("updated_at = now()");

  const result = await client.query<{
    contract_id: string;
    supplier_code: string;
    contract_code: string;
    contract_number: string | null;
    name: string;
    contract_type: string;
    valid_from: string | null;
    valid_to: string | null;
    currency: string | null;
    is_default: boolean;
    is_active: boolean;
    external_source: string;
    external_id: string | null;
    external_ref_json: unknown;
    meta_json: unknown;
    note: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE wms_supplier_contracts c
     SET ${fields.join(", ")}
     FROM wms_suppliers s
     WHERE c.site_id = $1 AND upper(c.contract_code) = $2
       AND s.site_id = c.site_id AND s.supplier_id = c.supplier_id
     RETURNING c.contract_id::text, s.supplier_code, c.contract_code, c.contract_number, c.name,
       c.contract_type, c.valid_from::text, c.valid_to::text, c.currency, c.is_default, c.is_active,
       c.external_source, c.external_id,
       COALESCE(c.external_ref_json, '{}'::jsonb) AS external_ref_json,
       COALESCE(c.meta_json, '{}'::jsonb) AS meta_json,
       c.note, c.created_at::text, c.updated_at::text`,
    values
  );
  return result.rows[0] ? rowToDto(result.rows[0]) : null;
}

export async function deleteSupplierContract(
  client: PoolClient,
  siteId: number,
  contractCode: string
) {
  const result = await client.query(
    `UPDATE wms_supplier_contracts
     SET is_active = false, is_default = false, updated_at = now()
     WHERE site_id = $1 AND upper(contract_code) = $2`,
    [siteId, contractCode.toUpperCase()]
  );
  return (result.rowCount ?? 0) > 0;
}

export type ExternalContractUpsertInput = {
  externalId: string;
  externalSource?: string;
  code?: string;
  number?: string | null;
  name?: string;
  contractType?: string;
  validFrom?: string | null;
  validTo?: string | null;
  currency?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  externalRef?: SupplierContractMeta;
  meta?: SupplierContractMeta;
  note?: string | null;
};

export async function upsertExternalSupplierContracts(
  client: PoolClient,
  siteId: number,
  supplierCode: string,
  contracts: ExternalContractUpsertInput[]
) {
  const supplierId = await getSupplierId(client, siteId, supplierCode);
  if (supplierId == null) throw new Error("supplier not found");

  const results: SupplierContractRow[] = [];
  for (const item of contracts) {
    const externalId = item.externalId?.trim();
    if (!externalId) continue;

    const externalSource = normalizeContractInput({
      name: item.name || externalId,
      externalSource: item.externalSource || "1c",
    }).externalSource;

    const existing = await client.query<{ contract_code: string }>(
      `SELECT contract_code FROM wms_supplier_contracts
       WHERE site_id = $1 AND external_source = $2 AND external_id = $3`,
      [siteId, externalSource, externalId]
    );

    if (existing.rows[0]) {
      const updated = await patchSupplierContract(client, siteId, existing.rows[0].contract_code, {
        number: item.number,
        name: item.name,
        contractType: item.contractType,
        validFrom: item.validFrom,
        validTo: item.validTo,
        currency: item.currency,
        isDefault: item.isDefault,
        isActive: item.isActive !== false,
        externalSource,
        externalId,
        externalRef: item.externalRef,
        meta: item.meta,
        note: item.note,
      });
      if (updated) results.push(updated);
      continue;
    }

    const normalized = normalizeContractInput({
      ...item,
      supplierCode,
      name: item.name || item.number || externalId,
      code: item.code || contractCodeFromName(item.number || item.name || externalId, supplierCode),
      externalSource,
      externalId,
    });

    if (normalized.isDefault) {
      await clearDefaultContract(client, siteId, supplierId);
    }

    const inserted = await client.query<{
      contract_id: string;
      supplier_code: string;
      contract_code: string;
      contract_number: string | null;
      name: string;
      contract_type: string;
      valid_from: string | null;
      valid_to: string | null;
      currency: string | null;
      is_default: boolean;
      is_active: boolean;
      external_source: string;
      external_id: string | null;
      external_ref_json: unknown;
      meta_json: unknown;
      note: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO wms_supplier_contracts (
         site_id, supplier_id, contract_code, contract_number, name, contract_type,
         valid_from, valid_to, currency, is_default, is_active,
         external_source, external_id, external_ref_json, meta_json, note
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::date, $8::date, $9, $10, $11,
         $12, $13, $14::jsonb, $15::jsonb, $16
       )
       RETURNING contract_id::text, $17 AS supplier_code, contract_code, contract_number, name,
         contract_type, valid_from::text, valid_to::text, currency, is_default, is_active,
         external_source, external_id,
         COALESCE(external_ref_json, '{}'::jsonb) AS external_ref_json,
         COALESCE(meta_json, '{}'::jsonb) AS meta_json,
         note, created_at::text, updated_at::text`,
      [
        siteId,
        supplierId,
        normalized.code,
        normalized.number,
        normalized.name,
        normalized.contractType,
        normalized.validFrom,
        normalized.validTo,
        normalized.currency,
        normalized.isDefault,
        normalized.isActive,
        normalized.externalSource,
        normalized.externalId,
        JSON.stringify(normalized.externalRef),
        JSON.stringify(normalized.meta),
        normalized.note,
        supplierCode.toUpperCase(),
      ]
    );
    results.push(rowToDto(inserted.rows[0]));
  }
  return results;
}

export async function getSupplierContractSummaries(
  client: PoolClient,
  siteId: number
): Promise<Record<string, { count: number; defaultNumber: string | null }>> {
  const result = await client.query<{
    supplier_code: string;
    count: string;
    default_number: string | null;
  }>(
    `SELECT s.supplier_code,
       COUNT(c.contract_id)::text AS count,
       MAX(c.contract_number) FILTER (WHERE c.is_default AND c.is_active) AS default_number
     FROM wms_suppliers s
     LEFT JOIN wms_supplier_contracts c
       ON c.site_id = s.site_id AND c.supplier_id = s.supplier_id AND c.is_active = true
     WHERE s.site_id = $1
     GROUP BY s.supplier_code`,
    [siteId]
  );
  const map: Record<string, { count: number; defaultNumber: string | null }> = {};
  for (const row of result.rows) {
    map[row.supplier_code.toUpperCase()] = {
      count: Number(row.count) || 0,
      defaultNumber: row.default_number,
    };
  }
  return map;
}
