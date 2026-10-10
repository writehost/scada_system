// Ошибки предметной области с HTTP-статусом. Без зависимостей от Next —
// используются и в фоновом обработчике, и в тестах.

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message: string, code = "invalid_input", details?: unknown) => new HttpError(400, code, message, details)
export const notFound = (what = "Объект") => new HttpError(404, "not_found", `${what} не найден`)
export const forbidden = (message = "Недостаточно прав") => new HttpError(403, "forbidden", message)
export const conflict = (message: string, code = "conflict") => new HttpError(409, code, message)
export const planLimit = (message: string, details?: unknown) => new HttpError(402, "plan_limit", message, details)
