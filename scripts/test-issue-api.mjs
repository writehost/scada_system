import assert from "node:assert/strict"
import test from "node:test"

const base = (process.env.WMS_TEST_BASE_URL || "https://scada25.ru").replace(/\/$/, "")
const siteCode = process.env.WMS_TEST_SITE_CODE || "DEFAULT"

async function json(path, init) {
  const response = await fetch(`${base}${path}`, init)
  const contentType = response.headers.get("content-type") || ""
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { _raw: await response.text().catch(() => "") }
  return { response, body }
}

test("WMS health responds", async () => {
  const { response, body } = await json("/api/wms/health")
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.ok, true)
})

test("issue fefo-pick returns JSON (not HTML 404)", async () => {
  const qp = new URLSearchParams({ siteCode, itemCode: "04607017162248" })
  const { response, body } = await json(`/api/wms/stock/fefo-pick?${qp}`)
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.ok("recommendation" in body)
})

test("issue pos-pick returns pick plan", async () => {
  const qp = new URLSearchParams({ siteCode, itemCode: "04607017162248", qty: "1" })
  const { response, body } = await json(`/api/wms/stock/pos-pick?${qp}`)
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.ok(Array.isArray(body.plan))
})

test("location detail exposes stock for bidirectional issue UI", async (t) => {
  const itemsQuery = new URLSearchParams({ siteCode, limit: "5", stockOnly: "1" })
  const itemsRes = await json(`/api/wms/items?${itemsQuery}`)
  assert.equal(itemsRes.response.status, 200, JSON.stringify(itemsRes.body))
  const item = (itemsRes.body.items ?? []).find((row) => (row.availableQty ?? 0) > 0)
  if (!item?.itemCode) {
    t.skip("no stocked item for location smoke test")
    return
  }

  const pickQuery = new URLSearchParams({ siteCode, itemCode: item.itemCode, qty: "1" })
  const pickRes = await json(`/api/wms/stock/pos-pick?${pickQuery}`)
  assert.equal(pickRes.response.status, 200, JSON.stringify(pickRes.body))
  const locationCode = pickRes.body.plan?.find((row) => row.availableQty > 0)?.locationCode
  if (!locationCode) {
    t.skip("pos-pick has no warehouse cell for stocked item")
    return
  }

  const locRes = await json(
    `/api/wms/locations/${encodeURIComponent(locationCode)}?siteCode=${encodeURIComponent(siteCode)}`
  )
  assert.equal(locRes.response.status, 200, JSON.stringify(locRes.body))
  assert.ok(Array.isArray(locRes.body.stock))
  const codes = new Set((locRes.body.stock ?? []).map((row) => row.itemCode))
  assert.ok(codes.has(item.itemCode), `location ${locationCode} should list ${item.itemCode}`)
})
