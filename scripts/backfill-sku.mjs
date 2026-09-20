/* eslint-disable no-console */

/**
 * Заполняет SKU для позиций, где sku пустой.
 *
 * Алгоритм:
 * - Из `nomenclature` (если там есть GS1/ЧЗ строка) вытаскиваем AI(01) + GTIN-14.
 * - SKU делаем детерминированным и читаемым: `<prefix11>-<rest3>` (пример: 04607138960662 → 04607138960-662)
 *
 * Запуск:
 * - dry-run: `npm run sku:backfill -- --dry-run --limit=50`
 * - apply:   `npm run sku:backfill -- --limit=50`
 */

function extractGtin14FromGs1Like(raw) {
  const m = String(raw || "").match(/01(\d{14})/)
  return (m && m[1]) || null
}

function skuFromGtin14(gtin14) {
  const g = String(gtin14 || "").trim()
  if (!/^\d{14}$/.test(g)) throw new Error(`bad gtin14: ${gtin14}`)
  return `${g.slice(0, 11)}-${g.slice(11)}`
}

async function getJson(url) {
  const r = await fetch(url, { cache: "no-store" })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`)
  return data
}

async function patchJson(url, body) {
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`)
  return data
}

function getSiteCode() {
  // скрипт запускается вне браузера
  return process.env.WMS_SITE_CODE || "DEFAULT"
}

function getBaseUrl() {
  return process.env.WMS_BASE_URL || "http://localhost:3000"
}

function parseArgs(argv) {
  const out = { dryRun: false, limit: Infinity }
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true
    if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length))
      if (Number.isFinite(n)) out.limit = Math.max(0, Math.trunc(n))
    }
  }
  return out
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv.slice(2))
  const baseUrl = getBaseUrl()
  const siteCode = getSiteCode()

  console.log(JSON.stringify({ action: "backfill-sku", dryRun, limit: Number.isFinite(limit) ? limit : null, baseUrl, siteCode }, null, 2))

  let cursor = undefined
  let scanned = 0
  let updated = 0
  let skipped = 0

  while (updated < limit) {
    const qp = new URLSearchParams()
    qp.set("siteCode", siteCode)
    qp.set("limit", "100")
    if (cursor) qp.set("cursor", cursor)
    const page = await getJson(`${baseUrl}/api/wms/items?${qp.toString()}`)
    const items = page.items || []
    if (items.length === 0) break

    for (const row of items) {
      scanned += 1
      const sku = row?.sku
      if (typeof sku === "string" && sku.trim()) {
        skipped += 1
        continue
      }
      const nom = row?.nomenclature
      const gtin14 = extractGtin14FromGs1Like(nom)
      if (!gtin14) {
        skipped += 1
        continue
      }
      const nextSku = skuFromGtin14(gtin14)

      if (dryRun) {
        console.log(JSON.stringify({ itemCode: row.itemCode, sku: nextSku, source: `nomenclature:01${gtin14}` }))
        updated += 1
        if (updated >= limit) break
        continue
      }

      await patchJson(`${baseUrl}/api/wms/items/${encodeURIComponent(row.itemCode)}`, {
        siteCode,
        sku: nextSku,
      })
      console.log(JSON.stringify({ ok: true, itemCode: row.itemCode, sku: nextSku, source: `nomenclature:01${gtin14}` }))
      updated += 1
      if (updated >= limit) break
    }

    cursor = page.nextCursor
    if (!cursor) break
  }

  console.log(JSON.stringify({ done: true, scanned, updated, skipped }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

