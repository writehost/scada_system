import { route } from "@/lib/http.ts"
import { fileForActor, fileResponse } from "@/lib/edi/download.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, params, req }) => {
  const f = await fileForActor(client, actor, params.id)
  const u = new URL(req.url).searchParams
  // извлечённый текст (DOCX/TXT/CSV) для предпросмотра без скачивания
  if (u.get("text") === "1") return { text: f.meta.textContent ?? "", fileName: f.meta.fileName, mime: f.meta.mime }
  return fileResponse(f, u.get("inline") === "1")
})
