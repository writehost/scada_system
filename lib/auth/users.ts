import { readFileSync, statSync } from "fs"
import path from "path"
import type { WmsAuthUserRecord } from "./types"

function usersFilePath(): string {
  const fromEnv = process.env.WMS_AUTH_USERS_PATH?.trim()
  if (fromEnv) return fromEnv
  return path.join(process.cwd(), "data", "wms-users.json")
}

let cachedUsers: WmsAuthUserRecord[] | null = null
let cachedUsersMtimeMs = 0

export function loadAuthUsers(): WmsAuthUserRecord[] {
  const filePath = usersFilePath()
  const mtimeMs = statSync(filePath).mtimeMs
  if (cachedUsers && cachedUsersMtimeMs === mtimeMs) return cachedUsers

  const raw = readFileSync(filePath, "utf8")
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error("wms-users.json must be an array")
  }
  cachedUsers = parsed.map((row) => normalizeUser(row))
  cachedUsersMtimeMs = mtimeMs
  return cachedUsers
}

function normalizeUser(row: unknown): WmsAuthUserRecord {
  const r = row as Record<string, unknown>
  const fio = String(r.fio ?? "").trim()
  const position = String(r.position ?? "").trim()
  const login = String(r.login ?? "").trim().toLowerCase()
  const password = String(r.password ?? "")
  if (!fio || !login || !password) {
    throw new Error("Each user must have fio, login and password")
  }
  return { fio, position, login, password }
}

export function findAuthUser(login: string, password: string): WmsAuthUserRecord | null {
  const normalizedLogin = login.trim().toLowerCase()
  if (!normalizedLogin || !password) return null
  const user = loadAuthUsers().find((u) => u.login === normalizedLogin)
  if (!user) return null
  if (user.password !== password) return null
  return user
}

export function resetAuthUsersCache() {
  cachedUsers = null
  cachedUsersMtimeMs = 0
}
