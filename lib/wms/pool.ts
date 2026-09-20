import { Pool, type PoolClient, type PoolConfig } from "pg";
import fs from "node:fs";
import path from "node:path";

let pool: Pool | null = null;

type JsonWmsConfig = {
  databaseUrl?: unknown;
  host?: unknown;
  port?: unknown;
  user?: unknown;
  password?: unknown;
  database?: unknown;
  ssl?: unknown;
  sslmode?: unknown;
  mode?: unknown;
  remoteHost?: unknown;
  remotePort?: unknown;
  appHost?: unknown;
  appPort?: unknown;
  tunnel?: unknown;
};

function findWmsConfigPath(): string | undefined {
  const extra = [
    path.join(process.cwd(), "wms-config.json"),
    path.join(process.cwd(), "..", "wms-config.json"),
    path.join(process.cwd(), "..", "..", "wms-config.json"),
    /** Репозиторий как cwd (`scadatable/`) — типично при запуске не из `web/interface` */
    path.join(process.cwd(), "web", "wms-config.json"),
    /** Монорепо: cwd = `web/interface` → на два уровня вверх и снова в `web/` */
    path.join(process.cwd(), "..", "..", "web", "wms-config.json"),
  ];
  for (const configPath of extra) {
    if (fs.existsSync(configPath)) return configPath;
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const configPath = path.join(dir, "wms-config.json");
    if (fs.existsSync(configPath)) return configPath;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function readJsonConfig(): JsonWmsConfig | undefined {
  const configPath = findWmsConfigPath();
  if (!configPath) return undefined;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw) as JsonWmsConfig;
  } catch {
    return undefined;
  }
}

function toBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function parseDatabaseUrl(url: string): PoolConfig {
  const parsed = new URL(url);
  const sslMode = parsed.searchParams.get("sslmode");
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\/+/, ""),
    ssl: sslMode === "disable" ? false : undefined,
  };
}

function configFromJson(fileConfig: JsonWmsConfig): PoolConfig | undefined {
  if (typeof fileConfig.databaseUrl === "string" && fileConfig.databaseUrl) {
    return parseDatabaseUrl(fileConfig.databaseUrl);
  }

  if (
    typeof fileConfig.host === "string" &&
    typeof fileConfig.user === "string" &&
    typeof fileConfig.password === "string" &&
    typeof fileConfig.database === "string"
  ) {
    const sslMode =
      typeof (fileConfig as { sslmode?: unknown }).sslmode === "string"
        ? String((fileConfig as { sslmode?: string }).sslmode)
        : "";
    return {
      host: fileConfig.host,
      port:
        typeof fileConfig.port === "number"
          ? fileConfig.port
          : Number(fileConfig.port ?? 5432),
      user: fileConfig.user,
      password: fileConfig.password,
      database: fileConfig.database,
      ssl: sslMode === "disable" ? false : toBool(fileConfig.ssl),
    };
  }

  return undefined;
}

export function getDatabaseConfig(): PoolConfig | undefined {
  // UI-managed wms-config.json wins so Integrations can switch the DB without a restart.
  const fileConfig = readJsonConfig();
  if (fileConfig) {
    const fromFile = configFromJson(fileConfig);
    if (fromFile) return fromFile;
  }

  const envUrl = process.env.DATABASE_URL ?? process.env.PG_URL;
  if (envUrl) return parseDatabaseUrl(envUrl);
  return undefined;
}

/** Откуда берётся строка подключения (без секретов). Для диагностики `/api/wms/health`. */
export function describeDatabaseConfig(): {
  source: "env" | "file" | "none";
  filePath?: string;
} {
  const filePath = findWmsConfigPath();
  if (filePath && readJsonConfig() && configFromJson(readJsonConfig()!)) {
    return { source: "file", filePath };
  }
  const envUrl = process.env.DATABASE_URL ?? process.env.PG_URL;
  if (typeof envUrl === "string" && envUrl.trim()) return { source: "env" };
  return { source: "none" };
}

export type PublicDatabaseSettings = {
  mode: "tunnel" | "direct";
  /** Factory Postgres — not the scada25 box. */
  remoteHost: string;
  remotePort: string;
  /** What the WMS process opens (SSH/FRP listen on scada25). */
  appHost: string;
  appPort: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  passwordConfigured: boolean;
  sslmode: "disable" | "require" | "prefer";
  source: "env" | "file" | "none";
  urlPreview: string;
  tunnel: {
    sshHost: string;
    sshPort: string;
    sshUser: string;
    label: string;
  };
  live: {
    ok: boolean;
    address: string;
    port: string;
    version: string;
    database: string;
    message: string;
  } | null;
};

export type EditableDatabaseSettings = {
  mode?: "tunnel" | "direct";
  remoteHost?: string;
  remotePort?: string;
  appHost?: string;
  appPort?: string;
  host?: string;
  port?: string;
  database: string;
  user: string;
  password?: string;
  sslmode?: "disable" | "require" | "prefer";
};

function sslModeFromConfig(config: PoolConfig | undefined): PublicDatabaseSettings["sslmode"] {
  if (!config) return "prefer";
  if (config.ssl === false) return "disable";
  if (config.ssl) return "require";
  return "prefer";
}

function buildDatabaseUrl(settings: {
  host: string;
  port: string | number;
  database: string;
  user: string;
  password: string;
  sslmode: string;
}): string {
  const user = encodeURIComponent(settings.user);
  const password = encodeURIComponent(settings.password);
  const host = settings.host.trim() || "127.0.0.1";
  const port = String(settings.port || 5432);
  const database = settings.database.replace(/^\/+/, "");
  const sslmode = settings.sslmode || "prefer";
  return `postgres://${user}:${password}@${host}:${port}/${database}?sslmode=${sslmode}`;
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "";
  }
}

function strField(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseFactoryTunnel(): {
  appHost: string;
  appPort: string;
  remoteHost: string;
  remotePort: string;
  sshHost: string;
  sshPort: string;
  sshUser: string;
} {
  const defaults = {
    appHost: "127.0.0.1",
    appPort: "15432",
    remoteHost: "127.0.0.1",
    remotePort: "5432",
    sshHost: "127.0.0.1",
    sshPort: "13022",
    sshUser: "wms-deploy",
  };
  const unitPath = "/etc/systemd/system/wms-pg-tunnel.service";
  try {
    if (!fs.existsSync(unitPath)) return defaults;
    const raw = fs.readFileSync(unitPath, "utf8");
    const forward = raw.match(/-L\s+([^\s:]+):(\d+):([^\s:]+):(\d+)/);
    if (forward) {
      defaults.appHost = forward[1] || defaults.appHost;
      defaults.appPort = forward[2] || defaults.appPort;
      defaults.remoteHost = forward[3] || defaults.remoteHost;
      defaults.remotePort = forward[4] || defaults.remotePort;
    }
    const sshPort = raw.match(/\s-p\s+(\d+)/);
    if (sshPort?.[1]) defaults.sshPort = sshPort[1];
    const userHost = raw.match(/([A-Za-z0-9._-]+)@([0-9A-Za-z._-]+)\s*$/m);
    if (userHost) {
      defaults.sshUser = userHost[1];
      defaults.sshHost = userHost[2];
    }
  } catch {
    /* unit may be unreadable */
  }
  return defaults;
}

export function currentDatabaseUrl(): string {
  const config = getDatabaseConfig();
  if (!config?.host || !config.user || !config.database) return "";
  return buildDatabaseUrl({
    host: String(config.host),
    port: config.port || 5432,
    database: String(config.database),
    user: String(config.user),
    password: String(config.password || ""),
    sslmode: sslModeFromConfig(config),
  });
}

export function getPublicDatabaseSettings(): PublicDatabaseSettings {
  const config = getDatabaseConfig();
  const fileConfig = readJsonConfig() || {};
  const described = describeDatabaseConfig();
  const tunnel = parseFactoryTunnel();
  const mode = fileConfig.mode === "direct" ? "direct" : "tunnel";
  const appHost =
    strField(fileConfig.appHost) ||
    (typeof config?.host === "string" ? config.host : "") ||
    tunnel.appHost;
  const appPort =
    strField(fileConfig.appPort) ||
    (config?.port ? String(config.port) : "") ||
    tunnel.appPort;
  const remoteHost = strField(fileConfig.remoteHost, tunnel.remoteHost);
  const remotePort = strField(fileConfig.remotePort, tunnel.remotePort);
  const database = typeof config?.database === "string" ? config.database : "";
  const user = typeof config?.user === "string" ? config.user : "";
  const password = typeof config?.password === "string" ? config.password : "";
  const sslmode = sslModeFromConfig(config);
  const urlPreview = config
    ? redactUrl(
        buildDatabaseUrl({
          host: appHost,
          port: appPort,
          database,
          user,
          password,
          sslmode,
        })
      )
    : "";
  return {
    mode,
    remoteHost,
    remotePort,
    appHost,
    appPort,
    host: remoteHost,
    port: remotePort,
    database,
    user,
    password: "",
    passwordConfigured: Boolean(password),
    sslmode,
    source: described.source,
    urlPreview,
    tunnel: {
      sshHost: tunnel.sshHost,
      sshPort: tunnel.sshPort,
      sshUser: tunnel.sshUser,
      label: "завод через FRP/SSH (не локальный Postgres scada25)",
    },
    live: null,
  };
}

export function writableWmsConfigPath(): string {
  return path.join(process.cwd(), "wms-config.json");
}

export function saveDatabaseSettings(next: EditableDatabaseSettings): PublicDatabaseSettings {
  const current = getDatabaseConfig();
  const publicCurrent = getPublicDatabaseSettings();
  const password = next.password?.trim() || (typeof current?.password === "string" ? current.password : "");
  if (!password) {
    throw new Error("Укажите пароль базы — сейчас он не задан");
  }
  const sslmode = next.sslmode || sslModeFromConfig(current);
  const mode = next.mode === "direct" ? "direct" : "tunnel";
  const remoteHost = (next.remoteHost || next.host || publicCurrent.remoteHost).trim() || "127.0.0.1";
  const remotePort = String(next.remotePort || next.port || publicCurrent.remotePort || "5432");
  const appHost = (next.appHost || publicCurrent.appHost || "127.0.0.1").trim();
  const appPort = String(next.appPort || publicCurrent.appPort || "15432");
  const connectHost = mode === "direct" ? remoteHost : appHost;
  const connectPort = mode === "direct" ? remotePort : appPort;
  const settings = {
    mode,
    remoteHost,
    remotePort: Number(remotePort) || 5432,
    appHost,
    appPort: Number(appPort) || 15432,
    host: connectHost,
    port: Number(connectPort) || (mode === "direct" ? 5432 : 15432),
    database: next.database.trim(),
    user: next.user.trim(),
    password,
    ssl: sslmode === "require" ? true : sslmode === "disable" ? false : undefined,
    sslmode,
    tunnel: publicCurrent.tunnel,
  };
  if (!settings.database || !settings.user) {
    throw new Error("Заполните имя базы и пользователя");
  }
  const databaseUrl = buildDatabaseUrl({
    host: connectHost,
    port: connectPort,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    sslmode,
  });
  const filePath = writableWmsConfigPath();
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ ...settings, databaseUrl }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
  void resetPool();
  return getPublicDatabaseSettings();
}

export async function testDatabaseSettings(next: EditableDatabaseSettings): Promise<{
  ok: boolean;
  message: string;
  elapsedMs: number;
  live?: PublicDatabaseSettings["live"];
}> {
  const current = getDatabaseConfig();
  const published = getPublicDatabaseSettings();
  const password = next.password?.trim() || (typeof current?.password === "string" ? current.password : "");
  const sslmode = next.sslmode || sslModeFromConfig(current);
  const mode = next.mode === "direct" ? "direct" : published.mode;
  const connectHost =
    mode === "direct"
      ? (next.remoteHost || next.host || published.remoteHost).trim()
      : (next.appHost || published.appHost).trim();
  const connectPort = Number(
    mode === "direct" ? next.remotePort || next.port || published.remotePort : next.appPort || published.appPort
  );
  const started = Date.now();
  const { Client } = await import("pg");
  const client = new Client({
    host: connectHost || "127.0.0.1",
    port: connectPort || 15432,
    database: next.database.trim(),
    user: next.user.trim(),
    password,
    ssl: sslmode === "disable" ? false : sslmode === "require" ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8_000,
  });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT current_database() AS db, current_user AS usr,
              host(inet_server_addr()) AS addr, inet_server_port() AS port,
              current_setting('server_version') AS ver`
    );
    const live = {
      ok: true,
      address: String(r.rows[0]?.addr || ""),
      port: String(r.rows[0]?.port || ""),
      version: String(r.rows[0]?.ver || ""),
      database: String(r.rows[0]?.db || ""),
      message: `Удалённая база завода: ${r.rows[0]?.db} @ ${r.rows[0]?.addr}:${r.rows[0]?.port} (PostgreSQL ${r.rows[0]?.ver})`,
    };
    return {
      ok: true,
      message: live.message,
      elapsedMs: Date.now() - started,
      live,
    };
  } catch (e) {
    const err = e as { message?: string };
    return {
      ok: false,
      message: typeof err.message === "string" && err.message ? err.message : "Не удалось подключиться",
      elapsedMs: Date.now() - started,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function probeLiveDatabase(): Promise<PublicDatabaseSettings["live"]> {
  const published = getPublicDatabaseSettings();
  const result = await testDatabaseSettings({
    mode: published.mode,
    remoteHost: published.remoteHost,
    remotePort: published.remotePort,
    appHost: published.appHost,
    appPort: published.appPort,
    database: published.database,
    user: published.user,
    sslmode: published.sslmode,
  });
  return result.live || { ok: false, address: "", port: "", version: "", database: "", message: result.message };
}

/**
 * База живёт на заводе, соединение идёт через SSH-туннель: один round-trip стоит
 * ~130 мс, а установка нового соединения — 0.7–2 с. Поэтому соединения не
 * закрываются по простою, держатся keep-alive и прогреваются заранее.
 */
const WARM_CONNECTIONS = 3;
const HEARTBEAT_MS = 25_000;

let heartbeat: NodeJS.Timeout | null = null;

export async function resetPool(): Promise<void> {
  const current = pool;
  pool = null;
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (current) {
    await current.end().catch(() => undefined);
  }
}

async function pingIdleConnections(target: Pool): Promise<void> {
  try {
    const client = await target.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  } catch {
    /* туннель может подниматься заново — следующий тик проверит снова */
  }
}

function warmUp(target: Pool): void {
  void Promise.all(
    Array.from({ length: WARM_CONNECTIONS }, async () => {
      try {
        const client = await target.connect();
        try {
          await client.query("SELECT 1");
        } finally {
          client.release();
        }
      } catch {
        /* прогрев необязателен: запрос пользователя откроет соединение сам */
      }
    })
  );

  if (heartbeat) return;
  heartbeat = setInterval(() => {
    const idle = target.idleCount;
    const total = target.totalCount;
    if (idle === 0 && total >= WARM_CONNECTIONS) return;
    void pingIdleConnections(target);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

/** Returns null when neither `DATABASE_URL` nor `PG_URL` is set. */
function extraTenantUrl(siteCode: string): string | undefined {
  const key = `WMS_DB_${siteCode.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  const packed = process.env.WMS_TENANT_URLS || "";
  for (const part of packed.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim().toLowerCase() === siteCode.toLowerCase()) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

const extraPools = new Map<string, Pool>();

export function tryGetPool(siteCode?: string): Pool | null {
  const raw = (siteCode || "").trim();
  const isPrimary = !raw || raw.toLowerCase() === "default" || raw.toLowerCase() === "skeet";
  if (!isPrimary) {
    const url = extraTenantUrl(raw);
    if (url) {
      let extra = extraPools.get(raw);
      if (!extra) {
        extra = new Pool({
          ...parseDatabaseUrl(url),
          max: 6,
          idleTimeoutMillis: 0,
          keepAlive: true,
          keepAliveInitialDelayMillis: 5_000,
          connectionTimeoutMillis: 20_000,
        });
        extra.on("error", () => undefined);
        extraPools.set(raw, extra);
      }
      return extra;
    }
  }
  const config = getDatabaseConfig();
  if (!config) return null;
  if (!pool) {
    pool = new Pool({
      ...config,
      max: 12,
      idleTimeoutMillis: 0,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5_000,
      connectionTimeoutMillis: 20_000,
    });
    /* Обрыв туннеля не должен ронять процесс: pg отдаёт такие ошибки на пул. */
    pool.on("error", () => undefined);
    warmUp(pool);
  }
  return pool;
}

export async function tryConnect(pool: Pool): Promise<
  | { ok: true; client: PoolClient }
  | { ok: false; status: number; code: string; message: string }
> {
  try {
    const client = await pool.connect();
    return { ok: true, client };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const pgCode = typeof err.code === "string" ? err.code : "";
    if (pgCode === "28P01") {
      return {
        ok: false,
        status: 503,
        code: "db_auth_failed",
        message:
          "database auth failed (check DATABASE_URL/PG_URL user/password)",
      };
    }
    return {
      ok: false,
      status: 503,
      code: "db_unavailable",
      message:
        typeof err.message === "string" && err.message
          ? err.message
          : "database unavailable",
    };
  }
}
