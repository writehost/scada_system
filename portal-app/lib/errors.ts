export class HttpError extends Error {
  status: number
  code: string
  fields?: Record<string, string>

  constructor(status: number, message: string, code: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}
