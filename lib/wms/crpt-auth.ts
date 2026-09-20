import fs from "node:fs";
import path from "node:path";

type JsonWmsConfig = {
  crptBearerToken?: unknown;
  crptUpstreamBearerToken?: unknown;
};

const SHARED_SECRETS_CANDIDATES = [
  "/opt/scadatable-wms/shared/secrets.env",
  path.join(process.cwd(), "..", "..", "shared", "secrets.env"),
  path.join(process.cwd(), "..", "shared", "secrets.env"),
];

function readEnvKeyFromFile(filePath: string, key: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#") || !s.startsWith(`${key}=`)) continue;
      const value = s.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
      return value || null;
    }
  } catch {
    return null;
  }
  return null;
}

function readSharedSecretsKey(key: string): string | null {
  for (const candidate of SHARED_SECRETS_CANDIDATES) {
    const value = readEnvKeyFromFile(candidate, key);
    if (value) return value;
  }
  return null;
}

function findWmsConfigPath(): string | undefined {
  const extra = [
    path.join(process.cwd(), "wms-config.json"),
    path.join(process.cwd(), "..", "wms-config.json"),
    path.join(process.cwd(), "..", "..", "wms-config.json"),
    path.join(process.cwd(), "web", "wms-config.json"),
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

function readCrptBearerTokenFromConfig(): string | null {
  const configPath = findWmsConfigPath();
  if (!configPath) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as JsonWmsConfig;
    const token = typeof parsed.crptBearerToken === "string" ? parsed.crptBearerToken.trim() : "";
    return token || null;
  } catch {
    return null;
  }
}

function readCrptUpstreamBearerTokenFromConfig(): string | null {
  const configPath = findWmsConfigPath();
  if (!configPath) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as JsonWmsConfig;
    const token =
      typeof parsed.crptUpstreamBearerToken === "string" ? parsed.crptUpstreamBearerToken.trim() : "";
    return token || null;
  } catch {
    return null;
  }
}

/** Bearer-токен для upstream CRPT (scada25.ru). Только на сервере — env / shared secrets / wms-config.json. */
export function getUpstreamCrptBearerToken(): string | null {
  const upstreamEnv = process.env.WMS_CRPT_UPSTREAM_BEARER_TOKEN?.trim();
  if (upstreamEnv) return upstreamEnv;

  const fromSharedUpstream = readSharedSecretsKey("WMS_CRPT_UPSTREAM_BEARER_TOKEN");
  if (fromSharedUpstream) return fromSharedUpstream;

  const fromConfig = readCrptUpstreamBearerTokenFromConfig();
  if (fromConfig) return fromConfig;

  const env = process.env.WMS_CRPT_BEARER_TOKEN?.trim();
  if (env) return env;

  const fromShared = readSharedSecretsKey("WMS_CRPT_BEARER_TOKEN");
  if (fromShared) return fromShared;

  return readCrptBearerTokenFromConfig();
}
