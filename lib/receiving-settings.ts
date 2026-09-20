import {
  DEFAULT_RECEIVING_SITE_RULES,
  parseReceivingSiteRules,
  type ReceivingSiteRules,
} from "@/lib/receiving-scan-policy"

const AUTO_POST_KEY = "wms.receiving.autoPostStock"
const TARGET_LOCATION_KEY = "wms.receiving.targetLocationCode"

let cachedSiteRules: ReceivingSiteRules | null = null

export function cacheReceivingSiteRules(rules: ReceivingSiteRules | null | undefined) {
  cachedSiteRules = rules ? parseReceivingSiteRules(rules) : null
}

export function getCachedReceivingSiteRules(): ReceivingSiteRules {
  return cachedSiteRules ?? { ...DEFAULT_RECEIVING_SITE_RULES }
}

export function getReceivingAutoPostStock(): boolean {
  if (cachedSiteRules) return cachedSiteRules.autoPostStock
  if (typeof window === "undefined") return false
  return localStorage.getItem(AUTO_POST_KEY) === "1"
}

export function setReceivingAutoPostStock(enabled: boolean) {
  if (typeof window === "undefined") return
  localStorage.setItem(AUTO_POST_KEY, enabled ? "1" : "0")
}

export function getReceivingTargetLocationCode(): string {
  if (typeof window !== "undefined") {
    const local = (localStorage.getItem(TARGET_LOCATION_KEY) || "").trim()
    const site = cachedSiteRules
    if (site && !site.allowOperatorOverride) return site.defaultTargetLocationCode
    if (local) return local
  }
  return cachedSiteRules?.defaultTargetLocationCode ?? ""
}

export function setReceivingTargetLocationCode(code: string) {
  if (typeof window === "undefined") return
  const v = code.trim()
  if (v) localStorage.setItem(TARGET_LOCATION_KEY, v)
  else localStorage.removeItem(TARGET_LOCATION_KEY)
}

export function siteAutoPostStock(): boolean {
  return cachedSiteRules?.autoPostStock === true
}

export function operatorMayOverrideReceiving(): boolean {
  return cachedSiteRules?.allowOperatorOverride !== false
}
