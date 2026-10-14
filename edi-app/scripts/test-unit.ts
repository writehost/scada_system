import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { zipSync } from "fflate"

import { isValidInn, isValidOgrn, validateCounterparty } from "../lib/edi/counterparties.ts"
import { inspectUpload, sniff } from "../lib/edi/files.ts"
import { expandZip, parseFile } from "../lib/edi/import.ts"
import { computeLine, sumLines, vatFraction } from "../lib/edi/money.ts"
import { effectiveEdiRoles, permissionsForRoles } from "../lib/edi/permissions.ts"
import { parseCsv, parseXlsx, rowsToLines } from "../lib/edi/parsers/table.ts"
import { gtinFromMarking, parseUpd } from "../lib/edi/parsers/upd.ts"
import { decodeXmlBytes, parseXml } from "../lib/edi/parsers/xml.ts"
import { decryptSecret, encryptSecret } from "../lib/edi/secrets.ts"
import { parseCms } from "../lib/edi/signatures.ts"
import { signV4 } from "../lib/edi/storage.ts"
import { conditionHolds, validateDefinition, ROUTE_PRESETS } from "../lib/edi/workflow.ts"
import { compareReceipt } from "../lib/edi/wms-receipt.ts"
import { signPayload, verifyPayload } from "../lib/auth/session.ts"
import { buildUpd, encodeCp1251 } from "./fixtures/upd.ts"

const SELLER = { name: 'ООО "Поставщик-Тест"', inn: "5005020000", kpp: "500501001" }
const BUYER = { name: 'ООО "Скеэт"', inn: "7701010000", kpp: "770101001" }

/* ---------- XML: безопасность ---------- */

test("xml: DOCTYPE и сущности запрещены (XXE, billion laughs)", () => {
  assert.throws(() => parseXml(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>`), /DOCTYPE/)
  assert.throws(() => parseXml(`<!DOCTYPE x SYSTEM "file:///etc/passwd"><x/>`), /DOCTYPE/)
  assert.throws(() => parseXml(`<x>&custom;</x>`))
})

test("xml: предопределённые сущности, CDATA, атрибуты", () => {
  const r = parseXml(`<?xml version="1.0"?><a b="1 &amp; 2 &#1060;"><c><![CDATA[<raw>]]></c>t&lt;</a>`)
  assert.equal(r.attrs.b, "1 & 2 Ф")
  assert.equal(r.children[0].text, "<raw>")
  assert.equal(r.text, "t<")
})

test("xml: лимит глубины и несбалансированные теги", () => {
  assert.throws(() => parseXml("<a>".repeat(100) + "</a>".repeat(100)), /вложенность/)
  assert.throws(() => parseXml("<a><b></a>"), /закрывающий/)
  assert.throws(() => parseXml("<a></a><b></b>"), /корневых/)
})

test("xml: windows-1251 по декларации", () => {
  const bytes = encodeCp1251(`<?xml version="1.0" encoding="windows-1251"?><Файл А="Привет"/>`)
  const { text, encoding } = decodeXmlBytes(bytes)
  assert.equal(encoding, "windows-1251")
  assert.equal(parseXml(text).attrs["А"], "Привет")
})

/* ---------- УПД ---------- */

test("upd 5.03: реквизиты, стороны, строки, итоги, GTIN из КИЗ и ИнфПолФХЖ2", () => {
  const xml = buildUpd({
    number: "УТ-125",
    date: "01.09.2026",
    seller: SELLER,
    buyer: BUYER,
    basis: { name: "Договор поставки", number: "Д-17", date: "10.01.2026" },
    lines: [
      { name: "Вода питьевая 0,5 л", code: "V-05", gtin: "04600000000017", okei: "796", uom: "шт", qty: 120, price: 25, vat: "20%" },
      { name: "Крышка 28 мм", code: "K-28", okei: "796", uom: "шт", qty: 1000, price: 1.2, vat: "20%", kiz: ["010460000000002421abcdEFG\u001d91XYZ"] },
      { name: "Услуга доставки", code: "DLV", okei: "796", uom: "усл", qty: 1, price: 1500, vat: "без НДС" },
    ],
  })
  const u = parseUpd(parseXml(decodeXmlBytes(encodeCp1251(xml)).text))
  assert.equal(u.formatCode, "fns_upd_5_03")
  assert.equal(u.number, "УТ-125")
  assert.equal(u.date, "2026-09-01")
  assert.equal(u.function, "СЧФДОП")
  assert.equal(u.docType, "upd")
  assert.equal(u.currencyCode, "643")
  assert.equal(u.seller?.inn, SELLER.inn)
  assert.equal(u.seller?.kpp, SELLER.kpp)
  assert.equal(u.seller?.bankBik, "044525000")
  assert.equal(u.buyer?.inn, BUYER.inn)
  assert.equal(u.lines.length, 3)
  assert.equal(u.lines[0].gtin, "04600000000017")
  assert.equal(u.lines[0].supplierCode, "V-05")
  assert.equal(u.lines[0].vatAmount, 600)
  assert.equal(u.lines[1].gtin, "04600000000024")
  assert.equal(u.lines[1].markingCodes.length, 1)
  assert.equal(u.lines[2].vatRate, "без НДС")
  assert.equal(u.lines[2].vatAmount, 0)
  assert.equal(u.totals.amountTotal, 3000 + 600 + 1200 + 240 + 1500)
  assert.deepEqual(u.basis[0], { name: "Договор поставки", number: "Д-17", date: "2026-01-10" })
  assert.equal(u.issues.filter((i) => i.level === "error").length, 0)
})

test("upd 5.01: номер и дата из НомерСчФ/ДатаСчФ, валюта атрибутом", () => {
  const xml = buildUpd({ version: "5.01", number: "17", date: "15.02.2025", seller: SELLER, buyer: BUYER, lines: [{ name: "Товар", code: "T1", okei: "796", uom: "шт", qty: 2, price: 10, vat: "20%" }] })
  const u = parseUpd(parseXml(xml.replace('encoding="windows-1251"', 'encoding="utf-8"')))
  assert.equal(u.formatCode, "fns_upd_5_01")
  assert.equal(u.number, "17")
  assert.equal(u.date, "2025-02-15")
  assert.equal(u.currencyCode, "643")
})

test("upd: арифметические расхождения попадают в замечания", () => {
  const xml = buildUpd({ number: "1", date: "01.09.2026", seller: SELLER, buyer: BUYER, lines: [{ name: "Товар", code: "T1", okei: "796", uom: "шт", qty: 2, price: 10, vat: "20%" }] }).replace(
    'СтТовБезНДС="20.00"',
    'СтТовБезНДС="25.00"'
  )
  const u = parseUpd(parseXml(xml.replace('encoding="windows-1251"', 'encoding="utf-8"')))
  assert.ok(u.issues.some((i) => i.code === "line_math"))
})

test("gtin из DataMatrix", () => {
  assert.equal(gtinFromMarking("0104600000000017215abc"), "04600000000017")
  assert.equal(gtinFromMarking("(01)04600000000017(21)x"), "04600000000017")
  assert.equal(gtinFromMarking("abc"), null)
})

/* ---------- реквизиты ---------- */

test("ИНН/ОГРН: контрольные суммы", () => {
  assert.ok(isValidInn("7707083893"))
  assert.ok(!isValidInn("7707083894"))
  assert.ok(isValidInn("500100732259"))
  assert.ok(!isValidInn("500100732258"))
  assert.ok(isValidOgrn("1027700132195"))
  assert.ok(!isValidOgrn("1027700132196"))
  assert.deepEqual(validateCounterparty({ name: "ИП", inn: "500100732259", kpp: "500101001" }), ["У ИП и физлиц КПП не указывается"])
})

/* ---------- деньги ---------- */

test("money: ставки НДС и пересчёт строк", () => {
  assert.equal(vatFraction("20%"), 0.2)
  assert.equal(vatFraction("10/110"), 0.1)
  assert.equal(vatFraction("без НДС"), null)
  assert.deepEqual(computeLine({ qty: 3, price: 33.33, vatRate: "20%" }), { qty: 3, price: 33.33, amountNet: 99.99, vatAmount: 20, amountTotal: 119.99 })
  // явные суммы из файла поставщика не пересчитываются
  assert.equal(computeLine({ qty: 1, price: 10, amountNet: 9, vatRate: "20%" }).amountNet, 9)
  assert.deepEqual(sumLines([{ amountNet: 0.1, vatAmount: 0.02, amountTotal: 0.12 }, { amountNet: 0.2, vatAmount: 0.04, amountTotal: 0.24 }]), { amountNet: 0.3, amountVat: 0.06, amountTotal: 0.36 })
})

/* ---------- права ---------- */

test("роли: явные роли EDI важнее ролей WMS, без ролей — нет доступа", () => {
  assert.deepEqual(effectiveEdiRoles(["warehouse_manager"], []), ["edi_approver", "edi_clerk"])
  assert.deepEqual(effectiveEdiRoles(["admin"], ["edi_viewer"]), ["edi_viewer"])
  assert.deepEqual(effectiveEdiRoles(["line_operator"], []), [])
  assert.ok(!permissionsForRoles(["edi_viewer"]).has("edi.doc.create"))
  assert.ok(permissionsForRoles(["edi_signer"]).has("edi.doc.sign"))
})

/* ---------- маршруты ---------- */

test("workflow: условия и проверка определения", () => {
  const doc = { amountTotal: "1500000.00", docType: "contract", department: "Снабжение", direction: "outgoing" }
  assert.ok(conditionHolds({ field: "amount", op: "gt", value: 1000000 }, doc))
  assert.ok(!conditionHolds({ field: "amount", op: "lte", value: 1000000 }, doc))
  assert.ok(conditionHolds({ field: "docType", op: "in", value: ["contract", "invoice"] }, doc))
  assert.ok(conditionHolds(null, doc))
  for (const p of ROUTE_PRESETS) assert.deepEqual(validateDefinition(p.definition), [], p.code)
  const bad = validateDefinition({ steps: [{ id: "a", name: "", kind: "signing", assignee: { type: "role", role: "nope" }, mode: "any", stage: 0, decisions: ["approve"] }] })
  assert.ok(bad.length >= 3)
})

/* ---------- приёмка ---------- */

test("сверка приёмки: недостача, излишек, позиции вне документа", () => {
  const cmp = compareReceipt(
    [
      { itemCode: "A", itemName: "A", qty: 10 },
      { itemCode: "b", itemName: "B", qty: 5 },
    ],
    { dismissedEmpty: false, postedLines: [{ itemCode: "a", qty: 8 }, { itemCode: "B", qty: 5 }, { itemCode: "C", qty: 1 }] }
  )
  assert.ok(cmp.hasDiscrepancy)
  assert.deepEqual(cmp.lines.find((l) => l.itemCode === "A"), { itemCode: "A", itemName: "A", expected: 10, received: 8, diff: -2 })
  assert.equal(cmp.lines.find((l) => l.itemCode === "B")?.diff, 0)
  assert.equal(cmp.lines.find((l) => l.itemCode === "C")?.diff, 1)
  assert.ok(!compareReceipt([{ itemCode: "A", itemName: "", qty: 1 }], { dismissedEmpty: false, postedLines: [{ itemCode: "A", qty: 1 }] }).hasDiscrepancy)
})

/* ---------- загрузка ---------- */

test("upload: исполняемые, HTML, подмена расширения, макросы — отклоняются", () => {
  assert.throws(() => inspectUpload("a.exe", new Uint8Array([0x4d, 0x5a, 1, 2])), /запрещён/)
  assert.throws(() => inspectUpload("a.pdf", new TextEncoder().encode("<html><script>x</script>")), /HTML/)
  assert.throws(() => inspectUpload("a.pdf", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])), /не соответствует/)
  assert.throws(() => inspectUpload("a.svg", new TextEncoder().encode("<svg/>")), /запрещён/)
  const macro = zipSync({ "word/document.xml": new TextEncoder().encode("<w/>"), "word/vbaProject.bin": new Uint8Array([1]) })
  assert.throws(() => inspectUpload("a.docx", macro), /макрос/)
  assert.equal(inspectUpload("a.xml", new TextEncoder().encode('<?xml version="1.0"?><a/>')).mime, "application/xml")
  assert.equal(sniff(new TextEncoder().encode("%PDF-1.7")), "pdf")
})

test("zip: лимит степени сжатия, обход путей, вложенные архивы", () => {
  const bomb = zipSync({ "big.xml": new Uint8Array(20 * 1024 * 1024) }, { level: 9 })
  assert.throws(() => expandZip(bomb), /сжатия/)
  const nested = zipSync({ "inner.zip": zipSync({ "a.txt": new Uint8Array([65]) }, { level: 0 }) }, { level: 0 })
  assert.throws(() => expandZip(nested), /Вложенные/)
  const ok = expandZip(zipSync({ "dir/a.xml": new TextEncoder().encode("<a/>"), "__MACOSX/x": new Uint8Array([1]) }))
  assert.deepEqual(ok.map((e) => e.name), ["a.xml"])
})

/* ---------- таблицы ---------- */

test("csv: разделитель, кавычки, заголовки, итоговая строка пропускается", () => {
  const rows = parseCsv('Наименование;Артикул;Штрихкод;Кол-во;Ед. изм.;Цена;Ставка НДС\n"Вода ""Чистая"" 0,5";V-05;4600000000017;12;шт;25,50;20%\nИтого;;;12;;;\n')
  const t = rowsToLines(rows)
  assert.equal(t.lines.length, 1)
  assert.equal(t.lines[0].name, 'Вода "Чистая" 0,5')
  assert.equal(t.lines[0].gtin, "04600000000017")
  assert.equal(t.lines[0].qty, 12)
  assert.equal(t.lines[0].price, 25.5)
})

test("xlsx: общие строки и числовые ячейки первого листа", () => {
  const enc = new TextEncoder()
  const xlsx = zipSync({
    "[Content_Types].xml": enc.encode("<Types/>"),
    "xl/workbook.xml": enc.encode("<workbook/>"),
    "xl/sharedStrings.xml": enc.encode('<sst><si><t>Наименование</t></si><si><t>Количество</t></si><si><t>Цена</t></si><si><t>Болт М8</t></si></sst>'),
    "xl/worksheets/sheet1.xml": enc.encode(
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>40</v></c><c r="C2"><v>3.5</v></c></row></sheetData></worksheet>'
    ),
  })
  const t = rowsToLines(parseXlsx(xlsx))
  assert.deepEqual([t.lines[0].name, t.lines[0].qty, t.lines[0].price], ["Болт М8", 40, 3.5])
})

test("parseFile: XML неизвестного формата сохраняется как файл с замечанием", () => {
  const r = parseFile("x.xml", new TextEncoder().encode('<?xml version="1.0"?><Order/>'), "xml", "application/xml")
  assert.equal(r.parsed.sourceKind, "unstructured")
  assert.ok(r.issues.some((i) => i.code === "xml_unknown"))
})

/* ---------- криптография и хранилище ---------- */

test("S3 SigV4: эталонный пример AWS (GET Object с Range)", () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — Example: GET Object
  const auth = signV4({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    canonicalUri: "/test.txt",
    headers: {
      host: "examplebucket.s3.amazonaws.com",
      range: "bytes=0-9",
      "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "x-amz-date": "20130524T000000Z",
    },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    amzDate: "20130524T000000Z",
  })
  assert.match(auth, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/)
})

test("секреты интеграций: AES-GCM, подмена шифротекста обнаруживается", () => {
  const enc = encryptSecret("wmsu_secret")
  assert.equal(decryptSecret(enc), "wmsu_secret")
  const parts = enc.split(".")
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA")
  assert.throws(() => decryptSecret(parts.join(".")))
})

test("подписанные токены: подмена и истечение", async () => {
  const t = await signPayload({ a: 1 }, "s1")
  assert.deepEqual(await verifyPayload(t, "s1"), { a: 1 })
  assert.equal(await verifyPayload(t, "s2"), null)
  assert.equal(await verifyPayload(t.replace(/^./, "x"), "s1"), null)
})

test("CMS: разбор откреплённой подписи (сертификат, ИНН, срок, время подписания)", () => {
  const dir = mkdtempSync(join(tmpdir(), "edi-cms-"))
  const key = join(dir, "k.pem")
  const cert = join(dir, "c.pem")
  const data = join(dir, "doc.xml")
  const sig = join(dir, "doc.sig")
  writeFileSync(data, "<Файл/>")
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "30", "-subj", "/CN=Иванов Иван/SN=Иванов/GN=Иван/O=ООО Тест/title=Директор/INN=005005020000", "-utf8"], { stdio: "ignore" })
  execFileSync("openssl", ["cms", "-sign", "-binary", "-in", data, "-signer", cert, "-inkey", key, "-outform", "DER", "-out", sig], { stdio: "ignore" })
  const info = parseCms(new Uint8Array(readFileSync(sig)))
  assert.equal(info.detached, true)
  assert.equal(info.signerName, "Иванов Иван")
  assert.equal(info.organization, "ООО Тест")
  assert.equal(info.title, "Директор")
  assert.ok(info.certSerial && info.certSerial.length > 8)
  assert.ok(info.signedAt && Date.parse(info.signedAt) <= Date.now())
  assert.ok(info.certValidTo && Date.parse(info.certValidTo) > Date.now())
  // base64 (как отдаёт КриптоПро ЭЦП Browser plug-in)
  const b64 = new TextEncoder().encode(readFileSync(sig).toString("base64"))
  assert.equal(parseCms(b64).certSerial, info.certSerial)
  assert.throws(() => parseCms(new TextEncoder().encode("not a signature")))
})
