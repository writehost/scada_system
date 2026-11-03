/**
 * Сценарии приёмки SCADA System Route (ТЗ, раздел 16) на настоящих обработчиках API
 * Route (yms-app) и интеграционного слоя WMS (основное приложение) и на настоящем PostgreSQL.
 *
 * Запуск: node --test tests/route/acceptance.test.mjs
 * Требуется: локальный PostgreSQL (ROUTE_TEST_PG, по умолчанию postgres://postgres@127.0.0.1:55432), psql, tsx.
 */
import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { spawn, execFileSync } from "node:child_process"
import { createHash, createHmac, generateKeyPairSync, randomUUID, createSign, scryptSync, randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const YMS = path.resolve(HERE, "../..")
const REPO = path.resolve(YMS, "..")
const PG = process.env.ROUTE_TEST_PG || "postgres://postgres@127.0.0.1:55432"
const DB = "route_acceptance"
const DB_URL = `${PG}/${DB}`
const TSX = process.env.TSX_BIN || "tsx"
const SECRET = "route-test-secret"
const YMS_PORT = 3914
const WMS_PORT = 3904
const JWKS_PORT = 3990
const SVC_TOKEN = "wmsu_route_service_test_token_0001"
const TMP = mkdtempSync(path.join(os.tmpdir(), "route-acc-"))

function psql(sql, db = DB) {
  return execFileSync("psql", [`${PG}/${db}`, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql], { encoding: "utf8" }).trim()
}
function psqlFile(file, db = DB) {
  execFileSync("psql", [`${PG}/${db}`, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { encoding: "utf8" })
}

/* ---------- данные ---------- */

function gs1(d17) {
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(d17[16 - i]) * (i % 2 === 0 ? 3 : 1)
  return d17 + ((10 - (sum % 10)) % 10)
}
const SSCC = {
  P1: "00" + gs1("46000000000000001"),
  P2: "00" + gs1("46000000000000002"),
  P3: "00" + gs1("46000000000000003"),
  P4: "00" + gs1("46000000000000004"),
  P5: "00" + gs1("46000000000000005"),
  P6: "00" + gs1("46000000000000006"),
  P7: "00" + gs1("46000000000000007"),
}

function passwordHash(pw) {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString("base64")}:${scryptSync(pw, salt, 64).toString("base64")}`
}

function seedSql() {
  const sha = (s) => createHash("sha256").update(s).digest("hex")
  const pallet = (key, item, lot, loc, site = 1, units = 3) => {
    const d = SSCC[key].slice(2)
    return `
    WITH p AS (INSERT INTO codes (ai01_gtin, ai21_serial, raw, lot_id)
      VALUES ('00${d.slice(0, 12)}', '${d}', convert_to('${SSCC[key]}', 'UTF8'), (SELECT lot_id FROM wms_lots WHERE lot_code = '${lot}')) RETURNING code_id)
    INSERT INTO wms_item_codes (code_id, item_id, current_site_id, current_location_id, pack_level)
      SELECT code_id, (SELECT item_id FROM wms_items WHERE item_code = '${item}'), ${site},
             (SELECT location_id FROM wms_locations WHERE location_code = '${loc}' AND site_id = ${site}), 'pallet' FROM p;
    DO $$ DECLARE pid BIGINT; bid BIGINT; uid BIGINT; i INT; j INT; BEGIN
      SELECT c.code_id INTO pid FROM codes c WHERE c.ai21_serial = '${d}';
      FOR i IN 1..2 LOOP
        INSERT INTO codes (ai01_gtin, ai21_serial, parent_code_id) VALUES ('0460000000' || i, '${key}-B' || i, pid) RETURNING code_id INTO bid;
        INSERT INTO wms_item_codes (code_id, item_id, current_site_id, current_location_id, pack_level)
          VALUES (bid, (SELECT item_id FROM wms_items WHERE item_code = '${item}'), ${site}, (SELECT location_id FROM wms_locations WHERE location_code = '${loc}' AND site_id = ${site}), 'block');
        FOR j IN 1..${units} LOOP
          INSERT INTO codes (ai01_gtin, ai21_serial, parent_code_id) VALUES ('0460000000999', '${key}-B' || i || '-U' || j, bid) RETURNING code_id INTO uid;
          INSERT INTO wms_item_codes (code_id, item_id, current_site_id, current_location_id, pack_level)
            VALUES (uid, (SELECT item_id FROM wms_items WHERE item_code = '${item}'), ${site}, (SELECT location_id FROM wms_locations WHERE location_code = '${loc}' AND site_id = ${site}), 'unit');
        END LOOP;
      END LOOP;
    END $$;`
  }
  const loc = (code, attrs = { fgRow: true, planCapacity: 51 }, status = 1, site = 1) =>
    `INSERT INTO wms_locations (site_id, location_code, display_name, location_status_id, location_attrs_json) VALUES (${site}, '${code}', '${code}', ${status}, '${JSON.stringify(attrs)}'::jsonb);`
  return `
  INSERT INTO wms_sites (site_code, name) VALUES ('skeet', 'Скеэт'), ('other', 'Другая площадка');
  INSERT INTO wms_roles (code, name) VALUES ('admin','Админ'),('warehouse_manager','Начальник'),('warehouse_operator','Кладовщик'),
    ('auditor','Ревизор'),('route_driver','Водитель'),('route_senior_driver','Старший водитель'),('route_dispatcher','Диспетчер'),
    ('route_admin','Админ карты'),('route_service','Сервис Route');
  INSERT INTO wms_permissions (code, name) VALUES ('wms.stock.transfer', 'Перемещение');
  INSERT INTO wms_role_permissions SELECT r.role_id, p.permission_id FROM wms_roles r, wms_permissions p WHERE r.code = 'route_service';
  INSERT INTO wms_users (site_id, login, display_name, position, password_hash) VALUES
    (1,'driver1','Иванов И.','Карщик','${passwordHash("pass1")}'),
    (1,'driver2','Петров П.','Карщик',NULL),
    (1,'senior','Сидоров С.','Старший карщик',NULL),
    (1,'disp','Диспетчер Д.','Диспетчер',NULL),
    (1,'mapadmin','Картограф К.','Админ',NULL),
    (1,'viewer','Ревизор Р.','Ревизор',NULL),
    (2,'outsider','Чужой Ч.','Карщик',NULL),
    (1,'route-svc','Сервис Route','Сервис',NULL),
    (1,'oidcdriver@skeet.ru','Водитель SCADA ID','Карщик',NULL);
  INSERT INTO wms_user_roles SELECT u.user_id, r.role_id FROM wms_users u JOIN wms_roles r ON
    (u.login IN ('driver1','driver2','outsider','oidcdriver@skeet.ru') AND r.code='route_driver') OR (u.login='senior' AND r.code='route_senior_driver')
    OR (u.login='disp' AND r.code='route_dispatcher') OR (u.login='mapadmin' AND r.code='route_admin')
    OR (u.login='viewer' AND r.code='auditor') OR (u.login='route-svc' AND r.code='route_service');
  CREATE TABLE IF NOT EXISTS wms_user_api_tokens (token_id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES wms_users(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL, token_prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ);
  INSERT INTO wms_user_api_tokens (user_id, name, token_prefix, token_hash)
    SELECT user_id, 'route', '${SVC_TOKEN.slice(0, 12)}', '${sha(SVC_TOKEN)}' FROM wms_users WHERE login = 'route-svc';

  INSERT INTO wms_items (site_id, item_code, name) VALUES (1,'ITEM-1','Сок яблочный 1 л'), (1,'ITEM-2','Вода 0,5 л');
  INSERT INTO wms_lots (site_id, item_id, lot_code, expiry_at) VALUES
    (1, 1, 'L-001', '2027-01-01'), (1, 1, 'L-002', '2026-12-01'), (1, 2, 'L-100', '2027-06-01');
  ${loc("FG-A-1")} ${loc("FG-A-2")} ${loc("FG-A-31")} ${loc("FG-A-32")} ${loc("FG-B-5")} ${loc("FG-A-34")}
  ${loc("FG-A-40", { fgRow: true, planCapacity: 1 })}
  ${loc("FG-A-41", { fgRow: true, planCapacity: 51 }, 2)}
  ${loc("LINE-SIPA", { line: "SIPA" })}
  ${loc("FG-A-1", { fgRow: true }, 1, 2)}
  ${pallet("P1", "ITEM-1", "L-001", "FG-A-1")}
  ${pallet("P2", "ITEM-1", "L-002", "FG-A-2")}
  ${pallet("P3", "ITEM-1", "L-001", "FG-A-41")}
  ${pallet("P4", "ITEM-2", "L-100", "FG-A-40")}
  ${pallet("P5", "ITEM-2", "L-100", "LINE-SIPA")}
  ${pallet("P6", "ITEM-1", "L-001", "FG-A-1")}
  ${pallet("P7", "ITEM-1", "L-001", "FG-A-1", 2)}
  INSERT INTO wms_stock_balances (site_id, location_id, item_id, available_qty)
    VALUES (1, (SELECT location_id FROM wms_locations WHERE site_id = 1 AND location_code='FG-A-1'), 1, 12);
  INSERT INTO wms_stock_lots (balance_id, lot_id, lot_code, available_qty) VALUES (1, 1, 'L-001', 12);
  INSERT INTO wms_tasks (site_id, task_type_id, task_status_id, task_priority_id, task_code, source_location_id, target_location_id, task_payload)
    VALUES (1, 4, 1, 3, 'WMS-TR-1', (SELECT location_id FROM wms_locations WHERE site_id=1 AND location_code='FG-A-1'),
            (SELECT location_id FROM wms_locations WHERE site_id=1 AND location_code='FG-A-32'), '{"palletCode":"${SSCC.P1}"}'::jsonb);
  `
}

/* ---------- инфраструктура ---------- */

const procs = []
function startHarness(name, tsconfig, root, prefix, port, env, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(TSX, ["--tsconfig", tsconfig, path.join(HERE, "harness/serve.ts"), "--root", root, "--prefix", prefix, "--port", String(port)], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    const timer = setTimeout(() => reject(new Error(`${name} не стартовал: ${out}`)), 30000)
    p.stdout.on("data", (d) => {
      out += d
      if (String(d).includes("harness")) {
        clearTimeout(timer)
        resolve(p)
      }
    })
    p.stderr.on("data", (d) => {
      out += d
      if (process.env.ROUTE_TEST_VERBOSE) process.stderr.write(`[${name}] ${d}`)
    })
    p.on("exit", (code) => {
      if (code && code !== 0 && process.env.ROUTE_TEST_VERBOSE) console.error(`${name} exit ${code}: ${out}`)
    })
    procs.push(p)
  })
}

let wmsProc = null
const COMMON_ENV = { DATABASE_URL: DB_URL, NODE_ENV: "test", WMS_AUTH_SECRET: SECRET, WMS_SITE_CODE: "skeet" }
async function startWms() {
  wmsProc = await startHarness("wms", path.join(HERE, "tsconfig.wms.json"), path.join(REPO, "app/api/wms/route"), "/api/wms/route", WMS_PORT, COMMON_ENV, REPO)
}
function stopWms() {
  return new Promise((resolve) => {
    if (!wmsProc) return resolve()
    wmsProc.once("exit", () => resolve())
    wmsProc.kill("SIGTERM")
    wmsProc = null
  })
}

/* SCADA ID (OIDC): локальный издатель с JWKS */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" }
const ISSUER = `http://127.0.0.1:${JWKS_PORT}/realms/scada-system-id`
let jwksServer
function b64u(obj) {
  return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64url")
}
function oidcToken(claims) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u({ alg: "RS256", kid: "test-key", typ: "JWT" })
  const body = b64u({ iss: ISSUER, sub: "u-1", exp: now + 300, iat: now, ...claims })
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url")
  return `${head}.${body}.${sig}`
}

/* Сессии YMS: тот же формат, что lib/auth/session.ts */
function session(login, extra = {}) {
  const id = psql(`SELECT user_id FROM wms_users WHERE login = '${login}'`)
  const now = Date.now()
  const payload = { userId: id, login, fio: login, position: "test", iat: now, exp: now + 3600_000, aud: "yms", ...extra }
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", SECRET).update(data).digest("base64url")
  return `yms_session=${encodeURIComponent(`${data}.${sig}`)}`
}

const base = `http://127.0.0.1:${YMS_PORT}`
async function api(method, url, { as, body, bearer } = {}) {
  const headers = { "content-type": "application/json" }
  if (as) headers.cookie = session(as)
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const res = await fetch(`${base}${url}${url.includes("?") ? "&" : "?"}siteCode=skeet`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: res.status, body: json }
}
const crid = () => `t-${randomUUID()}`

before(async () => {
  try {
    psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, "postgres")
  } catch {}
  psql(`CREATE DATABASE ${DB}`, "postgres")
  psqlFile(path.join(HERE, "fixtures/wms-schema.sql"))
  writeFileSync(path.join(TMP, "seed.sql"), seedSql())
  psqlFile(path.join(TMP, "seed.sql"))
  const fleet = {
    version: 1,
    karas: [
      { id: "kara-1", name: "Кара №1", boardNumber: "1", enabled: true },
      { id: "kara-2", name: "Кара №2", boardNumber: "2", enabled: true },
    ],
    drivers: [{ id: "d-1", fullName: "Иванов И.", karaId: "kara-1", shiftCode: "A", enabled: true }],
    missions: [],
  }
  writeFileSync(path.join(TMP, "fleet.json"), JSON.stringify(fleet))
  jwksServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise((r) => jwksServer.listen(JWKS_PORT, "127.0.0.1", r))
  await startWms()
  await startHarness(
    "yms",
    path.join(HERE, "tsconfig.yms.json"),
    path.join(YMS, "app/api"),
    "/api",
    YMS_PORT,
    {
      ...COMMON_ENV,
      WMS_ROUTE_API_URL: `http://127.0.0.1:${WMS_PORT}`,
      WMS_ROUTE_API_TOKEN: SVC_TOKEN,
      YMS_FLEET_FILE: path.join(TMP, "fleet.json"),
      ROUTE_OIDC_ISSUER: ISSUER,
      ROUTE_OIDC_AUDIENCE: "scada-route",
    },
    YMS
  )
})

after(async () => {
  for (const p of procs) p.kill("SIGTERM")
  jwksServer?.close()
})

/* ---------- сценарии ---------- */

const ctx = {}

function stateTask(r) {
  return r.body?.state?.task ?? r.body?.task ?? null
}

describe("SCADA System Route — приёмка", { concurrency: false }, () => {
  test("карта: черновик из реального плана проходит проверку и публикуется", async () => {
    const v = await api("GET", "/api/route/map/versions", { as: "mapadmin" })
    assert.equal(v.status, 200, JSON.stringify(v.body))
    const draft = v.body.versions.find((x) => x.status === "draft")
    assert.ok(draft, "есть черновик v1")
    const full = await api("GET", `/api/route/map/versions/${draft.mapId}`, { as: "mapadmin" })
    const errors = full.body.validation.issues.filter((i) => i.level === "error")
    assert.equal(errors.length, 0, `ошибки карты: ${JSON.stringify(errors.slice(0, 5))}`)
    const g = full.body.map.geometry
    // Точка получения с линии SIPA: ближайший узел проезда в зоне цеха (настраивается в редакторе).
    const near = g.nodes
      .filter((n) => n.kind !== "access")
      .map((n) => ({ n, d: Math.hypot(n.x - 900, n.y - 1200) }))
      .sort((a, b) => a.d - b.d)[0].n
    g.points.push({ id: "pt-sipa", code: "LINE-SIPA", kind: "line_pickup", nodeId: near.id, label: "Линия SIPA" })
    const saved = await api("PUT", `/api/route/map/versions/${draft.mapId}`, {
      as: "mapadmin",
      body: { geometry: g, expectedRevision: full.body.map.revision, summary: "точка получения SIPA" },
    })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    const stale = await api("PUT", `/api/route/map/versions/${draft.mapId}`, {
      as: "mapadmin",
      body: { geometry: g, expectedRevision: full.body.map.revision },
    })
    assert.equal(stale.status, 409, "устаревшая ревизия черновика отклоняется")
    const pub = await api("POST", `/api/route/map/versions/${draft.mapId}/publish`, { as: "mapadmin", body: { note: "тест" } })
    assert.equal(pub.status, 200, JSON.stringify(pub.body))
    const changes = psql(`SELECT count(*) FROM route_map_changes`)
    assert.ok(Number(changes) >= 3, "журнал изменений карты ведётся")
    const cur = await api("GET", "/api/route/map/current", { as: "driver1" })
    assert.equal(cur.body.map.status, "published")
    ctx.map = cur.body.map.geometry
  })

  test("№1 WMS создала потребность → YMS сформировала реальное задание", async () => {
    let r = await api("PUT", "/api/route/demand", { as: "disp", body: { wmsTasks: true } })
    assert.equal(r.status, 200)
    r = await api("POST", "/api/route/demand", { as: "disp" })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.report.created.length, 1, JSON.stringify(r.body.report))
    const row = psql(`SELECT task_status_id || '|' || (task_payload->>'routeClaim') FROM wms_tasks WHERE task_code='WMS-TR-1'`)
    assert.equal(row, "2|route", "WMS пометила задание как переданное в Route")
    const t = psql(`SELECT task_type || '|' || status || '|' || hu_code || '|' || item_code || '|' || lot_code FROM route_tasks`)
    assert.equal(t, `RELOCATION|QUEUED|${SSCC.P1}|ITEM-1|L-001`)
    const again = await api("POST", "/api/route/demand", { as: "disp" })
    assert.equal(again.body.report.created.length, 0, "повторная синхронизация не дублирует")
  })

  test("задание по несуществующей палете не создаётся", async () => {
    const r = await api("POST", "/api/route/tasks", {
      as: "disp",
      body: { type: "RELOCATION", sourceCode: "FG-A-1", destCode: "FG-A-31", huCode: "00" + gs1("46000000000009999") },
    })
    assert.equal(r.status, 422)
    assert.equal(r.body.code, "pallet_not_found")
  })

  test("№2 водитель принял задание → маршрут к месту получения", async () => {
    // Этап 2 ТЗ: позиция задана оператором вручную и явно помечена как ручная.
    const start = ctx.map.nodes.find((n) => n.id === "acc-A-60") || ctx.map.nodes.find((n) => n.kind === "junction")
    let r = await api("POST", "/api/route/forklifts/kara-1/position", { as: "disp", body: { x: start.x, y: start.y, headingDeg: 90 } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.position.state, "manual")
    r = await api("POST", "/api/route/driver/session", { as: "driver1", body: { karaId: "kara-1", shiftCode: "A" } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const offered = r.body.task
    assert.equal(offered.status, "OFFERED", "YMS сразу предложила задание")
    ctx.task1 = offered
    r = await api("POST", `/api/route/tasks/${offered.taskId}/accept`, { as: "driver1", body: { clientRequestId: crid(), expectedVersion: offered.version } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const t = stateTask(r)
    assert.equal(t.status, "EN_ROUTE_PICKUP")
    assert.equal(t.instruction, "К месту получения — FG-A-1")
    assert.equal(t.route.phase, "to_pickup")
    assert.equal(t.route.result.ok, true, JSON.stringify(t.route.result))
    assert.ok(t.route.result.lengthM > 0)
    ctx.task1 = t
  })

  test("№13 два водителя не могут получить одно задание", async () => {
    let r = await api("POST", "/api/route/driver/session", { as: "driver2", body: { karaId: "kara-2" } })
    assert.equal(r.status, 200)
    r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/accept`, { as: "driver2", body: { clientRequestId: crid() } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, "task_reassigned")
    // второй водитель не может занять погрузчик, на котором уже работают
    r = await api("POST", "/api/route/driver/session", { as: "senior", body: { karaId: "kara-1" } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, "kara_busy")
    // гонка: создаём задание и одновременно назначаем его на обе кары
    const c = await api("POST", "/api/route/tasks", { as: "disp", body: { type: "RELOCATION", sourceCode: "FG-A-2", destCode: "FG-A-31", huCode: SSCC.P2, priority: 40 } })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    ctx.task2 = c.body.task
    const assigned = psql(`SELECT status || '|' || COALESCE(kara_id,'') FROM route_tasks WHERE task_id = ${ctx.task2.taskId}`)
    if (assigned.startsWith("QUEUED")) {
      const [a, b] = await Promise.all([
        api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "disp", body: { action: "assign", karaId: "kara-2", expectedVersion: ctx.task2.version } }),
        api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "disp", body: { action: "assign", karaId: "kara-2", expectedVersion: ctx.task2.version } }),
      ])
      const codes = [a.status, b.status].sort()
      assert.deepEqual(codes, [200, 409], `одно назначение проходит, второе — конфликт версии: ${JSON.stringify([a.body, b.body])}`)
    }
    const s2 = await api("GET", "/api/route/tasks/active", { as: "driver2" })
    assert.equal(s2.body.task.taskId, ctx.task2.taskId)
    // одновременное принятие: ровно один успех
    const v = s2.body.task.version
    const [x, y] = await Promise.all([
      api("POST", `/api/route/tasks/${ctx.task2.taskId}/accept`, { as: "driver2", body: { clientRequestId: crid(), expectedVersion: v } }),
      api("POST", `/api/route/tasks/${ctx.task2.taskId}/accept`, { as: "driver2", body: { clientRequestId: crid(), expectedVersion: v } }),
    ])
    assert.deepEqual([x.status, y.status].sort(), [200, 409], JSON.stringify([x.body, y.body]))
    // возвращаем задание 2 в очередь — понадобится для сценария №9
    const back = await api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "disp", body: { action: "requeue", reason: "для теста следующего задания" } })
    assert.equal(back.status, 200, JSON.stringify(back.body))
    await api("PATCH", "/api/route/forklifts/kara-2", { as: "disp", body: { autoAssign: false } })
    const after = psql(`SELECT status FROM route_tasks WHERE task_id = ${ctx.task2.taskId}`)
    assert.ok(["QUEUED", "OFFERED"].includes(after))
    if (after === "OFFERED") {
      await api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "disp", body: { action: "requeue", reason: "автоназначение kara-2 выключено" } })
    }
  })

  test("№4 неправильная палета — операция отклонена", async () => {
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-pallet`, { as: "driver1", body: { clientRequestId: crid(), code: SSCC.P6 } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.decision.ok, false)
    assert.equal(r.body.decision.code, "wrong_pallet")
    assert.equal(r.body.decision.expected, SSCC.P1)
    const t = stateTask(r)
    assert.equal(t.status, "AT_PICKUP", "прибытие засчитано по скану, задание не изменено")
    assert.equal(t.huCode, SSCC.P1, "содержимое задания не меняется по факту скана")
    const load = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-load`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(load.status, 409)
    assert.equal(load.body.code, "scan_required")
  })

  test("ручной ввод — только с правом и причиной", async () => {
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-pallet`, {
      as: "driver1",
      body: { clientRequestId: crid(), code: SSCC.P1, method: "manual", manualReason: "этикетка повреждена" },
    })
    assert.equal(r.status, 403)
    assert.equal(r.body.code, "manual_scan_denied")
  })

  test("№3 правильная палета — проверка прошла, груз можно подтвердить", async () => {
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-pallet`, { as: "driver1", body: { clientRequestId: crid(), code: `(00)${SSCC.P1.slice(2)}` } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.decision.ok, true, JSON.stringify(r.body.decision))
    assert.equal(r.body.decision.details.itemName, "Сок яблочный 1 л")
    assert.equal(r.body.decision.details.lotCode, "L-001")
    assert.equal(r.body.decision.details.qty, 6)
    assert.ok(stateTask(r).actions.includes("confirm_load"))
  })

  test("№5 подтверждена погрузка → маршрут к месту постановки", async () => {
    const t0 = (await api("GET", "/api/route/tasks/active", { as: "driver1" })).body.task
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-load`, { as: "driver1", body: { clientRequestId: crid(), expectedVersion: t0.version } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const t = stateTask(r)
    assert.equal(t.status, "EN_ROUTE_DROPOFF")
    assert.equal(t.instruction, "Доставьте палету в FG-A-32")
    assert.equal(t.route.phase, "to_dropoff")
    assert.equal(t.route.result.ok, true, JSON.stringify(t.route.result))
    ctx.task1 = t
  })

  test("№10 перекрыт участок маршрута → пересчёт или отсутствие пути", async () => {
    const edges = ctx.task1.route.result.edgeIds
    const mid = edges[Math.floor(edges.length / 2)]
    let r = await api("POST", "/api/route/map/blocks", { as: "disp", body: { edgeId: mid, reason: "пролив, уборка" } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    let s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    if (s.body.task.status === "EN_ROUTE_DROPOFF") {
      assert.equal(s.body.task.route.result.ok, true)
      assert.ok(!s.body.task.route.result.edgeIds.includes(mid), "новый маршрут обходит закрытый проезд")
    }
    // Закрываем все подъезды к адресу назначения → безопасного пути нет.
    const dest = ctx.map.addresses.find((a) => a.locationCode === "FG-A-32").nodeId
    const around = ctx.map.edges.filter((e) => e.from === dest || e.to === dest).map((e) => e.id)
    r = await api("POST", "/api/route/map/blocks", { as: "disp", body: { edgeIds: around, reason: "ремонт ворот" } })
    assert.equal(r.status, 200)
    assert.ok(r.body.rechecked.some((x) => !x.ok), "пересчёт показал отсутствие пути")
    s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    assert.equal(s.body.task.status, "BLOCKED")
    assert.match(s.body.task.blockedReason, /маршрут/)
    const ex = await api("GET", "/api/route/exceptions", { as: "disp" })
    assert.ok(ex.body.exceptions.some((e) => e.kind === "no_route"), "диспетчер уведомлён")
    const events = psql(`SELECT count(*) FROM route_events WHERE topic = 'route.blocked'`)
    assert.ok(Number(events) >= 2)
    for (const b of r.body.blocks) await api("DELETE", `/api/route/map/blocks?blockId=${b.blockId}`, { as: "disp" })
    const exId = ex.body.exceptions.find((e) => e.kind === "no_route").exceptionId
    r = await api("POST", `/api/route/exceptions/${exId}/resolve`, { as: "disp", body: { resolution: "проезд открыт", action: "unblock" } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    assert.equal(s.body.task.status, "EN_ROUTE_DROPOFF")
    assert.equal(s.body.task.route.result.ok, true)
  })

  test("№6 водитель прибыл к назначению → доступно подтверждение адреса", async () => {
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/arrive`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const t = stateTask(r)
    assert.equal(t.status, "AT_DROPOFF")
    assert.equal(t.instruction, "Подтвердите адрес FG-A-32")
  })

  test("№7 неправильный адрес — завершение запрещено", async () => {
    let r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-address`, { as: "driver1", body: { clientRequestId: crid(), code: "https://wms.scada25.ru/s/c/FG-A-31" } })
    assert.equal(r.status, 200)
    assert.equal(r.body.decision.code, "wrong_address")
    r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, "address_scan_required")
    assert.equal(psql(`SELECT count(*) FROM wms_request_log`), "0", "в WMS ничего не записано")
  })

  test("№12 нет связи с WMS — нет ложного подтверждения", async () => {
    let r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-address`, { as: "driver1", body: { clientRequestId: crid(), code: "FG-A-32" } })
    assert.equal(r.body.decision.ok, true, JSON.stringify(r.body))
    await stopWms()
    r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(r.status, 503, JSON.stringify(r.body))
    assert.equal(r.body.code, "wms_unavailable")
    assert.equal(psql(`SELECT status || '|' || wms_movement_status FROM route_tasks WHERE task_id = ${ctx.task1.taskId}`), "AT_DROPOFF|unknown")
    await startWms()
  })

  test("№8 постановка подтверждена → WMS обновила адрес, YMS завершила задание; №9 предложено следующее", async () => {
    const id = crid()
    ctx.dropCrid = id
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: id } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.wms.disposition, "applied")
    assert.equal(r.body.wms.ledger, "stock_transfer")
    assert.equal(r.body.wms.movedCodes, 9, "палета + 2 короба + 6 единиц")
    assert.equal(psql(`SELECT status FROM route_tasks WHERE task_id = ${ctx.task1.taskId}`), "COMPLETED")
    const at = psql(`SELECT DISTINCT l.location_code FROM wms_item_codes mic JOIN codes c ON c.code_id = mic.code_id
      JOIN wms_locations l ON l.location_id = mic.current_location_id WHERE c.ai21_serial LIKE 'P1-%' OR c.ai21_serial = '${SSCC.P1.slice(2)}'`)
    assert.equal(at, "FG-A-32", "все коды палеты в новом адресе")
    const bal = psql(`SELECT l.location_code || ':' || b.available_qty::int FROM wms_stock_balances b JOIN wms_locations l ON l.location_id = b.location_id ORDER BY 1`)
    assert.equal(bal, "FG-A-1:6\nFG-A-32:6")
    assert.equal(psql(`SELECT task_status_id FROM wms_tasks WHERE task_code = 'WMS-TR-1'`), "4", "задание WMS закрыто")
    // №9: следующее доступное задание предложено без поиска в списке
    assert.equal(r.body.offered, ctx.task2.taskNo, JSON.stringify(r.body.offered))
    assert.equal(r.body.state.task.status, "OFFERED")
    assert.equal(r.body.state.task.taskId, ctx.task2.taskId)
  })

  test("№14 повторное подтверждение — дубликат перемещения в WMS не создаётся", async () => {
    let r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: ctx.dropCrid } })
    assert.equal(r.status, 200)
    assert.equal(r.body.replayed, true)
    r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(r.status, 409)
    assert.ok(["task_completed", "task_reassigned"].includes(r.body.code), r.body.code)
    assert.equal(psql(`SELECT count(*) FROM wms_request_log WHERE operation_code = 'route_pallet_move'`), "1")
    assert.equal(psql(`SELECT count(*) FROM wms_stock_movements`), "1")
    assert.equal(psql(`SELECT count(*) FROM wms_operation_events WHERE event_type = 'route.pallet.moved'`), "1")
    // повтор того же requestId прямо в WMS — сохранённый ответ, без движения
    const reqId = psql(`SELECT wms_movement_request_id FROM route_tasks WHERE task_id = ${ctx.task1.taskId}`)
    const res = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/move-pallet`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", requestId: reqId, palletCode: SSCC.P1, fromLocationCode: "FG-A-1", toLocationCode: "FG-A-32", taskRef: "x" }),
    })
    const body = await res.json()
    assert.equal(body.disposition, "duplicate")
    assert.equal(psql(`SELECT count(*) FROM wms_stock_movements`), "1")
    // палета уже перемещена — новая операция отклоняется
    const res2 = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/move-pallet`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", requestId: randomUUID(), palletCode: SSCC.P1, fromLocationCode: "FG-A-1", toLocationCode: "FG-A-34", taskRef: "y" }),
    })
    assert.equal(res2.status, 409)
    assert.equal((await res2.json()).code, "pallet_moved")
  })

  test("занятый адрес → новый адрес через WMS; карантин и полный адрес отклоняются", async () => {
    const quarantine = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/pallet-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", code: SSCC.P3 }),
    }).then((r) => r.json())
    assert.ok(quarantine.problems.some((p) => p.code === "pallet_quarantine"))
    const full = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/address-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", locationCode: "FG-A-40" }),
    }).then((r) => r.json())
    assert.equal(full.address.free, 0)
    const other = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/pallet-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", code: SSCC.P7 }),
    }).then((r) => r.json())
    assert.ok(other.problems.some((p) => p.code === "pallet_other_site"))
  })

  test("отменённое задание: экран обновляется, подтвердить старое нельзя", async () => {
    const s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    const t = s.body.task
    assert.equal(t.status, "OFFERED")
    const acc = await api("POST", `/api/route/tasks/${t.taskId}/accept`, { as: "driver1", body: { clientRequestId: crid(), expectedVersion: t.version } })
    assert.equal(acc.status, 200)
    const c = await api("POST", `/api/route/tasks/${t.taskId}/dispatch`, { as: "disp", body: { action: "cancel", reason: "изменился план отгрузки" } })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    const r = await api("POST", `/api/route/tasks/${t.taskId}/scan-pallet`, { as: "driver1", body: { clientRequestId: crid(), code: SSCC.P2 } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, "task_cancelled")
    const ev = psql(`SELECT count(*) FROM route_events WHERE topic = 'task.cancelled' AND task_id = ${t.taskId}`)
    assert.equal(ev, "1", "событие task.cancelled для экрана водителя")
  })

  test("№11 потеря AprilTag → недостоверность позиции", async () => {
    const dev = await api("POST", "/api/route/devices", { as: "mapadmin", body: { karaId: "kara-1" } })
    assert.equal(dev.status, 200, JSON.stringify(dev.body))
    const token = dev.body.token
    const n = ctx.map.nodes.find((x) => x.kind === "junction")
    const now = Date.now()
    let r = await api("POST", "/api/route/forklifts/kara-1/position", {
      bearer: token,
      body: { x: n.x, y: n.y, headingDeg: 10, quality: 0.92, tagIds: [12, 13], reprojErrorPx: 0.6, measuredAt: new Date(now).toISOString(), source: "apriltag" },
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.position.state, "ok")
    // скачок через весь склад за 0,2 с — отбрасывается
    r = await api("POST", "/api/route/forklifts/kara-1/position", {
      bearer: token,
      body: { x: n.x + 1500, y: n.y, quality: 0.9, measuredAt: new Date(now + 200).toISOString(), source: "apriltag" },
    })
    assert.equal(r.body.accepted, false)
    assert.equal(r.body.code, "jump")
    // метка потеряна: точка не прыгает, достоверность — «не определена»
    r = await api("POST", "/api/route/forklifts/kara-1/position", {
      bearer: token,
      body: { x: 0, y: 0, quality: 0, measuredAt: new Date(now + 400).toISOString(), source: "apriltag", state: "lost" },
    })
    assert.equal(r.body.accepted, true)
    assert.equal(r.body.position.state, "lost")
    assert.equal(r.body.position.x, n.x, "последняя достоверная точка сохранена")
    assert.equal(psql(`SELECT count(*) FROM route_events WHERE topic = 'forklift.localization.lost'`), "1")
    // устройство не может писать за чужой погрузчик
    r = await api("POST", "/api/route/forklifts/kara-2/position", { bearer: token, body: { x: 1, y: 1, quality: 1, measuredAt: new Date().toISOString() } })
    assert.equal(r.status, 403)
  })

  test("№15 пользователь без прав / чужой токен — сервер отклоняет", async () => {
    let r = await api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "viewer", body: { action: "cancel", reason: "x x x" } })
    assert.equal(r.status, 403)
    r = await api("POST", "/api/route/driver/session", { as: "viewer", body: { karaId: "kara-2" } })
    assert.equal(r.status, 403)
    r = await api("GET", "/api/route/tasks/active", { as: "outsider" })
    assert.equal(r.status, 403)
    assert.equal(r.body.code, "site_denied")
    // сессия без audience "yms" (например, выданная WMS с тем же секретом) — не принимается
    const id = psql(`SELECT user_id FROM wms_users WHERE login = 'driver1'`)
    const now = Date.now()
    const data = Buffer.from(JSON.stringify({ userId: id, login: "driver1", fio: "x", position: "x", iat: now, exp: now + 60000 })).toString("base64url")
    const sig = createHmac("sha256", SECRET).update(data).digest("base64url")
    const res = await fetch(`${base}/api/route/tasks/active?siteCode=skeet`, { headers: { cookie: `yms_session=${data}.${sig}` } })
    assert.equal(res.status, 401)
    assert.equal((await res.json()).code, "session_audience")
    // SCADA ID: токен другого приложения отклоняется, токен Route — принимается
    r = await api("GET", "/api/route/driver/session", { bearer: oidcToken({ aud: "scada-wms", azp: "scada-wms", preferred_username: "oidcdriver@skeet.ru" }) })
    assert.equal(r.status, 401)
    assert.equal(r.body.code, "token_audience")
    r = await api("GET", "/api/route/driver/session", { bearer: oidcToken({ aud: "scada-route", preferred_username: "oidcdriver@skeet.ru" }) })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.user.login, "oidcdriver@skeet.ru")
    r = await api("GET", "/api/route/driver/session", { bearer: oidcToken({ aud: "scada-route", preferred_username: "oidcdriver@skeet.ru", exp: Math.floor(Date.now() / 1000) - 600 }) })
    assert.equal(r.status, 401)
    // поддельная подпись
    const good = oidcToken({ aud: "scada-route", preferred_username: "oidcdriver@skeet.ru" }).split(".")
    const forged = `${good[0]}.${b64u({ iss: ISSUER, sub: "u-1", aud: "scada-route", exp: 9999999999, preferred_username: "disp" })}.${good[2]}`
    r = await api("GET", "/api/route/driver/session", { bearer: forged })
    assert.equal(r.status, 401)
    // WMS: без сервисного токена интеграционный слой закрыт
    const w = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/move-pallet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteCode: "skeet", requestId: randomUUID(), palletCode: SSCC.P2, toLocationCode: "FG-A-34", taskRef: "z" }),
    })
    assert.equal(w.status, 401)
  })

  test("водитель сменил погрузчик — прежняя сессия закрыта, задания перепроверены", async () => {
    const c = await api("POST", "/api/route/tasks", { as: "disp", body: { type: "PRODUCTION_PICKUP", sourceCode: "LINE-SIPA", destCode: "FG-B-5", huCode: SSCC.P5, priority: 80 } })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    let s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    assert.equal(s.body.task?.taskId, c.body.task.taskId, JSON.stringify(s.body.task))
    const acc = await api("POST", `/api/route/tasks/${c.body.task.taskId}/accept`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(acc.status, 200)
    assert.equal(stateTask(acc).instruction, "К месту получения — LINE-SIPA")
    await api("DELETE", "/api/route/driver/session", { as: "driver2", body: { reason: "конец смены" } })
    s = await api("POST", "/api/route/driver/session", { as: "driver1", body: { karaId: "kara-2" } })
    assert.equal(s.status, 200, JSON.stringify(s.body))
    assert.equal(s.body.session.karaId, "kara-2")
    assert.equal(psql(`SELECT status || '|' || COALESCE(kara_id, '-') FROM route_tasks WHERE task_id = ${c.body.task.taskId}`), "QUEUED|-")
    assert.equal(psql(`SELECT count(*) FROM route_driver_sessions WHERE login = 'driver1' AND ended_at IS NULL`), "1")
  })

  test("журнал: каждый переход записан с ID задания, временем, пользователем и состоянием WMS", async () => {
    const j = await api("GET", `/api/route/journal?taskId=${ctx.task1.taskId}`, { as: "disp" })
    assert.equal(j.status, 200)
    const actions = j.body.events.map((e) => e.action).reverse()
    for (const a of ["create", "queue", "offer", "accept", "start_pickup", "scan_pallet_rejected", "scan_pallet", "confirm_load", "start_dropoff", "block", "unblock", "arrive_dropoff", "scan_address_rejected", "scan_address", "wms_unavailable", "complete"]) {
      assert.ok(actions.includes(a), `в журнале есть ${a}: ${actions.join(",")}`)
    }
    const complete = j.body.events.find((e) => e.action === "complete")
    assert.equal(complete.actor, "driver1")
    assert.equal(complete.wmsState.disposition, "applied")
  })

  test("SSE: поток событий с дочиткой по Last-Event-ID", async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${base}/api/route/events?siteCode=skeet&since=0`, { headers: { cookie: session("disp") }, signal: ctrl.signal })
    assert.equal(res.status, 200)
    assert.match(res.headers.get("content-type"), /text\/event-stream/)
    const reader = res.body.getReader()
    let text = ""
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !text.includes("event: task.assigned")) {
      const { value, done } = await reader.read()
      if (done) break
      text += Buffer.from(value).toString()
    }
    ctrl.abort()
    assert.match(text, /event: task\.assigned/)
    assert.match(text, /id: \d+/)
  })
})
