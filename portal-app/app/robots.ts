import type { MetadataRoute } from "next"
import { siteConfig } from "@/lib/site"

export const dynamic = "force-dynamic"

export default function robots(): MetadataRoute.Robots {
  const { publicUrl } = siteConfig()
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/activate"] }],
    sitemap: `${publicUrl}/sitemap.xml`,
  }
}
