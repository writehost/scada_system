import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { isValidInn } from "./counterparties.ts"
import { WmsUnavailable, wmsClientFor } from "./integrations/wms.ts"

/**
 * Справочник поставщиков WMS не дублируется вслепую: контрагент EDI получает явную ссылку
 * wms_supplier_code. Существующий контрагент с тем же ИНН связывается, новый создаётся
 * только для поставщиков WMS с корректным ИНН. Реквизиты копируются при первой связи.
 */
export async function linkWmsSuppliers(client: PoolClient, actor: Actor) {
  requirePermission(actor, "edi.counterparty.write")
  const wms = await wmsClientFor(client, actor.siteId, actor.siteCode)
  if (!wms) throw new HttpError(409, "Интеграция с WMS не настроена", "wms_not_configured")
  let suppliers
  try {
    suppliers = await wms.suppliers()
  } catch (e) {
    if (e instanceof WmsUnavailable) throw new HttpError(502, e.message, "wms_unavailable")
    throw e
  }
  let linked = 0
  let created = 0
  let skipped = 0
  for (const s of suppliers.filter((x) => x.isActive)) {
    const inn = (s.taxId ?? "").replace(/\D/g, "")
    const already = await client.query(`SELECT 1 FROM edi_counterparties WHERE site_id = $1 AND upper(wms_supplier_code) = upper($2)`, [actor.siteId, s.code])
    if (already.rows[0]) continue
    if (!isValidInn(inn)) {
      skipped++
      continue
    }
    const kpp = s.meta.kpp?.trim() || null
    const existing = await client.query<{ counterparty_id: string }>(
      `SELECT counterparty_id::text FROM edi_counterparties WHERE site_id = $1 AND inn = $2 AND COALESCE(kpp,'') = COALESCE($3,'') AND wms_supplier_code IS NULL LIMIT 1`,
      [actor.siteId, inn, kpp]
    )
    if (existing.rows[0]) {
      await client.query(
        `UPDATE edi_counterparties SET wms_supplier_code = $2, roles = (SELECT array_agg(DISTINCT r) FROM unnest(roles || '{supplier}') r), updated_at = now()
         WHERE counterparty_id = $1::bigint`,
        [existing.rows[0].counterparty_id, s.code.toUpperCase()]
      )
      linked++
      continue
    }
    const m = s.meta
    await client.query(
      `INSERT INTO edi_counterparties (site_id, kind, name, short_name, inn, kpp, ogrn, address_legal, address_actual, phone, email, contact_person,
         bank_name, bank_bik, bank_account, corr_account, roles, wms_supplier_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, '{supplier}', $17, $18::bigint)`,
      [
        actor.siteId, inn.length === 12 ? "ip" : "legal", m.legalName?.trim() || s.name, s.name, inn, kpp, m.ogrn?.trim() || null,
        m.addresses?.legal?.trim() || null, m.addresses?.actual?.trim() || m.addresses?.delivery?.trim() || null, m.phone?.trim() || null,
        m.email?.trim() || null, m.contactPerson?.trim() || null, m.bankName?.trim() || null, m.bankBik?.trim() || null,
        m.bankAccount?.trim() || null, m.corrAccount?.trim() || null, s.code.toUpperCase(), actor.userId,
      ]
    )
    created++
  }
  await recordEvent(client, actorEvent(actor, "counterparty.updated", null, { source: "wms", linked, created, skipped }))
  return { total: suppliers.length, linked, created, skipped }
}
