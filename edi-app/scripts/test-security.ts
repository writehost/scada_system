import assert from "node:assert/strict"
import test from "node:test"
import { assertSameOrigin } from "../lib/auth/csrf.ts"
import { passwordEnabled, safeReturnPath } from "../lib/auth/policy.ts"
import { effectiveEdiRoles } from "../lib/edi/permissions.ts"
import { assertOutboundUrl } from "../lib/outbound.ts"
import { boundedBody } from "../lib/body.ts"

test("production: no password or implicit WMS authority", () => {
  const saved = { ...process.env }
  try {
    process.env = { ...process.env, NODE_ENV: "production" }
    delete process.env.EDI_ALLOW_PASSWORD_LOGIN
    delete process.env.EDI_ALLOW_WMS_ROLE_FALLBACK
    assert.equal(passwordEnabled(), false)
    assert.deepEqual(effectiveEdiRoles(["admin"], []), [])
    assert.deepEqual(effectiveEdiRoles(["admin"], ["edi_viewer"]), ["edi_viewer"])
  } finally { process.env = saved }
})

test("CSRF: reject cross-site cookie mutation, permit same-origin and credentialed API client", () => {
  const saved = process.env.EDI_PUBLIC_ORIGIN
  process.env.EDI_PUBLIC_ORIGIN = "https://edi.scadasystem.io"
  try {
    assert.throws(() => assertSameOrigin(new Request("https://edi.scadasystem.io/api/edi/documents", { method: "POST", headers: { cookie: "edi_session=x", origin: "https://attacker.example" } })))
    assert.throws(() => assertSameOrigin(new Request("https://edi.scadasystem.io/api/auth/login", { method: "POST" })))
    assert.doesNotThrow(() => assertSameOrigin(new Request("https://edi.scadasystem.io/api/edi/documents", { method: "POST", headers: { cookie: "edi_session=x", origin: "https://edi.scadasystem.io" } })))
    assert.doesNotThrow(() => assertSameOrigin(new Request("https://edi.scadasystem.io/api/edi/documents", { method: "POST", headers: { authorization: "Bearer wmsu_test" } })))
  } finally { if (saved === undefined) delete process.env.EDI_PUBLIC_ORIGIN; else process.env.EDI_PUBLIC_ORIGIN = saved }
})

test("redirect: reject browser slash normalization and external redirect", () => {
  for (const value of ["//attacker.example", "/\\attacker.example", "https://attacker.example", "/\n/attacker.example"]) assert.equal(safeReturnPath(value), "/")
  assert.equal(safeReturnPath("/documents?q=123"), "/documents?q=123")
})

test("SSRF: reject metadata endpoint, unapproved host and embedded credentials", () => {
  const saved = { ...process.env }
  try {
    process.env = { ...process.env, NODE_ENV: "production" }
    process.env.EDI_OUTBOUND_ORIGINS = "https://wms.scada25.ru"
    for (const value of ["http://169.254.169.254/latest/meta-data", "https://127.0.0.1/", "https://attacker.example/", "https://user:secret@wms.scada25.ru/"]) assert.throws(() => assertOutboundUrl(value))
    assert.equal(assertOutboundUrl("https://wms.scada25.ru/api/wms/items").hostname, "wms.scada25.ru")
  } finally { process.env = saved }
})

test("request limit: reject chunked body without Content-Length before reading full payload", async () => {
  let cancelled = false
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(32)) }, cancel() { cancelled = true } })
  const req = new Request("https://edi.scadasystem.io/api/edi/imports", { method: "POST", body, duplex: "half" } as RequestInit)
  await assert.rejects(() => boundedBody(req, 50), /Слишком большой/)
  assert.equal(cancelled, true)
})
