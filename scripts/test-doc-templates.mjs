import assert from "node:assert/strict"
import test from "node:test"

import { importJinjaTemplate } from "../lib/doc-templates/jinja/importer.ts"
import { designHtmlToJinja } from "../lib/doc-templates/jinja/exporter.ts"
import {
  buildCondition,
  buildLoopHeader,
  evaluateCondition,
  parseCondition,
  parseLoopHeader,
  parseVarExpr,
} from "../lib/doc-templates/jinja/expressions.ts"
import { sanitizeTemplateHtml } from "../lib/doc-templates/jinja/sanitize.ts"
import { buildJinjaDocument, splitDesignPages } from "../lib/doc-templates/document.ts"
import { DEFAULT_PAGE } from "../lib/doc-templates/page.ts"

/** Сравниваем шаблоны без учёта пробелов между тегами и внутри {{ }}. */
function norm(s) {
  return s
    .replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, "{{ $1 }}")
    .replace(/\{%\s*([\s\S]*?)\s*%\}/g, "{% $1 %}")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim()
}

function roundtrip(src) {
  const imported = importJinjaTemplate(src)
  return { ...imported, out: designHtmlToJinja(imported.html) }
}

test("variable becomes a data-aware token and exports back", () => {
  const src = `<p>УПД № {{ document.number }} от {{document.date}}</p>`
  const r = roundtrip(src)
  assert.match(r.html, /<span data-jinja-var="document.number"><\/span>/)
  assert.equal(norm(r.out), norm(src))
  assert.equal(r.rawBlocks, 0)
})

test("if around a single element becomes a directive", () => {
  const src = `{% if document.comment %}<p>Комментарий: {{ document.comment }}</p>{% endif %}`
  const r = roundtrip(src)
  assert.match(r.html, /<p data-jinja-if="document.comment">/)
  assert.equal(norm(r.out), norm(src))
})

test("for around table rows stays inside tbody", () => {
  const src = `<table><thead><tr><th>Товар</th></tr></thead><tbody>{% for item in document.items %}<tr><td>{{ loop.index }}</td><td>{{ item.name }}</td></tr>{% endfor %}</tbody></table>`
  const r = roundtrip(src)
  assert.match(r.html, /<tr data-jinja-for="item in document.items">/)
  assert.equal(norm(r.out), norm(src))
})

test("if/elif/else keeps all branches", () => {
  const src = `<div>{% if document.status == "APPROVED" %}<b>Утверждён</b>{% elif document.status == "DRAFT" %}Черновик{% else %}—{% endif %}</div>`
  const r = roundtrip(src)
  assert.match(r.html, /data-jinja-wrap="if"/)
  assert.match(r.html, /data-jinja-branch="elif" data-jinja-cond="document.status == &quot;DRAFT&quot;"/)
  assert.equal(norm(r.out), norm(src))
})

test("inline if inside text uses a span wrapper", () => {
  const src = `<p>Покупатель: {{ buyer.name }}{% if buyer.kpp %}, КПП {{ buyer.kpp }}{% endif %}</p>`
  const r = roundtrip(src)
  assert.match(r.html, /<span data-jinja-wrap="if" data-jinja-if="buyer.kpp">/)
  assert.equal(norm(r.out), norm(src))
})

test("jinja crossing html boundaries is preserved verbatim", () => {
  const src = `<div class="a"><p>{% if x %}начало</p><p>конец{% endif %}</p></div><p>после {{ y }}</p>`
  const r = roundtrip(src)
  assert.equal(r.rawBlocks, 1)
  assert.ok(r.warnings.some((w) => w.includes("Advanced Jinja")))
  assert.equal(norm(r.out), norm(src))
  assert.match(r.html, /data-jinja-var="y"/)
})

test("attributes with jinja are kept as-is", () => {
  const src = `<img src="{{ product.image }}" alt="Фото"><td class="cell {{ row.cls }}" title="{{ x|default(&quot;a&quot;) }}">1</td>`
  const r = roundtrip(`<table><tbody><tr>${src.replace("<img", "<td><img").replace('alt="Фото">', 'alt="Фото"></td>')}</tr></tbody></table>`)
  assert.match(r.html, /data-jinja-attr-src="\{\{ product.image \}\}"/)
  assert.match(r.out, /src="\{\{ product.image \}\}"/)
  assert.match(r.out, /class="cell \{\{ row.cls \}\}"/)
  assert.match(r.out, /title='\{\{ x\|default\("a"\) \}\}'/)
})

test("jinja quotes inside attribute values survive", () => {
  const src = `<span title="{{ x|default('нет') }}">a</span>`
  const r = roundtrip(src)
  assert.equal(norm(r.out), norm(src))
})

test("jinja between attributes becomes a raw block", () => {
  const src = `<p {% if x %}class="red"{% endif %}>текст</p>`
  const r = roundtrip(src)
  assert.equal(r.rawBlocks, 1)
  assert.equal(norm(r.out), norm(src))
})

test("unsupported statements are raw but not lost", () => {
  const src = `{% set total = 0 %}{% macro row(x) %}<tr><td>{{ x }}</td></tr>{% endmacro %}<p>{{ total }}</p>{# комментарий #}{% raw %}{{ не трогать }}{% endraw %}`
  const r = roundtrip(src)
  assert.equal(norm(r.out), norm(src))
  assert.ok(r.rawBlocks >= 4)
})

test("whitespace control is preserved through raw tokens", () => {
  const src = `<p>{%- if a -%}x{%- endif -%} {{- b -}}</p>`
  const r = roundtrip(src)
  assert.equal(norm(r.out), norm(src))
})

test("for with else uses branches", () => {
  const src = `<ul>{% for p in items %}<li>{{ p.name }}</li>{% else %}<li>Пусто</li>{% endfor %}</ul>`
  const r = roundtrip(src)
  assert.match(r.html, /data-jinja-wrap="for"/)
  assert.equal(norm(r.out), norm(src))
})

test("nested for+if on a single row become two directives", () => {
  const src = `<table><tbody>{% for item in items %}{% if item.qty > 0 %}<tr><td>{{ item.name }}</td></tr>{% endif %}{% endfor %}</tbody></table>`
  const r = roundtrip(src)
  assert.match(r.html, /<tr data-jinja-for="item in items" data-jinja-if="item.qty &gt; 0">/)
  assert.equal(norm(r.out), norm(src))
})

test("if outside for on a table row falls back to raw", () => {
  const src = `<table><tbody>{% if show %}{% for item in items %}<tr><td>{{ item.name }}</td></tr>{% endfor %}{% endif %}</tbody></table>`
  const r = roundtrip(src)
  assert.equal(norm(r.out), norm(src))
})

test("unbalanced tags do not crash the importer", () => {
  for (const src of ["{% endif %}<p>a</p>", "<div>{% if a %}<p>b</div>", "</div><p>{{ x }}", "{% if a %}<p>x</p>", "<p>{{ unclosed"]) {
    const r = roundtrip(src)
    assert.equal(typeof r.out, "string")
  }
})

test("sanitizer strips scripts, handlers and javascript urls", () => {
  const src = `<p onclick="alert(1)">a</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href=" JaVa&#x53;cript:alert(1)">y</a><img src="data:text/html;base64,AAA" onerror="x()"><iframe src="//evil"></iframe><img src="data:image/png;base64,AAA">`
  const { html, removed } = sanitizeTemplateHtml(src)
  assert.doesNotMatch(html, /script|onclick|onerror|javascript|iframe|text\/html/i)
  assert.match(html, /data:image\/png/)
  assert.ok(removed.length >= 6)
  const r = roundtrip(src)
  assert.doesNotMatch(r.out, /script|onclick|onerror|javascript|iframe/i)
})

test("full document import extracts css and page settings", () => {
  const doc = buildJinjaDocument({
    title: "УПД",
    page: { ...DEFAULT_PAGE, orientation: "landscape" },
    css: ".title{font-weight:bold}",
    pages: [{ html: `<p class="title">УПД № <span data-jinja-var="document.number"></span></p>` }, { html: "<p>2</p>" }],
  })
  assert.match(doc, /@page \{ size: 297mm 210mm;/)
  assert.match(doc, /\{\{ document.number \}\}/)
  const r = importJinjaTemplate(doc)
  assert.equal(r.page?.orientation, "landscape")
  assert.equal(r.page?.widthMm, 297)
  assert.match(r.css, /\.title/)
  assert.doesNotMatch(r.css, /@page/)
  const pages = splitDesignPages(r.html)
  assert.equal(pages.length, 2)
  assert.match(pages[0], /data-jinja-var="document.number"/)
})

test("variable expressions parse into path and filters", () => {
  assert.deepEqual(parseVarExpr("document.date | date('DD.MM.YYYY')"), {
    path: "document.date",
    filters: [{ name: "date", args: "'DD.MM.YYYY'" }],
  })
  assert.equal(parseVarExpr("a + b"), null)
  assert.deepEqual(parseVarExpr("items[0].name"), { path: "items[0].name", filters: [] })
})

test("conditions parse into rules and rebuild identically", () => {
  const cases = [
    `document.status == "APPROVED"`,
    `document.comment`,
    `not document.comment`,
    `document.total > 1000 and buyer.inn`,
    `"брак" in document.comment or document.status != "OK"`,
  ]
  for (const c of cases) {
    const model = parseCondition(c)
    assert.ok(model, c)
    assert.equal(buildCondition(model), c)
  }
  assert.equal(parseCondition("a and b or c"), null)
  assert.equal(parseCondition("a|length > 2"), null)
  assert.deepEqual(parseCondition("x is defined").rules[0], { left: "x", op: "exists" })
})

test("conditions evaluate on preview data", () => {
  const data = { document: { status: "APPROVED", total: 1500, comment: "" }, items: [1] }
  assert.equal(evaluateCondition(`document.status == "APPROVED"`, data), true)
  assert.equal(evaluateCondition(`document.comment`, data), false)
  assert.equal(evaluateCondition(`document.total > 1000 and items`, data), true)
  assert.equal(evaluateCondition(`a|b`, data), null)
})

test("loop headers parse", () => {
  assert.deepEqual(parseLoopHeader("item in document.items"), { itemVar: "item", source: "document.items" })
  assert.equal(parseLoopHeader("k, v in d.items()"), null)
  assert.equal(buildLoopHeader({ itemVar: "row", source: "rows" }), "row in rows")
})

import { renderTemplate, validateTemplate, placeRegions } from "../lib/doc-templates/render.ts"
import { SYSTEM_TEMPLATES } from "../lib/doc-templates/system-templates.ts"
import { getDocumentKind } from "../lib/doc-templates/schema.ts"

test("renderer blocks prototype escapes and dynamic lookups", () => {
  const attacks = [
    `{{ range.constructor("return process")() }}`,
    `{{ cycler["constructor"] }}`,
    `{% set k = "constructor" %}{{ range[k] }}`,
    `{{ x.__proto__ }}`,
    `{% include "/etc/passwd" %}`,
    `{{ items|map("x") }}`,
    `{{ "".toString() }}`,
    `{{ (range)("x") }}`,
  ]
  for (const a of attacks) assert.throws(() => validateTemplate(a), /./, a)
  assert.doesNotThrow(() => validateTemplate(`{% macro row(x) %}{{ x }}{% endmacro %}{{ row(1) }}{{ loop.cycle('a','b') if loop else '' }}{{ items[0].name }}{{ "a b".split(" ") | join(",") }}`))
})

test("renderer escapes data and formats values", () => {
  const html = renderTemplate(`<p>{{ a }} {{ d | date }} {{ d | date("D MMMM YYYY") }} {{ n | money }} {{ q | number }}</p>`, {
    a: "<script>x</script>",
    d: "2026-10-05",
    n: 9802.6,
    q: 1200,
  })
  assert.equal(html, "<p>&lt;script&gt;x&lt;/script&gt; 05.10.2026 5 октября 2026 9 802,60 1 200</p>")
})

test("system templates are valid, render on samples and survive import/export", () => {
  for (const t of SYSTEM_TEMPLATES) {
    validateTemplate(t.jinja)
    const kind = getDocumentKind(t.docKind)
    const sample = kind.samples.find((s) => s.id === t.sampleId)
    assert.ok(sample, t.id)
    const html = renderTemplate(t.jinja, sample.data)
    assert.doesNotMatch(html, /\{\{|\{%/, t.id)
    const imported = importJinjaTemplate(t.jinja)
    assert.equal(imported.rawBlocks, 0, `${t.id}: ${imported.warnings.join("; ")}`)
    const rebuilt = buildJinjaDocument({ title: t.name, page: t.page, css: imported.css, pages: splitDesignPages(imported.html).map((html) => ({ html })) })
    const flat = (h) => h.replace(/<section class="doc-page"[^>]*>|<\/section>/g, "").replace(/>\s+</g, "><").replace(/\s+/g, " ").trim()
    assert.equal(flat(renderTemplate(rebuilt, sample.data)), flat(html), t.id)
  }
})

test("UPD demo renders the acceptance content", () => {
  const t = SYSTEM_TEMPLATES.find((x) => x.id === "upd-demo")
  const data = getDocumentKind("trade").samples[0].data
  const html = renderTemplate(t.jinja, data)
  assert.match(html, /УПД № 123 от 05\.10\.2026/)
  assert.match(html, /ООО «Торговый дом Север»/)
  assert.match(html, /Вода детская «Славда» 0,33 л/)
  assert.match(html, /9 802,60/)
  assert.match(html, /Комментарий:/)
  assert.match(html, /src="data:image\/svg\+xml;base64,/)
  const noComment = renderTemplate(t.jinja, { ...data, document: { ...data.document, comment: "" } })
  assert.doesNotMatch(noComment, /Комментарий:/)
  const placed = placeRegions(html, "pdf")
  assert.match(placed.footer ?? "", /doc-page-number/)
  assert.doesNotMatch(placed.html, /doc-page-number/)
})

import { BARCODE_KINDS, barcodeSvg, barcodeJinjaExpr, normalizeBarcodeBlock } from "../lib/doc-templates/barcode.ts"
import { rawBlocksFromJinja } from "../lib/doc-templates/raw-blocks.ts"

test("every barcode kind renders an svg for typical data", () => {
  const values = {
    qrcode: "https://wms.scada25.ru/s/upd-123",
    datamatrix: "PF-28/2609",
    gs1datamatrix: "0104607012345678215AbCdE\u001d93dGVz",
    code128: "УПД-123".replace("УПД", "UPD"),
    "gs1-128": "(01)04607012345677(10)2610-01",
    ean13: "4607012345677",
  }
  for (const k of BARCODE_KINDS) {
    const svg = barcodeSvg(values[k.id], { kind: k.id, humanReadable: true })
    assert.match(svg ?? "", /^<svg/, k.id)
  }
  assert.equal(barcodeSvg("", { kind: "qrcode" }), null)
  // Неверная контрольная цифра — ошибка, а не «исправленный» код.
  assert.equal(barcodeSvg("4607012345678", { kind: "ean13" }), null)
  assert.equal(barcodeJinjaExpr(normalizeBarcodeBlock({ kind: "qrcode", expr: "document.url" })), "barcode(document.url, 'qrcode', 'M', false, 0)")
})

test("raw blocks of an imported template are known before the first save", () => {
  const raws = rawBlocksFromJinja(`{% set x = 1 %}<p>{{ a }}</p>{# c #}`)
  assert.deepEqual(raws, ["{# c #}", "{% set x = 1 %}"])
})
