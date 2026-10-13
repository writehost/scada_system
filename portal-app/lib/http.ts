import { NextResponse } from "next/server"
import { HttpError } from "./errors"

export { HttpError }

export function fail(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, code: error.code, fields: error.fields },
      { status: error.status }
    )
  }
  console.error("[portal]", error)
  return NextResponse.json({ error: "Внутренняя ошибка сервера", code: "internal" }, { status: 500 })
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") || ""
  if (!type.includes("application/json")) {
    throw new HttpError(415, "Ожидается JSON", "unsupported_media_type")
  }
  const text = await req.text()
  if (text.length > 32_000) throw new HttpError(413, "Слишком большой запрос", "payload_too_large")
  try {
    const v = JSON.parse(text) as unknown
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not object")
    return v as Record<string, unknown>
  } catch {
    throw new HttpError(400, "Некорректный JSON", "bad_json")
  }
}

/** Проверка Origin для изменяющих запросов с cookie-сессией (защита от CSRF). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin")
  if (!origin) return
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim()
  try {
    if (new URL(origin).host !== host) throw new Error("cross")
  } catch {
    throw new HttpError(403, "Запрос с чужого сайта отклонён", "bad_origin")
  }
}

export function parseId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "Заявка не найдена", "not_found")
  return id
}
