/**
 * Стенд SCADA System Route для тестов: тестовая БД WMS + настоящие обработчики API
 * Route (yms-app) и интеграционного слоя WMS (основное приложение) через tests/route/harness/serve.ts.
 */
import { spawn, execFileSync } from "node:child_process"
import { createHash, createHmac, generateKeyPairSync, randomUUID, createSign, scryptSync, randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
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
function startHarness(name, tsconfig, root, prefix, port, env, cwd, extra = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(TSX, ["--tsconfig", tsconfig, path.join(HERE, "harness/serve.ts"), "--root", root, "--prefix", prefix, "--port", String(port), ...extra], {
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

export async function setupStand(opts = {}) {
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
  await new Promise((resolve, reject) => {
    jwksServer.once("error", reject)
    jwksServer.listen(JWKS_PORT, "127.0.0.1", resolve)
  })
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
    YMS,
    opts.staticDir ? ["--static", opts.staticDir] : []
  )
}

export async function teardownStand() {
  for (const p of procs) p.kill("SIGTERM")
  jwksServer?.close()
}


export { SSCC, gs1, psql, api, session, oidcToken, b64u, crid, base, startWms, stopWms, SVC_TOKEN, WMS_PORT, YMS_PORT, SECRET, ISSUER }
