export function passwordEnabled(): boolean {
  return process.env.EDI_ALLOW_PASSWORD_LOGIN === "1" || process.env.NODE_ENV !== "production"
}

export function wmsRoleFallbackEnabled(): boolean {
  return process.env.EDI_ALLOW_WMS_ROLE_FALLBACK === "1" || process.env.NODE_ENV !== "production"
}

export function safeReturnPath(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") && !/[\\\x00-\x1f]/.test(value) ? value : "/"
}
