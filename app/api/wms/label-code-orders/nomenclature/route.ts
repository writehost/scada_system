import { NextRequest, NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Что можно заказать: только позиции с GTIN — без него СУЗ не примет заказ.
 * Берём штрихкоды типа `gtin`, а также GTIN из атрибутов номенклатуры (там он
 * лежит у позиций, заведённых из ЧЗ), и приклеиваем дату последнего заказа —
 * оператору проще выбрать то, что уже печатали.
 */
const SQL = `
WITH gtins AS (
  SELECT i.item_id, i.item_code, i.name, i.short_name, i.item_group_code, i.is_marked,
         COALESCE(
           NULLIF(i.item_attrs_json->'nomenclature'->>'productGroupCz', ''),
           NULLIF(i.item_attrs_json->'nomenclature'->>'czProductGroup', ''),
           NULLIF(i.item_attrs_json->'nomenclature'->>'productGroup', ''),
           NULLIF(i.item_attrs_json->>'productGroup', '')
         ) AS product_group,
         COALESCE(
           NULLIF(regexp_replace(COALESCE(b.barcode, ''), '\\D', '', 'g'), ''),
           NULLIF(regexp_replace(COALESCE(i.item_attrs_json->'nomenclature'->>'gtin', ''), '\\D', '', 'g'), ''),
           NULLIF(regexp_replace(COALESCE(i.item_attrs_json->>'gtin', ''), '\\D', '', 'g'), ''),
           NULLIF(regexp_replace(COALESCE(i.item_attrs_json->>'internalGtin', ''), '\\D', '', 'g'), '')
         ) AS gtin,
         COALESCE(i.item_attrs_json->'nomenclature'->>'stickerPrintKind', '') AS sticker_kind
  FROM wms_items i
  LEFT JOIN wms_item_barcodes b
    ON b.item_id = i.item_id AND b.barcode_type = 'gtin'
  WHERE i.site_id = $1 AND i.is_active
),
ranked AS (
  SELECT g.*,
         lpad(g.gtin, 14, '0') AS gtin14,
         (g.name ILIKE 'Стикер%') AS is_sticker_item,
         row_number() OVER (
           PARTITION BY lpad(g.gtin, 14, '0')
           ORDER BY (g.name ILIKE 'Стикер%'), g.is_marked DESC, length(g.name) DESC
         ) AS rn
  FROM gtins g
  WHERE g.gtin IS NOT NULL AND length(g.gtin) BETWEEN 8 AND 14
),
last_orders AS (
  SELECT lpad(regexp_replace(COALESCE(gtin, ''), '\\D', '', 'g'), 14, '0') AS gtin14,
         max(created_at) AS last_at,
         count(*)::int AS orders_count
  FROM wms_label_order_docs
  WHERE site_id = $1
  GROUP BY 1
)
SELECT r.item_code AS "itemCode",
       -- «Стикер …» — служебный префикс позиций, созданных под печать; в заказе нужно имя продукта
       COALESCE(
         NULLIF(regexp_replace(COALESCE(r.name, ''), '^(стикер[ы]?\\s+)+', '', 'gi'), ''),
         r.item_code
       ) AS name,
       r.gtin14 AS gtin,
       r.item_group_code AS "itemGroupCode",
       r.product_group AS "productGroup",
       r.is_marked AS "isMarked",
       r.is_sticker_item AS "isStickerItem",
       NULLIF(r.sticker_kind, '') AS "stickerKind",
       to_char(lo.last_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS "lastOrderedAt",
       COALESCE(lo.orders_count, 0) AS "ordersCount"
FROM ranked r
LEFT JOIN last_orders lo ON lo.gtin14 = r.gtin14
WHERE r.rn = 1
  AND (
    $2 = ''
    OR r.name ILIKE '%' || $2 || '%'
    OR r.item_code ILIKE '%' || $2 || '%'
    OR r.gtin14 LIKE '%' || regexp_replace($2, '\\D', '', 'g') || '%'
  )
ORDER BY lo.last_at DESC NULLS LAST, r.name
LIMIT $3
`

export async function GET(req: NextRequest) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json(
      { ok: false, error: "База WMS не настроена (DATABASE_URL)" },
      { status: 503 }
    )
  }
  const siteCode = (req.nextUrl.searchParams.get("siteCode") || "DEFAULT").trim() || "DEFAULT"
  const rawQuery = (req.nextUrl.searchParams.get("query") ?? "").trim()
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "60") || 60))

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({ ok: false, error: "Неизвестный склад" }, { status: 404 })
    }
    // Таблица документов может ещё не существовать на свежей базе — не роняем подбор.
    await client.query(`
      CREATE TABLE IF NOT EXISTS wms_label_order_docs (
        site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
        order_id TEXT NOT NULL,
        doc_no TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        author_login TEXT,
        author_fio TEXT,
        author_position TEXT,
        origin TEXT NOT NULL DEFAULT 'unknown',
        origin_detail TEXT,
        gtin TEXT,
        item_code TEXT,
        nomenclature_name TEXT,
        sticker_type TEXT,
        quantity NUMERIC NOT NULL DEFAULT 0,
        planned_waste_qty NUMERIC NOT NULL DEFAULT 0,
        waste_percent NUMERIC NOT NULL DEFAULT 0,
        comment TEXT,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (site_id, order_id)
      )`)
    const r = await client.query(SQL, [siteId, rawQuery, limit])
    return NextResponse.json({ ok: true, items: r.rows })
  } catch (e) {
    console.error("[GET /api/wms/label-code-orders/nomenclature]", e)
    const message = e instanceof Error ? e.message : "internal error"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  } finally {
    client.release()
  }
}
