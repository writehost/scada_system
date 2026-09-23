import assert from "node:assert/strict"
import test from "node:test"

import { canFinishOperation, operationPhase } from "../lib/wms/yms/loading-gate.ts"
import { decidePalletScan } from "../lib/wms/yms/pallet-scan.ts"
import { hitchPose, headingBetween } from "../lib/wms/yms/rig.ts"
import { routeBetween } from "../lib/wms/yms/yard-route.ts"
import { resolveTransition } from "../lib/wms/yms/state-machine.ts"

const pallet = (code, status = "planned") => ({ code, loadUnitId: "1", status, qty: 1 })

test("scan rejects a pallet that is not on the WMS order", () => {
  const result = decidePalletScan({
    code: "PAL-99",
    pallets: [pallet("PAL-01"), pallet("PAL-02")],
    acceptedCodes: [],
    acceptedElsewhere: false,
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, "wrong_pallet")
})

test("scan rejects a repeated code and a second visit", () => {
  const duplicate = decidePalletScan({
    code: "pal-01",
    pallets: [pallet("PAL-01")],
    acceptedCodes: ["PAL-01"],
    acceptedElsewhere: false,
  })
  assert.equal(duplicate.ok, false)
  if (!duplicate.ok) assert.equal(duplicate.code, "duplicate_scan")

  const other = decidePalletScan({
    code: "PAL-01",
    pallets: [pallet("PAL-01")],
    acceptedCodes: [],
    acceptedElsewhere: true,
  })
  assert.equal(other.ok, false)
  if (!other.ok) assert.equal(other.code, "double_ship")
})

test("scan does not invent pallets when WMS has none", () => {
  const result = decidePalletScan({
    code: "PAL-01",
    pallets: [],
    acceptedCodes: [],
    acceptedElsewhere: false,
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, "wms_pallets_missing")
})

test("outbound cannot finish on a dispatcher click alone", () => {
  const blocked = canFinishOperation("OUTBOUND", {
    hasDocument: true,
    plannedQty: 28,
    confirmedQty: 0,
    plannedPallets: 28,
    loadedPallets: 24,
    acknowledgedDiscrepancy: false,
  })
  assert.equal(blocked.ok, false)
  const partial = canFinishOperation("OUTBOUND", {
    hasDocument: true,
    plannedQty: 28,
    confirmedQty: 28,
    plannedPallets: 28,
    loadedPallets: 24,
    acknowledgedDiscrepancy: true,
  })
  assert.equal(partial.ok, true)
  const done = canFinishOperation("OUTBOUND", {
    hasDocument: true,
    plannedQty: 28,
    confirmedQty: 10,
    plannedPallets: 28,
    loadedPallets: 28,
    acknowledgedDiscrepancy: false,
  })
  assert.equal(done.ok, true)
})

test("phase names the loading step in words", () => {
  assert.equal(
    operationPhase({ status: "loading", orderReady: true, loadedPallets: 24, plannedPallets: 28, jobStatus: null }).label,
    "Погрузка"
  )
  assert.equal(
    operationPhase({ status: "loading", orderReady: true, loadedPallets: 28, plannedPallets: 28, jobStatus: null }).label,
    "Погрузка завершена"
  )
  assert.equal(
    operationPhase({ status: "loading", orderReady: true, loadedPallets: 10, plannedPallets: 28, jobStatus: "waiting" }).label,
    "Приостановлено"
  )
})

test("route does not cut through the warehouse", () => {
  const objects = [
    { objectId: "b", kind: "building", x: 0, y: 0, w: 200, h: 80 },
    { objectId: "left", kind: "road", x: 0, y: 100, w: 40, h: 20 },
    { objectId: "right", kind: "road", x: 160, y: 100, w: 40, h: 20 },
    { objectId: "blocked-a", kind: "parking", x: 10, y: 20, w: 20, h: 20 },
    { objectId: "blocked-b", kind: "parking", x: 170, y: 20, w: 20, h: 20 },
  ]
  const through = routeBetween(objects, "blocked-a", "blocked-b")
  assert.equal(through, null)
  const around = routeBetween(objects, "left", "right")
  assert.ok(around && around.length >= 2)
})

test("trailer follows the hitch instead of the cab angle", () => {
  const pose = hitchPose({
    hitch: { x: 100, y: 100 },
    tractorHeading: 0,
    trailerHeading: Math.PI / 2,
    hasTrailer: true,
  })
  assert.ok(pose.trailerCenter)
  assert.ok(Math.abs(pose.tractorCenter.x - 100) > 5)
  assert.ok(Math.abs((pose.trailerCenter?.y ?? 100) - 100) > 5)
  assert.ok(Math.abs((pose.trailerCenter?.x ?? 0) - pose.tractorCenter.x) > 10)
})

test("queue still reaches departure only step by step", () => {
  let status = "expected"
  for (const action of ["arrive", "hold_entry", "allow_entry", "park", "assign_dock", "start_operation", "complete_operation", "release_exit", "depart"]) {
    const next = resolveTransition(status, action, "OUTBOUND")
    assert.equal(next.ok, true, action)
    if (next.ok) status = next.to
  }
  assert.equal(status, "departed")
  assert.equal(Number.isFinite(headingBetween({ x: 0, y: 0 }, { x: 1, y: 0 })), true)
})
