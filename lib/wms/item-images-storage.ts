import path from "node:path"
import { mkdir } from "node:fs/promises"

/** Общая папка загрузок (на scada25: shared/uploads/wms-item-images). */
export function getWmsItemImagesDir(): string {
  const explicit = (process.env.WMS_ITEM_IMAGES_DIR ?? "").trim()
  if (explicit) return explicit

  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  if (shared) return path.join(shared, "uploads", "wms-item-images")

  return path.join(process.cwd(), "public", "wms-item-images")
}

export async function ensureWmsItemImagesDir(): Promise<string> {
  const dir = getWmsItemImagesDir()
  await mkdir(dir, { recursive: true })
  return dir
}

export function isValidWmsItemImageUrl(url: string | null | undefined): boolean {
  const t = (url ?? "").trim()
  if (!t) return false
  if (t.startsWith("http://") || t.startsWith("https://")) return true
  if (!t.startsWith("/wms-item-images/")) return false
  return /\.(jpe?g|png|gif|webp)$/i.test(t)
}

export function publicWmsItemImagePath(filename: string): string {
  return `/wms-item-images/${filename.replace(/^\/+/, "")}`
}
