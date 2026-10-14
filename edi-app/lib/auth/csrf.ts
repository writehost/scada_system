import { HttpError } from "../db.ts"
import { publicOrigin } from "./origin.ts"

/** Cookie mutations require an explicit same-origin proof; Bearer clients use no ambient authority. */
export function assertSameOrigin(req: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return
  if (!req.headers.get("cookie") && /^Bearer\s+\S+/i.test(req.headers.get("authorization") || "")) return
  const origin = req.headers.get("origin")
  if (origin === publicOrigin(req) && req.headers.get("sec-fetch-site") !== "cross-site") return
  if (!origin && req.headers.get("sec-fetch-site") === "same-origin") return
  throw new HttpError(403, "Запрос должен выполняться с сайта SCADA EDI", "csrf_forbidden")
}
