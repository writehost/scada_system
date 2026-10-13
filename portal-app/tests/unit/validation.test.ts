import assert from "node:assert/strict"
import test from "node:test"
import { validateRequestInput } from "../../lib/validation.ts"

const good = {
  firstName: "Анна",
  lastName: "Петрова",
  email: "Anna.Petrova@Example.ru ",
  company: "ООО Пример",
  jobTitle: "Начальник склада",
  phone: "+7 900 000-00-00",
  comment: "Нужен склад и транспорт",
  consent: true,
  modules: ["wms", "yms", "wms"],
  idempotencyKey: "abcdefghijklmnop1234",
  formToken: "x",
}

test("accepts a valid request and normalizes it", () => {
  const r = validateRequestInput(good)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.value.email, "anna.petrova@example.ru")
  assert.deepEqual(r.value.modules, ["wms", "yms"])
})

test("requires consent and at least one module", () => {
  const r = validateRequestInput({ ...good, consent: false, modules: [] })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.ok(r.fields.consent)
  assert.ok(r.fields.modules)
})

test("rejects products in development and unknown keys", () => {
  for (const m of ["ems", "id", "nope"]) {
    const r = validateRequestInput({ ...good, modules: ["wms", m] })
    assert.equal(r.ok, false, m)
  }
})

test("rejects bad email and phone", () => {
  const r = validateRequestInput({ ...good, email: "no-at", phone: "abc" })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.ok(r.fields.email && r.fields.phone)
})

test("phone is optional", () => {
  const r = validateRequestInput({ ...good, phone: "" })
  assert.ok(r.ok)
})
