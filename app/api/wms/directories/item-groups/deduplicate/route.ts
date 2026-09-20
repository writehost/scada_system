import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import {
  CRPT_PRODUCT_GROUP_LABELS,
  hasCyrillicText,
  normalizeCrptProductGroupCode,
} from "@/lib/wms/crpt-product-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupRow = {
  code: string;
  name: string;
  is_active: boolean;
  item_count: number;
};

function resolveCanonicalPair(code: string, name: string): { code: string; name: string } {
  const c = code.trim();
  const n = name.trim();
  const codeIsCyrillic = hasCyrillicText(c);
  const nameIsLatinSlug = n.length > 0 && !hasCyrillicText(n) && /^[a-z0-9_-]+$/i.test(n);

  if (codeIsCyrillic && nameIsLatinSlug) {
    const canonical = normalizeCrptProductGroupCode(n) || n.toLowerCase();
    const displayName = CRPT_PRODUCT_GROUP_LABELS[canonical.toLowerCase()] ?? c;
    return { code: canonical, name: displayName };
  }

  const canonical = normalizeCrptProductGroupCode(c) || c;
  const fromCrpt = CRPT_PRODUCT_GROUP_LABELS[canonical.toLowerCase()];
  const displayName = fromCrpt ?? (hasCyrillicText(n) ? n : hasCyrillicText(c) ? c : n || canonical);
  return { code: canonical, name: displayName };
}

function canonicalKey(code: string, name: string): string {
  return resolveCanonicalPair(code, name).code.toLowerCase();
}

function pickWinner(rows: GroupRow[]): GroupRow {
  return [...rows].sort((a, b) => {
    const aPair = resolveCanonicalPair(a.code, a.name);
    const bPair = resolveCanonicalPair(b.code, b.name);
    const aExact = a.code.toLowerCase() === aPair.code.toLowerCase();
    const bExact = b.code.toLowerCase() === bPair.code.toLowerCase();
    if (aExact !== bExact) return aExact ? -1 : 1;
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    if (b.item_count !== a.item_count) return b.item_count - a.item_count;
    return a.code.localeCompare(b.code);
  })[0]!;
}

async function reassignItems(
  client: PoolClient,
  siteId: number,
  fromCode: string,
  fromName: string,
  toCode: string
) {
  const tokens = [...new Set([fromCode.trim(), fromName.trim()].filter(Boolean))];
  if (tokens.length === 0) return 0;
  const r = await client.query(
    `UPDATE wms_items
     SET item_group_code = $3,
         product_group = $3,
         updated_at = now()
     WHERE site_id = $1
       AND (
         item_group_code = ANY($2::text[])
         OR product_group = ANY($2::text[])
       )
     RETURNING item_id`,
    [siteId, tokens, toCode]
  );
  return r.rowCount ?? 0;
}

async function upsertCanonicalGroup(
  client: PoolClient,
  siteId: number,
  canonical: string,
  displayName: string
) {
  await client.query(
    `INSERT INTO wms_item_groups (site_id, group_code, name, sort_order, is_active, updated_at)
     VALUES ($1, $2, $3, 100, TRUE, now())
     ON CONFLICT (site_id, group_code) DO UPDATE SET
       name = CASE
         WHEN EXCLUDED.name ~ '[а-яё]' AND COALESCE(wms_item_groups.name, '') !~ '[а-яё]' THEN EXCLUDED.name
         WHEN COALESCE(wms_item_groups.name, '') ~ '[а-яё]' THEN wms_item_groups.name
         ELSE EXCLUDED.name
       END,
       is_active = TRUE,
       updated_at = now()`,
    [siteId, canonical, displayName]
  );
}

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

    const loaded = await client.query<GroupRow>(
      `SELECT
         g.group_code AS code,
         g.name,
         COALESCE(g.is_active, TRUE) AS is_active,
         COUNT(i.item_id)::int AS item_count
       FROM wms_item_groups g
       LEFT JOIN wms_items i ON i.site_id = g.site_id AND (
         i.item_group_code = g.group_code OR i.product_group = g.group_code OR btrim(i.product_group) = btrim(g.name)
       )
       WHERE g.site_id = $1
       GROUP BY g.group_code, g.name, g.is_active`,
      [siteId]
    );

    let fixedSwapped = 0;
    let mergedGroups = 0;
    let reassignedItems = 0;
    let removedGroups = 0;

    for (const row of loaded.rows) {
      const pair = resolveCanonicalPair(row.code, row.name);
      if (pair.code.toLowerCase() === row.code.trim().toLowerCase() && pair.name === row.name.trim()) {
        continue;
      }
      await upsertCanonicalGroup(client, siteId, pair.code, pair.name);
      reassignedItems += await reassignItems(client, siteId, row.code, row.name, pair.code);
      if (row.code.trim().toLowerCase() !== pair.code.toLowerCase()) {
        await client.query(`DELETE FROM wms_item_groups WHERE site_id = $1 AND group_code = $2`, [
          siteId,
          row.code,
        ]);
        removedGroups += 1;
      } else {
        await client.query(
          `UPDATE wms_item_groups SET name = $3, updated_at = now() WHERE site_id = $1 AND group_code = $2`,
          [siteId, row.code, pair.name]
        );
      }
      fixedSwapped += 1;
    }

    const reloaded = await client.query<GroupRow>(
      `SELECT
         g.group_code AS code,
         g.name,
         COALESCE(g.is_active, TRUE) AS is_active,
         COUNT(i.item_id)::int AS item_count
       FROM wms_item_groups g
       LEFT JOIN wms_items i ON i.site_id = g.site_id AND (
         i.item_group_code = g.group_code OR i.product_group = g.group_code OR btrim(i.product_group) = btrim(g.name)
       )
       WHERE g.site_id = $1
       GROUP BY g.group_code, g.name, g.is_active`,
      [siteId]
    );

    const buckets = new Map<string, GroupRow[]>();
    for (const row of reloaded.rows) {
      const key = canonicalKey(row.code, row.name);
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }

    for (const [, rows] of buckets) {
      if (rows.length <= 1) continue;
      const winner = pickWinner(rows);
      const pair = resolveCanonicalPair(winner.code, winner.name);
      await upsertCanonicalGroup(client, siteId, pair.code, pair.name);

      for (const loser of rows) {
        if (loser.code.trim().toLowerCase() === pair.code.toLowerCase()) continue;
        reassignedItems += await reassignItems(client, siteId, loser.code, loser.name, pair.code);
        await client.query(`DELETE FROM wms_item_groups WHERE site_id = $1 AND group_code = $2`, [
          siteId,
          loser.code,
        ]);
        removedGroups += 1;
        mergedGroups += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      fixedSwapped,
      mergedGroups,
      removedGroups,
      reassignedItems,
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
