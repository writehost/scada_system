import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import {
  CRPT_PRODUCT_GROUP_LABELS,
  normalizeCrptProductGroupCode,
  suggestItemGroupDisplayName,
} from "@/lib/wms/crpt-product-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: { siteCode?: string };
  try {
    body = (await req.json()) as { siteCode?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = String(body.siteCode ?? "").trim();
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const rawCodes = await client.query<{ code: string; source: string }>(
      `SELECT DISTINCT btrim(item_group_code) AS code, 'item_group_code' AS source
       FROM wms_items
       WHERE site_id = $1 AND btrim(COALESCE(item_group_code, '')) <> ''
       UNION
       SELECT DISTINCT btrim(product_group) AS code, 'product_group' AS source
       FROM wms_items
       WHERE site_id = $1 AND btrim(COALESCE(product_group, '')) <> ''`,
      [siteId]
    );

    let inserted = 0;
    let updated = 0;
    const seenCanonical = new Set<string>();

    for (const row of rawCodes.rows) {
      const raw = row.code.trim();
      if (!raw) continue;

      const canonical = normalizeCrptProductGroupCode(raw);
      if (!canonical) continue;

      const canonicalKey = canonical.toLowerCase();
      if (seenCanonical.has(canonicalKey)) continue;
      seenCanonical.add(canonicalKey);

      const displayName = suggestItemGroupDisplayName(raw, canonical);

      const ins = await client.query(
        `INSERT INTO wms_item_groups (site_id, group_code, name, sort_order, is_active, updated_at)
         VALUES ($1, $2, $3, 100, TRUE, now())
         ON CONFLICT (site_id, group_code) DO UPDATE SET
           name = CASE
             WHEN EXCLUDED.name ~ '[а-яё]' AND COALESCE(wms_item_groups.name, '') !~ '[а-яё]' THEN EXCLUDED.name
             WHEN COALESCE(wms_item_groups.name, '') ~ '[а-яё]' THEN wms_item_groups.name
             WHEN COALESCE(wms_item_groups.name, '') = '' THEN EXCLUDED.name
             ELSE wms_item_groups.name
           END,
           is_active = TRUE,
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [siteId, canonical, displayName]
      );

      if (ins.rows[0]?.inserted) inserted += 1;
      else updated += 1;

      if (raw !== canonical) {
        await client.query(
          `UPDATE wms_items
           SET item_group_code = $3,
               product_group = $3,
               updated_at = now()
           WHERE site_id = $1
             AND (item_group_code = $2 OR product_group = $2)`,
          [siteId, raw, canonical]
        );
      }
    }

    return NextResponse.json({
      ok: true,
      insertedFromItemGroupCode: inserted,
      insertedFromProductGroup: updated,
      note: "Коды приведены к каноническому виду (autofluids, probs). Русские дубли сливаются кнопкой «Объединить дубли».",
    });
  } catch (e) {
    return NextResponse.json(
      { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
