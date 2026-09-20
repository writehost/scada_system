import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { ensureWmsItemImagesDir, publicWmsItemImagePath } from "@/lib/wms/item-images-storage";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "gif";
}

/** Загрузка фото номенклатуры в `public/wms-item-images` → публичный URL в `item_attrs_json.imageUrl`. */
export async function POST(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "ожидался multipart/form-data" }, { status: 400 });
  }
  const siteCode = String(form.get("siteCode") ?? "").trim();
  const itemCode = String(form.get("itemCode") ?? "").trim();
  const file = form.get("file");
  if (!siteCode || !itemCode) {
    return NextResponse.json({ error: "siteCode и itemCode обязательны" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "выберите файл изображения" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "допустимы JPEG, PNG, WebP, GIF" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "файл не больше 2 МБ" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = extForMime(file.type);
  void itemCode;
  const name = `item-${randomUUID()}.${ext}`;
  const dir = await ensureWmsItemImagesDir();
  await writeFile(path.join(dir, name), buf);
  const imageUrl = publicWmsItemImagePath(name);
  return NextResponse.json({ imageUrl });
}
