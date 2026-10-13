import type { MetadataRoute } from "next"
import { products } from "@/lib/products"
import { siteConfig } from "@/lib/site"

export const dynamic = "force-dynamic"

export default function sitemap(): MetadataRoute.Sitemap {
  const { publicUrl } = siteConfig()
  return [
    { url: `${publicUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${publicUrl}/request`, changeFrequency: "monthly", priority: 0.8 },
    ...products().map((p) => ({ url: `${publicUrl}/products/${p.key}`, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${publicUrl}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${publicUrl}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ]
}
