import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { readAuthTokenFromRequest } from "@/lib/auth/request-token";
import { verifySessionToken } from "@/lib/auth/session";
import {
  currentDatabaseUrl,
  getPublicDatabaseSettings,
  probeLiveDatabase,
  saveDatabaseSettings,
  tryGetPool,
  type EditableDatabaseSettings,
} from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_C_SETTING_KEY = "integration_1c_erp";
const QPASS_SETTING_KEY = "integration_qpass";

type QpassSettings = {
  origin: string;
  token: string;
  ensureUrl: string;
};

type OneCSettings = {
  enabled: boolean;
  baseUrl: string;
  login: string;
  password: string;
  viaFactory?: boolean;
  passwordConfigured?: boolean;
};

function isAdmin(roleCodes?: string[]) {
  return (roleCodes || []).some((r) => r === "admin");
}

async function requireAdmin(req: Request) {
  const token = await readAuthTokenFromRequest(req);
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || !isAdmin(session.roleCodes)) return null;
  return session;
}

function envLocalPath() {
  return path.join(process.cwd(), ".env.local");
}

function readEnvFile(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) map.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return map;
}

function writeEnvPatch(filePath: string, patch: Record<string, string>) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next = existing.map((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m) return line;
    const key = m[1]!;
    if (!(key in patch)) return line;
    seen.add(key);
    return `${key}=${patch[key] ?? ""}`;
  });
  for (const [key, value] of Object.entries(patch)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  fs.writeFileSync(filePath, `${next.filter((line, i) => line || i < next.length - 1).join("\n")}\n`, "utf8");
}

function envValue(local: Map<string, string>, key: string): string {
  return local.get(key)?.trim() || process.env[key]?.trim() || "";
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function getOneCSettings(siteCode: string): Promise<OneCSettings> {
  const pool = tryGetPool();
  if (!pool) return { enabled: false, baseUrl: "", login: "", password: "", viaFactory: true, passwordConfigured: false };
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode || "DEFAULT");
    if (siteId == null) return { enabled: false, baseUrl: "", login: "", password: "", viaFactory: true, passwordConfigured: false };
    await client.query(`
      CREATE TABLE IF NOT EXISTS wms_app_settings (
        site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
        setting_key TEXT NOT NULL,
        setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (site_id, setting_key)
      )`);
    const r = await client.query<{ setting_value: unknown }>(
      `SELECT setting_value FROM wms_app_settings WHERE site_id = $1 AND setting_key = $2`,
      [siteId, ONE_C_SETTING_KEY]
    );
    const v = jsonObject(r.rows[0]?.setting_value);
    return {
      enabled: v.enabled === true,
      baseUrl: typeof v.baseUrl === "string" ? v.baseUrl : "",
      login: typeof v.login === "string" ? v.login : "",
      password: typeof v.password === "string" ? v.password : "",
      viaFactory: v.viaFactory !== false,
      passwordConfigured: Boolean(typeof v.password === "string" && v.password),
    };
  } finally {
    client.release();
  }
}

async function getQpassSettings(siteCode: string): Promise<QpassSettings> {
  const pool = tryGetPool();
  const fromEnv = {
    origin: (process.env.QPASS_ORIGIN || "https://qpass.scada25.ru").trim(),
    token: (process.env.QPASS_API_TOKEN || "").trim(),
    ensureUrl: (process.env.QPASS_ENSURE_URL || "").trim(),
  };
  if (!pool) return fromEnv;
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode || "DEFAULT");
    if (siteId == null) return fromEnv;
    await client.query(`
      CREATE TABLE IF NOT EXISTS wms_app_settings (
        site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
        setting_key TEXT NOT NULL,
        setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (site_id, setting_key)
      )`);
    const r = await client.query<{ setting_value: unknown }>(
      `SELECT setting_value FROM wms_app_settings WHERE site_id = $1 AND setting_key = $2`,
      [siteId, QPASS_SETTING_KEY]
    );
    const v = jsonObject(r.rows[0]?.setting_value);
    return {
      origin: typeof v.origin === "string" && v.origin.trim() ? v.origin.trim() : fromEnv.origin,
      token: typeof v.token === "string" && v.token.trim() ? v.token.trim() : fromEnv.token,
      ensureUrl: typeof v.ensureUrl === "string" ? v.ensureUrl.trim() : fromEnv.ensureUrl,
    };
  } finally {
    client.release();
  }
}

async function saveQpassSettings(siteCode: string, settings: QpassSettings) {
  const pool = tryGetPool();
  if (!pool) throw new Error("database not configured");
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode || "DEFAULT");
    if (siteId == null) throw new Error("unknown siteCode");
    await client.query(`
      CREATE TABLE IF NOT EXISTS wms_app_settings (
        site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
        setting_key TEXT NOT NULL,
        setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (site_id, setting_key)
      )`);
    await client.query(
      `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (site_id, setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [siteId, QPASS_SETTING_KEY, JSON.stringify(settings)]
    );
  } finally {
    client.release();
  }
}

async function saveOneCSettings(siteCode: string, settings: OneCSettings) {
  const pool = tryGetPool();
  if (!pool) throw new Error("database not configured");
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode || "DEFAULT");
    if (siteId == null) throw new Error("unknown siteCode");
    await client.query(`
      CREATE TABLE IF NOT EXISTS wms_app_settings (
        site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
        setting_key TEXT NOT NULL,
        setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (site_id, setting_key)
      )`);
    await client.query(
      `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (site_id, setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [siteId, ONE_C_SETTING_KEY, JSON.stringify(settings)]
    );
  } finally {
    client.release();
  }
}

export async function GET(req: Request) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode")?.trim() || "DEFAULT";
  const localEnv = readEnvFile(envLocalPath());
  const updateServerToken = envValue(localEnv, "WMS_UPDATE_SERVER_TOKEN");
  const crptToken = envValue(localEnv, "WMS_CRPT_BEARER_TOKEN");
  const qpass = await getQpassSettings(siteCode);
  const oneC = await getOneCSettings(siteCode);
  const database = getPublicDatabaseSettings();
  database.live = await probeLiveDatabase();

  return NextResponse.json({
    database,
    updateServer: {
      url: envValue(localEnv, "WMS_UPDATE_SERVER_URL") || "https://scada25.ru",
      token: "",
      tokenConfigured: Boolean(updateServerToken),
      insecureTls: envValue(localEnv, "WMS_UPDATE_SERVER_INSECURE_TLS") === "1",
    },
    oneC: {
      enabled: oneC.enabled,
      baseUrl: oneC.baseUrl,
      login: oneC.login,
      password: "",
      viaFactory: oneC.viaFactory !== false,
      passwordConfigured: Boolean(oneC.password),
    },
    qpass: {
      origin: qpass.origin,
      token: "",
      tokenConfigured: Boolean(qpass.token),
      ensureUrl: qpass.ensureUrl,
    },
    crpt: {
      configured: Boolean(crptToken),
      note: "Данные подключения CRPT/Честный Знак сейчас читаются из .env / .env.local: WMS_CRPT_BEARER_TOKEN.",
    },
  });
}

export async function PUT(req: Request) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    siteCode?: string;
    updateServer?: { url?: string; token?: string; insecureTls?: boolean };
    oneC?: Partial<OneCSettings>;
    qpass?: { origin?: string; token?: string; ensureUrl?: string };
    database?: EditableDatabaseSettings;
  };
  const siteCode = body.siteCode?.trim() || "DEFAULT";

  if (body.database) {
    try {
      saveDatabaseSettings(body.database);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось сохранить базу";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const url = currentDatabaseUrl();
    if (url) {
      writeEnvPatch(envLocalPath(), {
        DATABASE_URL: url,
        PG_URL: url,
      });
    }
  }

  if (body.updateServer) {
    writeEnvPatch(envLocalPath(), {
      WMS_UPDATE_SERVER_URL: body.updateServer.url?.trim() || "https://scada25.ru",
      WMS_UPDATE_SERVER_TOKEN:
        body.updateServer.token?.trim() || envValue(readEnvFile(envLocalPath()), "WMS_UPDATE_SERVER_TOKEN") || "",
      WMS_UPDATE_SERVER_INSECURE_TLS: body.updateServer.insecureTls ? "1" : "0",
    });
  }

  if (body.qpass) {
    const current = await getQpassSettings(siteCode);
    const next: QpassSettings = {
      origin: body.qpass.origin?.trim() || current.origin || "https://qpass.scada25.ru",
      token: body.qpass.token?.trim() || current.token,
      ensureUrl: body.qpass.ensureUrl?.trim() ?? current.ensureUrl,
    };
    await saveQpassSettings(siteCode, next);
    writeEnvPatch(envLocalPath(), {
      QPASS_ORIGIN: next.origin,
      QPASS_API_TOKEN: next.token,
      QPASS_ENSURE_URL: next.ensureUrl,
    });
  }

  if (body.oneC) {
    const current = await getOneCSettings(siteCode);
    await saveOneCSettings(siteCode, {
      enabled: body.oneC.enabled === true,
      baseUrl: body.oneC.baseUrl?.trim() || "",
      login: body.oneC.login?.trim() || "",
      password: body.oneC.password ? body.oneC.password : current.password,
      viaFactory: body.oneC.viaFactory !== false,
    });
  }

  return NextResponse.json({ ok: true });
}
