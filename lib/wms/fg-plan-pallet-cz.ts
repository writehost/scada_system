import { inferPalletPack } from "@/lib/wms/fg-plan-pack"

export type FgPlanPalletCzSummary = {
  sscc: string
  found: boolean
  status: string
  statusLabel: string
  packageType: string
  packageLabel: string
  ownerName: string
  /** Прямые дети LEVEL2 — блоки, не бутылки. */
  blocks: number
  bottles: number
  childGtin: string
  productName: string
  children: string[]
  planGtin: string
  gtinMismatch: boolean
}

const STATUS_RU: Record<string, string> = {
  INTRODUCED: "В обороте",
  APPLIED: "Нанесён",
  EMITTED: "Эмитирован",
  WRITTEN_OFF: "Выбыл",
  RETIRED: "Выбыл",
  WITHDRAWN: "Выведен",
  DISAGGREGATED: "Расформирован",
  DISAGGREGATION: "Расформирован",
}

const PACKAGE_RU: Record<string, string> = {
  LEVEL1: "бутылка / КМ",
  LEVEL2: "короб",
  LEVEL3: "палета",
  BOX: "короб",
  PALLET: "палета",
  UNIT: "бутылка",
}

export function normalizeSscc(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "")
  if (digits.length === 18) return `00${digits}`
  if (digits.length === 20 && digits.startsWith("00")) return digits
  return String(raw || "").trim()
}

export function childGtinFromCis(code: string): string {
  const compact = String(code || "").replace(/[\u001d\s]/g, "")
  const m = compact.match(/^01(\d{14})/)
  if (m) return m[1]
  const digits = compact.replace(/\D/g, "")
  if (digits.startsWith("01") && digits.length >= 16) return digits.slice(2, 16)
  return ""
}

export function sameGtin(a: string, b: string): boolean {
  const left = a.replace(/\D/g, "").replace(/^0+/, "")
  const right = b.replace(/\D/g, "").replace(/^0+/, "")
  return Boolean(left && right && left === right)
}

export function crptStatusLabel(status: string): string {
  const key = String(status || "").trim().toUpperCase()
  return STATUS_RU[key] || status || "—"
}

export function crptPackageLabel(packageType: string, general?: string): string {
  const a = String(packageType || "").trim().toUpperCase()
  const b = String(general || "").trim().toUpperCase()
  return PACKAGE_RU[a] || PACKAGE_RU[b] || packageType || general || "—"
}

export function summarizeCrptPallet(
  cisInfo: Record<string, unknown> | null | undefined,
  input: { sscc: string; planGtin?: string; productName?: string; planBottles?: number }
): FgPlanPalletCzSummary {
  const children = Array.isArray(cisInfo?.child)
    ? (cisInfo?.child as unknown[]).map((value) => String(value || "").trim()).filter(Boolean)
    : []
  const requested = String(cisInfo?.requestedCis || cisInfo?.cis || input.sscc || "").replace(/\D/g, "")
  const found = Boolean(cisInfo && (cisInfo.status || children.length || cisInfo.packageType))
  const childGtin = childGtinFromCis(children[0] || "") || String(cisInfo?.gtin || "").replace(/\D/g, "")
  const planGtin = String(input.planGtin || "").replace(/\D/g, "")
  const pack = inferPalletPack({
    packageType: String(cisInfo?.packageType || cisInfo?.generalPackageType || ""),
    childCount: children.length,
    planBottles: input.planBottles,
  })
  return {
    sscc: normalizeSscc(requested || input.sscc),
    found,
    status: String(cisInfo?.status || ""),
    statusLabel: crptStatusLabel(String(cisInfo?.status || "")),
    packageType: String(cisInfo?.packageType || cisInfo?.generalPackageType || ""),
    packageLabel: crptPackageLabel(String(cisInfo?.packageType || ""), String(cisInfo?.generalPackageType || "")),
    ownerName: String(cisInfo?.ownerName || cisInfo?.producerName || ""),
    blocks: pack.blocks,
    bottles: pack.bottles,
    childGtin,
    productName: String(input.productName || "").trim(),
    children,
    planGtin,
    gtinMismatch: Boolean(planGtin && childGtin && !sameGtin(planGtin, childGtin)),
  }
}
