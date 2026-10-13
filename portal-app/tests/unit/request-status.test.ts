import assert from "node:assert/strict"
import test from "node:test"
import { canTransition, manualTargets, validateApproval } from "../../lib/request-status.ts"

test("manual workflow: new → in_review → approved", () => {
  assert.ok(canTransition("new", "in_review"))
  assert.ok(canTransition("in_review", "approved"))
  assert.ok(canTransition("in_review", "rejected"))
})

test("approved cannot jump to invited or access_granted by hand", () => {
  assert.equal(canTransition("approved", "invited"), false)
  assert.equal(canTransition("approved", "access_granted"), false)
  assert.equal(canTransition("new", "approved"), false)
})

test("invited and access_granted are locked for manual status edits", () => {
  assert.deepEqual(manualTargets("invited"), [])
  assert.deepEqual(manualTargets("access_granted"), [])
})

test("partial approval is a subset of requested modules", () => {
  assert.equal(validateApproval(["wms", "ems"], ["wms"]), null)
  assert.match(validateApproval(["wms"], ["wms", "yms"]) || "", /незапрошенные/)
  assert.match(validateApproval(["wms"], []) || "", /хотя бы один/)
})
