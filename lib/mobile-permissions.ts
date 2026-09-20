/**
 * Mobile nav / actions by `wms_roles.code` (see db/schema.sql INSERT INTO wms_roles).
 * Multiple roles are merged (union): any role that grants a capability enables it.
 */

export type MobileNavVisibility = {
  home: boolean
  tasks: boolean
  revision: boolean
  scan: boolean
  profile: boolean
  receiving: boolean
  issue: boolean
  virtualWarehouse: boolean
  production: boolean
}

const TASKS_ROLE_CODES = new Set([
  "admin",
  "warehouse_manager",
  "warehouse_operator",
  "line_operator",
])

/** Инвентаризация / пересчёт — не линейный оператор по умолчанию */
const REVISION_ROLE_CODES = new Set([
  "admin",
  "warehouse_manager",
  "warehouse_operator",
  "auditor",
])

export function getMobileNavVisibility(roleCodes: string[]): MobileNavVisibility {
  const codes = roleCodes.map((c) => c.trim()).filter(Boolean)
  if (codes.length === 0) {
    return {
      home: true,
      tasks: false,
      revision: false,
      scan: true,
      profile: true,
      receiving: true,
      issue: true,
      virtualWarehouse: true,
      production: true,
    }
  }
  let tasks = false
  let revision = false
  for (const c of codes) {
    if (TASKS_ROLE_CODES.has(c)) tasks = true
    if (REVISION_ROLE_CODES.has(c)) revision = true
  }
  return {
    home: true,
    tasks,
    revision,
    scan: true,
    profile: true,
    receiving: codes.some((c) => ["admin", "warehouse_manager", "warehouse_operator"].includes(c)),
    issue: codes.some((c) => ["admin", "warehouse_manager", "warehouse_operator", "line_operator"].includes(c)),
    virtualWarehouse: codes.some((c) => ["admin", "warehouse_manager", "warehouse_operator", "auditor"].includes(c)),
    production: codes.some((c) => ["admin", "warehouse_manager", "line_operator"].includes(c)),
  }
}
