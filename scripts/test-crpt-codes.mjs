import assert from "node:assert/strict"
import test from "node:test"

import {
  compactGs1MarkedCode,
  formatMarkingCodeDisplay,
  normalizeCrptCode,
  stripCrptCryptoTail,
} from "../lib/wms/crpt.ts"

const SAMPLE_WITH_PARENS =
  "(01)04607017162248(21)5kV8xY2mN(93)dGVzdGNyeXB0bw=="
const SAMPLE_COMPACT = "0104607017162248215kV8xY2mN"

test("compactGs1MarkedCode removes AI parentheses", () => {
  assert.equal(compactGs1MarkedCode("(01)04607017162248(21)ABC123"), "010460701716224821ABC123")
  assert.equal(compactGs1MarkedCode("(01)04607017162248"), "0104607017162248")
})

test("stripCrptCryptoTail removes (93) tail", () => {
  assert.equal(stripCrptCryptoTail(SAMPLE_WITH_PARENS), "(01)04607017162248(21)5kV8xY2mN")
})

test("normalizeCrptCode is compact and scan-ready", () => {
  const normalized = normalizeCrptCode(SAMPLE_WITH_PARENS)
  assert.equal(normalized, SAMPLE_COMPACT)
  assert.doesNotMatch(normalized, /\(\d{2}\)/)
  assert.match(normalized, /^01\d{14}21/)
})

test("formatMarkingCodeDisplay never shows parentheses", () => {
  const display = formatMarkingCodeDisplay(SAMPLE_WITH_PARENS)
  assert.doesNotMatch(display, /\(\d{2}\)/)
  assert.equal(display, SAMPLE_COMPACT)
})
