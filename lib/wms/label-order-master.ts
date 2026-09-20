export const LABEL_ORDER_MASTER_CODE = (
  (typeof process !== "undefined" && process.env.WMS_LABEL_ORDER_MASTER_CODE?.trim()) ||
  "223122"
).trim()

export function assertLabelOrderMasterCode(raw: unknown): boolean {
  return String(raw ?? "").trim() === LABEL_ORDER_MASTER_CODE
}
