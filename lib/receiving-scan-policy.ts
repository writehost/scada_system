/** Общая политика скана ЧЗ — веб, проводка и ТСД смотрят в одно место. */

export const CRPT_STATUSES = [
  "EMITTED",
  "APPLIED",
  "INTRODUCED",
  "WRITTEN_OFF",
  "RETIRED",
  "WITHDRAWN",
] as const

export type CrptStatus = (typeof CRPT_STATUSES)[number]
export type ExpiryMode = "block" | "confirm" | "allow"

export type ReceivingGroupPolicy = {
  /** Коды/имена группы (stickers, water, softdrinks, …). */
  match: string[]
  allowedStatuses: string[]
  expiryMode?: ExpiryMode
}

export type ReceivingSiteRules = {
  autoPostStock: boolean
  allowOperatorOverride: boolean
  defaultTargetLocationCode: string
  expiryMode: ExpiryMode
  /** Пустой список + без "*" = только EMITTED. "*" = любой статус, включая пустой. */
  defaultAllowedStatuses: string[]
  groupPolicies: ReceivingGroupPolicy[]
}

export const DEFAULT_RECEIVING_SITE_RULES: ReceivingSiteRules = {
  autoPostStock: false,
  allowOperatorOverride: true,
  defaultTargetLocationCode: "",
  expiryMode: "confirm",
  defaultAllowedStatuses: ["EMITTED"],
  groupPolicies: [
    {
      match: ["stickers", "sticker", "этикет", "packaging", "упаков"],
      allowedStatuses: ["EMITTED"],
      expiryMode: "block",
    },
    {
      match: ["water", "вода", "softdrinks", "напит", "finished", "гп", "beverage"],
      allowedStatuses: ["EMITTED", "INTRODUCED"],
      expiryMode: "confirm",
    },
    {
      match: ["unmarked", "без кодов", "без марки"],
      allowedStatuses: ["*"],
      expiryMode: "allow",
    },
  ],
}

export function parseReceivingSiteRules(raw: unknown): ReceivingSiteRules {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const expiry =
    src.expiryMode === "block" || src.expiryMode === "allow" || src.expiryMode === "confirm"
      ? src.expiryMode
      : DEFAULT_RECEIVING_SITE_RULES.expiryMode
  const statuses = Array.isArray(src.defaultAllowedStatuses)
    ? src.defaultAllowedStatuses.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_RECEIVING_SITE_RULES.defaultAllowedStatuses]
  const groups = Array.isArray(src.groupPolicies)
    ? src.groupPolicies
        .map((row) => {
          if (!row || typeof row !== "object") return null
          const g = row as Record<string, unknown>
          const match = Array.isArray(g.match) ? g.match.map((m) => String(m).trim()).filter(Boolean) : []
          const allowed = Array.isArray(g.allowedStatuses)
            ? g.allowedStatuses.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
            : []
          if (match.length === 0 || allowed.length === 0) return null
          const mode =
            g.expiryMode === "block" || g.expiryMode === "allow" || g.expiryMode === "confirm"
              ? g.expiryMode
              : undefined
          return { match, allowedStatuses: allowed, expiryMode: mode } satisfies ReceivingGroupPolicy
        })
        .filter((g): g is ReceivingGroupPolicy => Boolean(g))
    : DEFAULT_RECEIVING_SITE_RULES.groupPolicies
  return {
    autoPostStock: src.autoPostStock === true,
    allowOperatorOverride: src.allowOperatorOverride !== false,
    defaultTargetLocationCode: typeof src.defaultTargetLocationCode === "string" ? src.defaultTargetLocationCode.trim() : "",
    expiryMode: expiry,
    defaultAllowedStatuses: statuses.length ? statuses : ["EMITTED"],
    groupPolicies: groups,
  }
}

export function resolveGroupPolicy(
  rules: ReceivingSiteRules,
  productGroup?: string | null
): { allowedStatuses: string[]; expiryMode: ExpiryMode } {
  const token = (productGroup ?? "").trim().toLowerCase()
  if (token) {
    for (const policy of rules.groupPolicies) {
      if (policy.match.some((m) => token.includes(m.toLowerCase()) || m.toLowerCase().includes(token))) {
        return {
          allowedStatuses: policy.allowedStatuses,
          expiryMode: policy.expiryMode ?? rules.expiryMode,
        }
      }
    }
  }
  return {
    allowedStatuses: rules.defaultAllowedStatuses,
    expiryMode: rules.expiryMode,
  }
}

export type ReceivingScanGateInput = {
  crptStatus?: string | null
  expiryState?: string | null
  itemStatus?: string | null
  productGroup?: string | null
}

export type ReceivingScanGate = {
  allowed: boolean
  blocked: boolean
  expired: boolean
  warning: boolean
  reason: string | null
  expiryMode: ExpiryMode
}

function isExpired(input: ReceivingScanGateInput): boolean {
  return input.expiryState === "expired" || input.itemStatus === "просрочен"
}

function isWarning(input: ReceivingScanGateInput): boolean {
  return input.expiryState === "warning" || input.itemStatus === "истекает"
}

export function evaluateReceivingScanPolicy(
  input: ReceivingScanGateInput,
  rules: ReceivingSiteRules = DEFAULT_RECEIVING_SITE_RULES
): ReceivingScanGate {
  const { allowedStatuses, expiryMode } = resolveGroupPolicy(rules, input.productGroup)
  const crpt = (input.crptStatus ?? "").trim().toUpperCase()
  const expired = isExpired(input)
  const warning = isWarning(input)
  const allowAny = allowedStatuses.includes("*")

  if (expired && expiryMode === "block") {
    return {
      allowed: false,
      blocked: true,
      expired: true,
      warning: true,
      reason: "Код просрочен — приёмка заблокирована правилом площадки",
      expiryMode,
    }
  }
  if (expired && expiryMode === "confirm") {
    const statusOk = allowAny || !crpt || allowedStatuses.includes(crpt)
    return {
      allowed: statusOk,
      blocked: !statusOk,
      expired: true,
      warning: true,
      reason: statusOk
        ? "Код просрочен — нужна отметка при проводке"
        : `Статус ЧЗ «${crpt}» не разрешён для этой группы`,
      expiryMode,
    }
  }

  if (allowAny) {
    return {
      allowed: true,
      blocked: false,
      expired,
      warning,
      reason: warning ? "Срок годности истекает" : null,
      expiryMode,
    }
  }

  if (!crpt) {
    return {
      allowed: false,
      blocked: false,
      expired,
      warning,
      reason: "Статус ЧЗ ещё не получен",
      expiryMode,
    }
  }

  if (allowedStatuses.includes(crpt)) {
    return {
      allowed: true,
      blocked: false,
      expired,
      warning,
      reason: warning ? "Срок годности истекает" : null,
      expiryMode,
    }
  }

  return {
    allowed: false,
    blocked: true,
    expired,
    warning,
    reason: `Статус ЧЗ «${crpt}» не разрешён правилом площадки для группы`,
    expiryMode,
  }
}

export type ReceivingScanLike = {
  stickerStatus?: string | null
  itemStatus?: string | null
  expiryState?: string | null
  productGroup?: string | null
}

export function receivingScanGateFromRow(
  row: ReceivingScanLike,
  rules: ReceivingSiteRules = DEFAULT_RECEIVING_SITE_RULES,
  productGroup?: string | null
): ReceivingScanGate {
  return evaluateReceivingScanPolicy(
    {
      crptStatus: row.stickerStatus,
      expiryState: row.expiryState,
      itemStatus: row.itemStatus,
      productGroup: productGroup ?? row.productGroup,
    },
    rules
  )
}

/** Можно ли класть скан на остаток (просрочка «с подтверждением» — только если confirmExpired). */
export function isReceivingScanPostable(
  gate: ReceivingScanGate,
  confirmExpired = false
): boolean {
  if (gate.blocked || !gate.allowed) return false
  if (gate.expired && gate.expiryMode === "confirm" && !confirmExpired) return false
  return true
}
