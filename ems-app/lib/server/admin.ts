import { resolveUser } from "./http.ts"
import { HttpError } from "./errors.ts"

export async function requirePlatformAdmin(req: Request) {
  const auth = await resolveUser(req)
  if (!auth) throw new HttpError(401, "auth_required", "Нужен вход")
  if (!auth.user.isPlatformAdmin) throw new HttpError(403, "forbidden", "Только администратор платформы")
  return auth.user
}
