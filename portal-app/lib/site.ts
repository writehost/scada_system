/** Настройки сайта, которые владелец задаёт окружением — ничего не зашито в код. */
export function siteConfig() {
  const env = (k: string) => (process.env[k] || "").trim()
  return {
    name: "SCADA SYSTEM",
    publicUrl: (env("PORTAL_PUBLIC_URL") || "https://scadasystem.io").replace(/\/$/, ""),
    contactEmail: env("PORTAL_CONTACT_EMAIL"),
    contactPhone: env("PORTAL_CONTACT_PHONE"),
    legalEntity: env("PORTAL_LEGAL_ENTITY"),
    legalDetails: env("PORTAL_LEGAL_DETAILS"),
    adminNotifyEmails: env("PORTAL_ADMIN_NOTIFY_EMAILS")
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes("@")),
  }
}

export function publicOrigin(req: Request): string {
  const configured = (process.env.PORTAL_PUBLIC_URL || "").trim().replace(/\/$/, "")
  if (configured) return configured
  const proto = (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")).split(",")[0].trim()
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host).split(",")[0].trim()
  return `${proto}://${host}`
}
