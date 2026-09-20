import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { ensureWmsItemImagesDir, publicWmsItemImagePath } from "@/lib/wms/item-images-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 900 * 1024;

function extFromMime(type: string): string | null {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return null;
}

function safeCode(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart form" }, { status: 400 });
  }

  const groupCode = safeCode(String(form.get("groupCode") ?? ""));
  const file = form.get("file");
  if (!groupCode) {
    return NextResponse.json({ error: "groupCode is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const ext = extFromMime(file.type);
  if (!ext) {
    return NextResponse.json({ error: "unsupported image type" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "image is too large after compression", maxBytes: MAX_BYTES },
      { status: 413 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const dir = await ensureWmsItemImagesDir();
  const name = `group-${groupCode}-${Date.now()}.${ext}`;
  await writeFile(path.join(dir, name), bytes);

  return NextResponse.json({ imageUrl: publicWmsItemImagePath(name) });
}
