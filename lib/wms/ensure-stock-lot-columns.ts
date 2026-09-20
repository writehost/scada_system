import type { PoolClient } from "pg";

let ensured = false;

/** Idempotent: колонки для выдачи в цех (in_production на партиях, lot_id на движениях). */
export async function ensureWmsStockLotColumns(client: PoolClient): Promise<void> {
  if (ensured) return;
  await client.query(`
    ALTER TABLE wms_stock_lots
      ADD COLUMN IF NOT EXISTS in_production_qty NUMERIC(18,3) NOT NULL DEFAULT 0
  `);
  await client.query(`
    ALTER TABLE wms_stock_lots
      ADD COLUMN IF NOT EXISTS in_transit_qty NUMERIC(18,3) NOT NULL DEFAULT 0
  `);
  await client.query(`
    ALTER TABLE wms_stock_lots
      ADD COLUMN IF NOT EXISTS lot_id BIGINT NULL REFERENCES wms_lots(lot_id)
  `);
  await client.query(`
    ALTER TABLE wms_stock_movements
      ADD COLUMN IF NOT EXISTS lot_id BIGINT NULL REFERENCES wms_lots(lot_id)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_operator_issues (
      issue_id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL UNIQUE REFERENCES wms_documents(document_id) ON DELETE CASCADE,
      recipient_name TEXT NOT NULL,
      line_name TEXT NULL,
      issued_by_user_id BIGINT NULL REFERENCES wms_users(user_id),
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  ensured = true;
}
