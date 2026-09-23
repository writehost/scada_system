import assert from "node:assert/strict"
import test from "node:test"

import { canFinishOperation } from "../lib/wms/yms/loading-gate.ts"
import {
  allowedActions,
  resolveTransition,
} from "../lib/wms/yms/state-machine.ts"

test("outbound visit walks the legal queue", () => {
  let status = "expected"
  const steps = [
    "arrive",
    "hold_entry",
    "allow_entry",
    "park",
    "wait_dock",
    "assign_dock",
    "start_operation",
    "complete_operation",
    "release_exit",
    "depart",
  ]
  const seen = []
  for (const action of steps) {
    const next = resolveTransition(status, action, "OUTBOUND")
    assert.equal(next.ok, true, action)
    if (next.ok) {
      seen.push(next.to)
      status = next.to
    }
  }
  assert.deepEqual(seen.at(-1), "departed")
  assert.equal(resolveTransition("departed", "cancel", "OUTBOUND").ok, false)
})

test("operator cannot jump from the gate straight to loading", () => {
  const jump = resolveTransition("at_gate", "start_operation", "OUTBOUND")
  assert.equal(jump.ok, false)
  assert.equal(allowedActions("expected", "INBOUND").includes("assign_dock"), false)
})

test("inbound operation unloads, outbound loads", () => {
  const inbound = resolveTransition("to_dock", "start_operation", "INBOUND")
  const outbound = resolveTransition("to_dock", "start_operation", "OUTBOUND")
  assert.equal(inbound.ok && inbound.to, "unloading")
  assert.equal(outbound.ok && outbound.to, "loading")
})

test("outbound finish waits for warehouse confirmation", () => {
  const blocked = canFinishOperation("OUTBOUND", {
    hasDocument: true,
    plannedQty: 28,
    confirmedQty: 24,
    palletCount: 28,
    openTaskCount: 1,
    acknowledgedDiscrepancy: false,
  })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.equal(blocked.code, "wms_shortfall")

  const acknowledged = canFinishOperation("OUTBOUND", {
    hasDocument: true,
    plannedQty: 28,
    confirmedQty: 24,
    palletCount: 28,
    openTaskCount: 0,
    acknowledgedDiscrepancy: true,
  })
  assert.equal(acknowledged.ok, true)

  const ready = canFinishOperation("OUTBOUND", {
    hasDocument: true,
    plannedQty: 28,
    confirmedQty: 28,
    palletCount: 28,
    openTaskCount: 0,
    acknowledgedDiscrepancy: false,
  })
  assert.equal(ready.ok, true)
})

test("inbound unload does not require a shipping order", () => {
  const result = canFinishOperation("INBOUND", {
    hasDocument: false,
    plannedQty: 0,
    confirmedQty: 0,
    palletCount: 0,
    openTaskCount: 0,
    acknowledgedDiscrepancy: false,
  })
  assert.equal(result.ok, true)
})

test("cancel is refused after departure", () => {
  assert.equal(resolveTransition("departed", "cancel", "RETURN").ok, false)
  assert.equal(resolveTransition("expected", "no_show", "RETURN").ok, true)
  assert.equal(resolveTransition("on_yard", "no_show", "RETURN").ok, false)
})
