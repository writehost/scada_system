/**
 * Сквозной сценарий из ТЗ (п. 25) на реальной PostgreSQL и реальном коде SCADA WMS:
 *   поставщик присылает УПД → EDI принимает → определяет контрагента → извлекает строки →
 *   сопоставляет с номенклатурой WMS → показывает расхождения → пользователь проверяет →
 *   создаётся заказ на приход в WMS → склад проводит приёмку → результат связывается с УПД →
 *   статус в EDI → подпись/обмен по правилам → документ с подтверждениями в архиве.
 *
 * WMS запускается из корня репозитория (`next dev`) на отдельной тестовой базе с минимальной
 * схемой scripts/fixtures/wms-schema.sql. Единственный шаг, который выполняет сам тест вместо
 * человека на складе, — проведение приёмки ТСД (шаг 8): запись проведения делается в том же
 * формате, что пишет WMS finalizeReceivingSession, а EDI читает её через HTTP-маршрут WMS.
 *
 * Запуск: E2E_PG=postgres://postgres@127.0.0.1:5544 npm run test:e2e
 */
import assert from "node:assert/strict"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"
import pg from "pg"
import { unzipSync } from "fflate"

import { poolFromUrl, setPool } from "../lib/db.ts"
import { hashPassword, passwordLogin } from "../lib/auth/identity.ts"
import { actorForUser, type Actor } from "../lib/edi/actor.ts"
import { ensureEdiSchema } from "../lib/edi/schema.ts"
import { seedReference } from "../lib/edi/seed.ts"
import { saveIntegration } from "../lib/edi/integrations/config.ts"
import { linkWmsSuppliers } from "../lib/edi/wms-suppliers.ts"
import { confirmImport, ingestFiles, updateImport } from "../lib/edi/import.ts"
import { documentDetail } from "../lib/edi/detail.ts"
import { getDocument, setStatus, archiveDocument, createDocument, updateDocument } from "../lib/edi/documents.ts"
import { syncPendingReceipts, createDiscrepancyAct } from "../lib/edi/wms-receipt.ts"
import { listDocuments, dashboard } from "../lib/edi/journal.ts"
import { saveDefinition, startWorkflow, decide, ROUTE_PRESETS, processDeadlines, createDelegation } from "../lib/edi/workflow.ts"
import { addOwnSignature } from "../lib/edi/signatures.ts"
import { exportArchive } from "../lib/edi/archive.ts"
import { createCounterparty } from "../lib/edi/counterparties.ts"
import { runTick } from "../lib/edi/worker.ts"
import { buildUpd, encodeCp1251 } from "./fixtures/upd.ts"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..", "..")
const PG = (process.env.E2E_PG || "postgres://postgres@127.0.0.1:5544").replace(/\/$/, "")
const DB = "edi_e2e"
const WMS_PORT = Number(process.env.E2E_WMS_PORT || 3105)
const WMS_URL = `http://127.0.0.1:${WMS_PORT}`
const WMS_TOKEN = "wmsu_e2e_" + randomUUID().replace(/-/g, "")

const SELLER = { name: 'ООО "Поставщик-Тест"', inn: "5005020000", kpp: "500501001" }
const BUYER = { name: 'ООО "Скеэт"', inn: "7701010000", kpp: "770101001" }

let wms: ChildProcess | null = null
let pool: pg.Pool
let db: pg.PoolClient
let siteId = 0
let users: Record<string, string> = {}

async function sql(text: string, params: unknown[] = []) {
  return db.query(text, params)
}

async function as(name: string): Promise<Actor> {
  return actorForUser(db, siteId, users[name])
}

async function tx<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("BEGIN")
  try {
    const r = await fn()
    await db.query("COMMIT")
    return r
  } catch (e) {
    await db.query("ROLLBACK")
    throw e
  }
}

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${WMS_TOKEN}` }, signal: AbortSignal.timeout(120_000) })
      if (r.status < 500) return
    } catch {
      /* ещё стартует */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`WMS не поднялась за ${ms} мс: ${url}`)
}

before(async () => {
  const admin = new pg.Client({ connectionString: `${PG}/postgres` })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${DB}`)
  await admin.end()
  pool = poolFromUrl(`${PG}/${DB}?sslmode=disable`, 4)
  setPool(pool)
  db = await pool.connect()
  await db.query(readFileSync(join(here, "fixtures", "wms-schema.sql"), "utf8"))

  // Организации (арендаторы) и пользователи — как в WMS/SCADA ID
  siteId = (await sql(`INSERT INTO wms_sites (site_code, name) VALUES ('skeet', 'Скеэт') RETURNING site_id`)).rows[0].site_id
  const other = (await sql(`INSERT INTO wms_sites (site_code, name) VALUES ('other', 'Другая организация') RETURNING site_id`)).rows[0].site_id
  await sql(`INSERT INTO wms_roles (code, name) VALUES ('admin','Администратор'),('warehouse_manager','Начальник склада'),('warehouse_operator','Кладовщик'),('auditor','Ревизор'),('line_operator','Оператор линии')`)
  const pw = await hashPassword("secret-pass")
  const mk = async (site: number, login: string, name: string, roles: string[]) => {
    const id = (await sql(`INSERT INTO wms_users (site_id, login, display_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING user_id::text`, [site, login, name, pw])).rows[0].user_id
    for (const r of roles) await sql(`INSERT INTO wms_user_roles SELECT $1, role_id FROM wms_roles WHERE code = $2`, [id, r])
    return id
  }
  users = {
    clerk: await mk(siteId, "clerk", "Бухгалтер Петрова", ["warehouse_manager"]),
    boss: await mk(siteId, "boss", "Директор Сидоров", ["admin"]),
    storekeeper: await mk(siteId, "store", "Кладовщик Орлов", ["warehouse_operator"]),
    line: await mk(siteId, "line", "Оператор линии", ["line_operator"]),
    outsider: await mk(other, "outsider", "Чужой", ["admin"]),
    wmsService: await mk(siteId, "edi-service", "Сервис EDI", ["warehouse_manager"]),
  }
  // тот же логин clerk есть и во второй организации — проверка выбора организации
  await mk(other, "clerk", "Бухгалтер Петрова (другая орг.)", ["warehouse_manager"])

  // Персональный токен WMS для интеграции (таблица WMS, формат хеша как в lib/wms/user-api-tokens.ts)
  await sql(`CREATE TABLE wms_user_api_tokens (token_id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES wms_users(user_id) ON DELETE CASCADE,
     name TEXT NOT NULL, token_prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)`)
  await sql(`INSERT INTO wms_user_api_tokens (user_id, name, token_prefix, token_hash) VALUES ($1, 'scada-edi', $2, $3)`, [
    users.wmsService,
    WMS_TOKEN.slice(0, 12),
    createHash("sha256").update(WMS_TOKEN).digest("hex"),
  ])

  // Номенклатура WMS: штрихкод, алиас поставщика, позиция без связи
  const item = async (code: string, name: string, sku: string | null) =>
    (await sql(`INSERT INTO wms_items (site_id, item_code, name, sku, uom_code, item_type_code) VALUES ($1,$2,$3,$4,'pcs','goods') RETURNING item_id`, [siteId, code, name, sku])).rows[0].item_id
  const water = await item("WATER-05", "Вода питьевая негазированная 0,5 л", "W05")
  const cap = await item("CAP-28", "Крышка ПЭТ 28 мм синяя", "C28")
  await item("LBL-05", "Этикетка вода 0,5", "L05")
  await item("PALLET-EUR", "Поддон EUR 1200x800", "PAL")
  await sql(`INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary) VALUES ($1, '4600000000017', 'EAN13', TRUE)`, [water])
  await sql(`INSERT INTO wms_item_aliases (site_id, item_id, supplier_code, supplier_name, alias_name, alias_sku, source) VALUES ($1, $2, 'POST-TEST', $3, 'Крышка 28мм синяя', 'K-28', 'manual')`, [siteId, cap, SELLER.name])
  await sql(`INSERT INTO wms_suppliers (site_id, supplier_code, name, tax_id, meta_json) VALUES ($1, 'POST-TEST', 'Поставщик-Тест', $2, $3::jsonb)`, [
    siteId,
    SELLER.inn,
    JSON.stringify({ legalName: SELLER.name, kpp: SELLER.kpp, bankBik: "044525000", bankAccount: "40702810900000000001" }),
  ])
  await sql(`INSERT INTO wms_stock_balances (site_id, item_id, available_qty) VALUES ($1, $2, 500)`, [siteId, water])

  // EDI: схема, справочники, тариф, реквизиты своей организации, интеграция с WMS
  await ensureEdiSchema(db)
  await seedReference(db)
  await sql(`INSERT INTO edi_subscriptions (site_id, plan_code) VALUES ($1, 'enterprise')`, [siteId])
  await sql(`INSERT INTO edi_org_settings (site_id, legal_name, inn, kpp) VALUES ($1, $2, $3, $4)`, [siteId, BUYER.name, BUYER.inn, BUYER.kpp])
  await sql(`INSERT INTO edi_user_roles (site_id, user_id, role_code) VALUES ($1, $2, 'edi_admin'), ($1, $2, 'edi_signer'), ($1, $2, 'edi_approver')`, [siteId, users.boss])
  await saveIntegration(db, siteId, users.boss, { kind: "wms", provider: "scada-wms", name: "SCADA WMS", config: { baseUrl: WMS_URL, siteCode: "" }, secret: WMS_TOKEN, isEnabled: true })

  process.env.EDI_STORAGE_DIR = mkdtempSync(join(tmpdir(), "edi-e2e-storage-"))
  process.env.EDI_WMS_TIMEOUT_MS = "120000"

  // Реальный WMS из корня репозитория на этой же тестовой базе
  wms = spawn("npx", ["next", "dev", "--webpack", "-p", String(WMS_PORT), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `${PG}/${DB}?sslmode=disable`, WMS_DISABLE_DEV_PROXY: "1", WMS_AUTH_SECRET: "e2e-secret", PORT: String(WMS_PORT), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  let log = ""
  wms.stdout?.on("data", (d) => (log += d))
  wms.stderr?.on("data", (d) => (log += d))
  try {
    await waitFor(`${WMS_URL}/api/wms/items?siteCode=skeet&limit=1`, 300_000)
    // прогрев: в dev-режиме Next компилирует каждый маршрут при первом обращении
    for (const p of ["/api/wms/lookup?siteCode=skeet&query=1", "/api/wms/item-aliases/search?siteCode=skeet&query=xx", "/api/wms/directories/suppliers?siteCode=skeet", "/api/wms/receiving/stock-posts?siteCode=skeet", "/api/wms/receiving/inbound?siteCode=skeet&documentId=X"]) {
      await fetch(`${WMS_URL}${p}`, { headers: { Authorization: `Bearer ${WMS_TOKEN}` }, signal: AbortSignal.timeout(180_000) })
    }
  } catch (e) {
    console.error(log.slice(-4000))
    throw e
  }
})

after(async () => {
  if (wms?.pid) {
    try {
      process.kill(-wms.pid, "SIGTERM")
    } catch {
      /* уже завершён */
    }
  }
  db?.release()
  await pool?.end()
})

let documentId = ""
let originalSha = ""
const shipped = [
  { name: "Вода питьевая 0,5 л", code: "V-05", gtin: "04600000000017", okei: "796", uom: "шт", qty: 120, price: 25, vat: "20%" as const },
  { name: "Крышка 28мм синяя", code: "K-28", okei: "796", uom: "шт", qty: 1000, price: 1.2, vat: "20%" as const },
  { name: "Этикетка самоклеящаяся «Вода 0,5»", code: "ET-05-NEW", okei: "796", uom: "шт", qty: 500, price: 0.8, vat: "20%" as const },
]

test("вход: общая учётная запись WMS, выбор организации, без ролей — нет доступа", async () => {
  const r = await passwordLogin(db, { login: "clerk", password: "secret-pass" })
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.session.orgs.length, 2, "у пользователя две организации")
    assert.equal(r.session.siteCode, "skeet")
  }
  const r2 = await passwordLogin(db, { login: "clerk", password: "secret-pass", siteCode: "other" })
  assert.ok(r2.ok && r2.session.siteCode === "other")
  assert.equal((await passwordLogin(db, { login: "clerk", password: "bad" })).ok, false)
  const noAccess = await passwordLogin(db, { login: "line", password: "secret-pass" })
  assert.equal(noAccess.ok, false, "оператор линии без ролей EDI не входит")
})

test("контрагенты из WMS связываются по ИНН, а не дублируются вслепую", async () => {
  const clerk = await as("clerk")
  const r = await tx(() => linkWmsSuppliers(db, clerk))
  assert.deepEqual([r.created, r.linked], [1, 0])
  const again = await tx(() => linkWmsSuppliers(db, clerk))
  assert.deepEqual([again.created, again.linked], [0, 0], "повторная синхронизация ничего не дублирует")
  const cp = (await sql(`SELECT inn, kpp, wms_supplier_code, bank_bik FROM edi_counterparties WHERE site_id = $1`, [siteId])).rows
  assert.deepEqual(cp, [{ inn: SELLER.inn, kpp: SELLER.kpp, wms_supplier_code: "POST-TEST", bank_bik: "044525000" }])
})

test("1–6. УПД 5.03 (cp1251, с подписью): приём, контрагент, строки, сопоставление, расхождения, проверка", async () => {
  const clerk = await as("clerk")
  const xml = encodeCp1251(buildUpd({ number: "УТ-2026-0915", date: "15.09.2026", seller: SELLER, buyer: BUYER, lines: shipped, basis: { name: "Договор поставки", number: "Д-17", date: "10.01.2026" } }))
  originalSha = createHash("sha256").update(xml).digest("hex")
  // откреплённая подпись поставщика в том же архиве (как пакет оператора ЭДО)
  const dir = mkdtempSync(join(tmpdir(), "edi-e2e-sig-"))
  writeFileSync(join(dir, "upd.xml"), xml)
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "30", "-subj", "/CN=Иванов Иван Иванович/O=ООО Поставщик-Тест", "-utf8"], { stdio: "ignore" })
  execFileSync("openssl", ["cms", "-sign", "-binary", "-in", join(dir, "upd.xml"), "-signer", join(dir, "c.pem"), "-inkey", join(dir, "k.pem"), "-outform", "DER", "-out", join(dir, "upd.xml.sig")], { stdio: "ignore" })
  const { zipSync } = await import("fflate")
  const zip = zipSync({ "ON_NSCHFDOPPR_upd.xml": xml, "ON_NSCHFDOPPR_upd.xml.sig": new Uint8Array(readFileSync(join(dir, "upd.xml.sig"))) })

  const [imp] = await tx(() => ingestFiles(db, clerk, [{ name: "from-supplier.zip", bytes: zip }]))
  // 1. принят, оригинал сохранён без изменений
  const stored = (await sql(`SELECT sha256, kind FROM edi_files WHERE file_id = $1::bigint`, [imp.fileId])).rows[0]
  assert.equal(stored.sha256, originalSha)
  assert.equal(imp.parsed.signatureFileIds.length, 1, "подпись сопоставлена с файлом")
  // 2. контрагент определён по ИНН/КПП
  assert.equal(imp.parsed.counterparty?.name, SELLER.name)
  assert.equal(imp.parsed.sourceKind, "fns_upd")
  assert.equal(imp.parsed.formatCode, "fns_upd_5_03")
  // 3. строки извлечены
  assert.equal(imp.parsed.lines.length, 3)
  // 4. сопоставление: GTIN → штрихкод WMS, код поставщика → алиас WMS, новая позиция — без автоподстановки
  const [l1, l2, l3] = imp.parsed.lines
  assert.deepEqual([l1.itemCode, l1.matchSource], ["WATER-05", "gtin"])
  assert.deepEqual([l2.itemCode, l2.matchSource], ["CAP-28", "alias_sku"])
  assert.equal(l3.itemCode, null)
  assert.ok(l3.candidates.some((c) => c.itemCode === "LBL-05"), "предложен кандидат по названию")
  // 5. расхождения показаны
  assert.ok(imp.issues.some((i) => i.code === "unmatched"))
  assert.ok(!imp.issues.some((i) => i.code === "buyer_mismatch"), "покупатель — наша организация")
  assert.equal(imp.status, "parsed")
  // 6. пользователь проверяет и вручную сопоставляет третью строку
  const upd = await tx(() => updateImport(db, clerk, imp.importId, { lines: [{ lineNo: 3, itemCode: "LBL-05", itemName: "Этикетка вода 0,5" }] }))
  assert.ok(!upd.issues.some((i) => i.code === "unmatched"))

  // 7. подтверждение: документ + заказ на приход в WMS; остатки WMS не меняются
  const stockBefore = (await sql(`SELECT COALESCE(sum(available_qty),0)::text AS s FROM wms_stock_balances WHERE site_id = $1`, [siteId])).rows[0].s
  const res = await tx(() => confirmImport(db, clerk, imp.importId, { saveMappings: true, createWmsReceipt: true }))
  documentId = res.documentId
  assert.equal(res.wmsReceipt && "inboundId" in res.wmsReceipt ? res.wmsReceipt.inboundId : res.wmsReceipt, `EDI-${documentId}`)
  const stockAfter = (await sql(`SELECT COALESCE(sum(available_qty),0)::text AS s FROM wms_stock_balances WHERE site_id = $1`, [siteId])).rows[0].s
  assert.equal(stockAfter, stockBefore, "простое получение УПД не двигает остатки")
  const inbound = await (await fetch(`${WMS_URL}/api/wms/receiving/inbound?siteCode=skeet&documentId=EDI-${documentId}`, { headers: { Authorization: `Bearer ${WMS_TOKEN}` } })).json()
  assert.deepEqual(
    inbound.inbound.lines.map((l: { itemCode: string; expectedQty: number }) => [l.itemCode, l.expectedQty]),
    [["WATER-05", 120], ["CAP-28", 1000], ["LBL-05", 500]]
  )
  // ручное сопоставление запомнено в EDI и создано алиасом в WMS
  const mapping = (await sql(`SELECT item_code FROM edi_item_mappings WHERE supplier_inn = $1 AND supplier_key = 'code:et-05-new'`, [SELLER.inn])).rows[0]
  assert.equal(mapping?.item_code, "LBL-05")
  const alias = (await sql(`SELECT alias_sku, source FROM wms_item_aliases a JOIN wms_items i ON i.item_id = a.item_id WHERE i.item_code = 'LBL-05'`)).rows[0]
  assert.deepEqual(alias, { alias_sku: "ET-05-NEW", source: "scada-edi" })
  const doc = await getDocument(db, clerk, documentId)
  assert.deepEqual([doc.status, doc.wmsStatus, doc.exchangeStatus, doc.amountTotal], ["received", "draft_created", "none", "5520.00"])
})

test("повторная загрузка того же файла распознаётся, сохранённое сопоставление применяется", async () => {
  const clerk = await as("clerk")
  const xml = encodeCp1251(buildUpd({ number: "УТ-2026-0916", date: "16.09.2026", seller: SELLER, buyer: BUYER, lines: [shipped[2]] }))
  const [imp] = await tx(() => ingestFiles(db, clerk, [{ name: "next.xml", bytes: xml }]))
  assert.deepEqual([imp.parsed.lines[0].itemCode, imp.parsed.lines[0].matchSource], ["LBL-05", "mapping"])
  const dupXml = encodeCp1251(buildUpd({ number: "УТ-2026-0915", date: "15.09.2026", seller: SELLER, buyer: BUYER, lines: shipped, basis: { name: "Договор поставки", number: "Д-17", date: "10.01.2026" } }))
  const [dup] = await tx(() => ingestFiles(db, clerk, [{ name: "again.xml", bytes: dupXml }]))
  assert.ok(dup.issues.some((i) => i.code === "duplicate"), "номер и дата уже есть у контрагента")
  assert.ok(dup.issues.some((i) => i.code === "already_imported"), "тот же файл (хеш) уже загружен")
})

test("8–10. склад проводит приёмку, факт связывается с УПД, статус и расхождения в EDI", async () => {
  const clerk = await as("clerk")
  // 8. проведение на ТСД (формат записи WMS finalizeReceivingSession): воды пришло 118 вместо 120
  await sql(
    `INSERT INTO wms_code_lists (request_id, site_id, device_uid, list_type, entries_json) VALUES ($1::uuid, $2, 'TSD-01', 'receiving_stock_post', $3::jsonb)`,
    [
      randomUUID(),
      siteId,
      JSON.stringify([
        {
          kind: "code",
          code: `EDI-${documentId}`,
          documentId: `EDI-${documentId}`,
          scannedAtIso: new Date().toISOString(),
          note: "posted:3:OS-RECV-ST01-S01-P01-B01",
          qty: 1618,
          postedLines: [
            { itemCode: "WATER-05", qty: 118, emissionDay: "2026-09-15" },
            { itemCode: "CAP-28", qty: 1000, emissionDay: "2026-09-15" },
            { itemCode: "LBL-05", qty: 500, emissionDay: "2026-09-15" },
          ],
        },
      ]),
    ]
  )
  // 9. фоновая сверка читает проведения через API WMS
  const sync = await tx(() => syncPendingReceipts(db, siteId, "skeet"))
  assert.deepEqual([sync.checked, sync.changed, sync.error], [1, 1, undefined])
  // 10. актуальный статус и расхождения в карточке
  const d = await documentDetail(db, clerk, documentId)
  assert.equal(d.document.wmsStatus, "received_with_discrepancies")
  const link = d.links.find((l) => l.system === "wms")
  const water = (link.payload.comparison as Array<{ itemCode: string; diff: number }>).find((c) => c.itemCode === "WATER-05")
  assert.equal(water?.diff, -2)
  assert.ok(d.actions.some((a) => a.key === "discrepancy_act"))
  assert.ok(d.history.some((h) => h.action === "wms.receipt_synced"))
  const note = (await sql(`SELECT event, title FROM edi_notifications WHERE user_id = $1::bigint AND document_id = $2::bigint`, [users.clerk, documentId])).rows
  assert.ok(note.some((n) => n.event === "wms.discrepancy"))
  // поиск по связанному складскому документу
  const found = await listDocuments(db, clerk, { q: `EDI-${documentId}` })
  assert.ok(found.rows.some((r) => r.documentId === documentId))
  // акт расхождений по факту приёмки, связанный с УПД
  const act = await tx(() => createDiscrepancyAct(db, clerk, documentId))
  const actDoc = await documentDetail(db, clerk, act.documentId)
  assert.equal(actDoc.lines.length, 1)
  assert.deepEqual([actDoc.lines[0].itemCode, actDoc.lines[0].qty], ["WATER-05", 2])
  assert.ok(actDoc.relations.some((r) => r.documentId === documentId && r.kind === "basis"))
})

test("11. согласование и подпись: маршрут, решение, подпись только криптографическим файлом; ЭДО без оператора не предлагается", async () => {
  const boss = await as("boss")
  const clerk = await as("clerk")
  const preset = ROUTE_PRESETS.find((p) => p.code === "incoming_invoice")!
  await tx(() => saveDefinition(db, boss, { code: preset.code, name: preset.name, docTypes: preset.docTypes, definition: preset.definition }))
  const started = await tx(() => startWorkflow(db, clerk, documentId))
  assert.equal(started.state, "running")
  // шаг 1 — ответственный (clerk), шаг 2 — роль edi_approver (clerk и boss по ролям WMS/EDI)
  const t1 = (await sql(`SELECT task_id::text FROM edi_tasks WHERE document_id = $1::bigint AND status = 'pending'`, [documentId])).rows
  assert.equal(t1.length, 1)
  await assert.rejects(tx(() => decide(db, boss, t1[0].task_id, "approve")), /другому сотруднику/)
  await tx(() => decide(db, clerk, t1[0].task_id, "approve", "Проверено, расхождение оформлено актом"))
  const t2 = (await sql(`SELECT task_id::text, assignee_user_id::text FROM edi_tasks WHERE document_id = $1::bigint AND status = 'pending'`, [documentId])).rows
  assert.ok(t2.length >= 1)
  // делегирование: директор передаёт согласование кладовщику (роль только «просмотр»)
  const bossTask = t2.find((t) => t.assignee_user_id === users.boss)!
  await tx(() => createDelegation(db, boss, { toUserId: users.storekeeper, scope: "approval" }))
  const store = await as("storekeeper")
  const res = await tx(() => decide(db, store, bossTask.task_id, "approve", "За директора"))
  assert.equal(res.state, "approved")
  const done = (await sql(`SELECT on_behalf_of::text, completed_by_name FROM edi_tasks WHERE task_id = $1::bigint`, [bossTask.task_id])).rows[0]
  assert.deepEqual(done, { on_behalf_of: users.boss, completed_by_name: "Кладовщик Орлов" })
  let doc = await getDocument(db, clerk, documentId)
  assert.equal(doc.status, "approved")

  const detail = await documentDetail(db, boss, documentId)
  assert.ok(!detail.actions.some((a) => a.key === "send_edo"), "нет проверенного оператора — нет кнопки")
  assert.ok(detail.actions.some((a) => a.key === "sign"))
  // подпись — файл CMS, созданный криптографическим ПО (здесь OpenSSL вместо КриптоПро)
  const original = detail.files.find((f) => f.kind === "original")!
  const dir = mkdtempSync(join(tmpdir(), "edi-e2e-own-"))
  const bytes = readFileSync(join(process.env.EDI_STORAGE_DIR!, "edi", String(siteId), originalSha.slice(0, 2), originalSha))
  writeFileSync(join(dir, "doc"), bytes)
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "30", "-subj", "/CN=Сидоров Директор/O=ООО Скеэт", "-utf8"], { stdio: "ignore" })
  execFileSync("openssl", ["cms", "-sign", "-binary", "-in", join(dir, "doc"), "-signer", join(dir, "c.pem"), "-inkey", join(dir, "k.pem"), "-outform", "DER", "-out", join(dir, "doc.sig")], { stdio: "ignore" })
  const sig = await tx(() => addOwnSignature(db, boss, documentId, { fileId: original.fileId, signatureBytes: new Uint8Array(readFileSync(join(dir, "doc.sig"))) }))
  assert.equal(sig.info.signerName, "Сидоров Директор")
  assert.equal(sig.check.status, "not_verified", "без сервиса проверки ГОСТ подпись честно не считается проверенной")
  doc = await getDocument(db, clerk, documentId)
  assert.deepEqual([doc.status, doc.signedVersion], ["signed", 1])
  // подписанная версия неизменна
  await assert.rejects(tx(() => updateDocument(db, clerk, documentId, { title: "Подмена" })), /нельзя изменить|неизменна/)
  const v = (await sql(`SELECT locked FROM edi_document_versions WHERE document_id = $1::bigint AND version_no = 1`, [documentId])).rows[0]
  assert.equal(v.locked, true)
  const sigs = (await sql(`SELECT side, verification_status FROM edi_signatures WHERE document_id = $1::bigint ORDER BY signature_id`, [documentId])).rows
  assert.deepEqual(sigs.map((s) => s.side), ["counterparty", "own"])
})

test("12. завершение и архив: оригинал, подписи, история и манифест с хешами", async () => {
  const clerk = await as("clerk")
  await tx(() => setStatus(db, clerk, documentId, "completed"))
  await tx(() => archiveDocument(db, clerk, documentId))
  const archived = await listDocuments(db, clerk, { folder: "archive" })
  assert.ok(archived.rows.some((r) => r.documentId === documentId))
  const { zip } = await tx(() => exportArchive(db, clerk, [documentId]))
  const files = unzipSync(zip)
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]))
  const orig = manifest.files.find((f: { kind: string }) => f.kind === "original")
  assert.equal(orig.sha256, originalSha, "оригинал выгружен побайтно")
  assert.equal(createHash("sha256").update(files[orig.path]).digest("hex"), originalSha)
  assert.equal(manifest.files.filter((f: { kind: string }) => f.kind === "signature").length, 2)
  assert.ok(manifest.files.some((f: { kind: string }) => f.kind === "history"))
})

test("изоляция организаций и права: чужая организация и роль без прав не видят и не меняют", async () => {
  const outsider = await actorForUser(db, (await sql(`SELECT site_id FROM wms_sites WHERE site_code='other'`)).rows[0].site_id, users.outsider)
  await assert.rejects(getDocument(db, outsider, documentId), /не найден/)
  const list = await listDocuments(db, outsider, { folder: "all" })
  assert.equal(list.total, 0)
  const store = await as("storekeeper")
  await assert.rejects(tx(() => createDocument(db, store, { docType: "memo", direction: "internal", fields: { addressee: "x", body: "y" } })), /Недостаточно прав/)
  // конфиденциальный документ виден автору и аудитору, но не просто читателю
  const clerk = await as("clerk")
  const conf = await tx(() => createDocument(db, clerk, { docType: "memo", direction: "internal", confidential: true, fields: { addressee: "Директору", body: "Зарплатная ведомость" } }))
  await assert.rejects(getDocument(db, store, conf.documentId), /не найден/)
  assert.equal((await getDocument(db, clerk, conf.documentId)).documentId, conf.documentId)
})

test("создание документа: нумерация, валидация контрагента, версия при изменении на доработке", async () => {
  const clerk = await as("clerk")
  await assert.rejects(tx(() => createCounterparty(db, clerk, { name: "Плохой ИНН", inn: "1234567890" })), /контрольной суммы/)
  const cp = await tx(() => createCounterparty(db, clerk, { name: 'ООО "Покупатель"', inn: "7803030005", kpp: "780301001", roles: ["customer"] }))
  const inv = await tx(() =>
    createDocument(db, clerk, {
      docType: "invoice",
      direction: "outgoing",
      counterpartyId: cp.id,
      fields: { paymentDue: "2026-10-30" },
      lines: [{ name: "Вода 0,5", itemCode: "WATER-05", qty: 10, price: 30, vatRate: "20%" }],
    })
  )
  assert.equal(inv.number, "1")
  assert.equal(inv.amountTotal, "360.00")
  const inv2 = await tx(() => createDocument(db, clerk, { docType: "invoice", direction: "outgoing", counterpartyId: cp.id, lines: [{ name: "x", qty: 1, price: 1 }] }))
  assert.equal(inv2.number, "2")
  // черновик меняется без новой версии; после возврата на доработку — новая версия с причиной
  await tx(() => updateDocument(db, clerk, inv.documentId, { lines: [{ name: "Вода 0,5", itemCode: "WATER-05", qty: 12, price: 30, vatRate: "20%" }] }))
  assert.equal((await getDocument(db, clerk, inv.documentId)).currentVersion, 1)
  await sql(`UPDATE edi_documents SET status = 'rework' WHERE document_id = $1::bigint`, [inv.documentId])
  await assert.rejects(tx(() => updateDocument(db, clerk, inv.documentId, { basis: "Заказ 5" })), /причину/)
  const v2 = await tx(() => updateDocument(db, clerk, inv.documentId, { basis: "Заказ 5", reason: "Уточнено основание" }))
  assert.equal(v2.currentVersion, 2)
  const hashes = (await sql(`SELECT content_hash FROM edi_document_versions WHERE document_id = $1::bigint ORDER BY version_no`, [inv.documentId])).rows
  assert.equal(hashes.length, 2)
  assert.notEqual(hashes[0].content_hash, hashes[1].content_hash)
})

test("сроки и эскалация, фоновый исполнитель, доставка уведомления в WMS", async () => {
  const clerk = await as("clerk")
  const memo = await tx(() => createDocument(db, clerk, { docType: "memo", direction: "internal", fields: { addressee: "Директору", body: "Прошу согласовать закупку" } }))
  const boss = await as("boss")
  const preset = ROUTE_PRESETS.find((p) => p.code === "internal")!
  await tx(() => saveDefinition(db, boss, { code: preset.code, name: preset.name, docTypes: preset.docTypes, definition: preset.definition }))
  await tx(() => startWorkflow(db, clerk, memo.documentId))
  // параллельный этап: две задачи сразу
  const pending = (await sql(`SELECT count(DISTINCT step_index)::int AS n FROM edi_tasks WHERE document_id = $1::bigint AND status = 'pending'`, [memo.documentId])).rows[0]
  assert.equal(pending.n, 2)
  await sql(`UPDATE edi_tasks SET due_at = now() - interval '1 hour' WHERE document_id = $1::bigint AND status = 'pending'`, [memo.documentId])
  const r1 = await tx(() => processDeadlines(db))
  assert.ok(r1.overdue >= 1)
  const r2 = await tx(() => processDeadlines(db))
  assert.equal(r2.overdue, 0, "повторная проверка не спамит")
  const d = await dashboard(db, boss)
  assert.ok(d.counts.overdue >= 1)
  // фоновый такт доставляет уведомления в колокольчик SCADA через API WMS
  const tick = await runTick(pool)
  assert.ok(Number(tick.delivered) >= 1, JSON.stringify(tick))
  const wmsNotes = (await sql(`SELECT title FROM wms_notifications`)).rows
  assert.ok(wmsNotes.some((n) => String(n.title).startsWith("EDI:")))
})

test("недоступность WMS не ломает EDI: загрузка проходит, сопоставление честно недоступно", async () => {
  const clerk = await as("clerk")
  await sql(`UPDATE edi_integrations SET config = jsonb_set(config, '{baseUrl}', '"http://127.0.0.1:9"') WHERE site_id = $1 AND kind = 'wms'`, [siteId])
  try {
    const xml = encodeCp1251(buildUpd({ number: "УТ-OFFLINE", date: "20.09.2026", seller: SELLER, buyer: BUYER, lines: [{ name: "Новый товар", code: "NEW-1", okei: "796", uom: "шт", qty: 1, price: 1, vat: "20%" }] }))
    const [imp] = await tx(() => ingestFiles(db, clerk, [{ name: "offline.xml", bytes: xml }]))
    assert.equal(imp.parsed.wmsAvailable, false)
    assert.ok(imp.issues.some((i) => i.code === "wms_unavailable"))
    const res = await tx(() => confirmImport(db, clerk, imp.importId, { createWmsReceipt: true }))
    assert.ok(res.documentId)
    assert.ok(res.wmsReceipt && "error" in res.wmsReceipt, "заказ на приход не создан, документ сохранён")
  } finally {
    await sql(`UPDATE edi_integrations SET config = jsonb_set(config, '{baseUrl}', to_jsonb($2::text)) WHERE site_id = $1 AND kind = 'wms'`, [siteId, WMS_URL])
  }
})
