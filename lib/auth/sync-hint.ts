import { setAccessToken } from "@/lib/auth/client-token"
import { setSiteCode } from "@/lib/wms-api"

export function syncWmsAccessHint(): void {
  if (typeof document === "undefined") return
  const match = document.cookie.match(/(?:^|; )wms_access_hint=([^;]+)/)
  if (match?.[1]) {
    try {
      const token = decodeURIComponent(match[1]).trim()
      if (token) setAccessToken(token)
      document.cookie = "wms_access_hint=; path=/; max-age=0"
    } catch {
      /* ignore */
    }
  }
  const site = document.cookie.match(/(?:^|; )wms_site_code=([^;]+)/)
  if (site?.[1]) {
    try {
      setSiteCode(decodeURIComponent(site[1]).trim())
    } catch {
      /* ignore */
    }
  }
}
