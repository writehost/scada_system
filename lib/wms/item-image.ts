const IMAGE_ATTR_KEYS = [
  "imageUrl",
  "image_url",
  "photoUrl",
  "photo_url",
  "thumbnailUrl",
  "thumbUrl",
  "picture",
  "packImageUrl",
  "packImage",
  "imageDataUrl",
] as const;

function pickImageUrlFromRecord(attrs: Record<string, unknown>): string | null {
  for (const k of IMAGE_ATTR_KEYS) {
    const v = attrs[k];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    if (t.startsWith("https://") || t.startsWith("http://") || t.startsWith("data:image/")) return t;
    // Файлы из `public/` (загрузка номенклатуры) — путь на том же origin
    if (t.startsWith("/") && !t.includes("..") && !t.includes("//")) {
      if (t.startsWith("/wms-item-images/")) return t;
      if (/\.(jpe?g|png|gif|webp|svg|avif)(\?[^#]*)?(#.*)?$/i.test(t)) return t;
    }
  }
  return null;
}

/** URL картинки номенклатуры из `item_attrs_json` (если заведено в карточке). */
export function extractItemImageUrl(attrs: Record<string, unknown> | null | undefined): string | null {
  if (!attrs) return null;
  const top = pickImageUrlFromRecord(attrs);
  if (top) return top;
  const nom = attrs.nomenclature;
  if (nom && typeof nom === "object" && !Array.isArray(nom)) {
    return pickImageUrlFromRecord(nom as Record<string, unknown>);
  }
  return null;
}
