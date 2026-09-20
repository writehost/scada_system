import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { getWmsItemImagesDir } from "@/lib/wms/item-images-storage"

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

/** Безопасное имя файла внутри каталога wms-item-images. */
export function safeWmsItemImageName(relPath: string): string | null {
  const base = path.basename(String(relPath ?? "").trim())
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) return null
  if (!/^[a-zA-Z0-9._-]+\.(jpe?g|png|gif|webp)$/i.test(base)) return null
  return base
}

export async function readWmsItemImageFile(
  relPath: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const name = safeWmsItemImageName(relPath)
  if (!name) return null
  const full = path.join(getWmsItemImagesDir(), name)
  try {
    const info = await stat(full)
    if (!info.isFile()) return null
    const bytes = await readFile(full)
    const ext = path.extname(name).toLowerCase()
    return { bytes, contentType: MIME[ext] ?? "application/octet-stream" }
  } catch {
    return null
  }
}
