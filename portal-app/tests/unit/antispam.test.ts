import assert from "node:assert/strict"
import test from "node:test"
import { checkFormToken, issueFormToken } from "../../lib/antispam.ts"
import { safeNext } from "../../lib/auth-flow.ts"

test("form token: too fast submit is rejected", () => {
  const t = issueFormToken(1_000_000)
  assert.throws(() => checkFormToken(t, 1_001_000, 4000), /быстро/)
  assert.doesNotThrow(() => checkFormToken(t, 1_005_000, 4000))
})

test("form token: tampered or stale token is rejected", () => {
  const t = issueFormToken(1_000_000)
  assert.throws(() => checkFormToken(t.slice(0, -2) + "xx", 1_005_000, 0), /устарела/)
  assert.throws(() => checkFormToken(t, 1_000_000 + 7 * 3600 * 1000, 0), /устарела/)
})

test("post-login redirect stays on this site", () => {
  assert.equal(safeNext("/admin/requests"), "/admin/requests")
  assert.equal(safeNext("//evil.example"), "/")
  assert.equal(safeNext("https://evil.example"), "/")
  assert.equal(safeNext("/\\evil"), "/")
})
