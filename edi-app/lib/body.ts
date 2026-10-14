import { HttpError } from "./db.ts"

export async function boundedBody(req: Request, limit: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length") || 0) > limit) throw new HttpError(413, "Слишком большой запрос", "too_large")
  const reader = req.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new HttpError(413, "Слишком большой запрос", "too_large")
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
