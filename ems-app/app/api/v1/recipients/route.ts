import { api } from "@/lib/server/http.ts"
import { email, num, str } from "@/lib/server/validate.ts"
import { addRecipient, listRecipients } from "@/lib/services/recipients.ts"
import { KIND_LABELS } from "@/lib/services/notify.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { isUuid } from "@/lib/server/db.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) => ctx.tx(async (c) => ({ recipients: await listRecipients(c, ctx.orgId), kinds: KIND_LABELS })))

export const POST = api({ perm: "notifications.manage", rate: 30 }, async (ctx) =>
  ctx.tx(async (c) => {
    const siteIds = ctx.body.siteIds
    if (siteIds != null && (!Array.isArray(siteIds) || !siteIds.every(isUuid))) throw badRequest("Объекты: список идентификаторов")
    return {
      recipientId: await addRecipient(c, ctx.orgId, ctx.actor, {
        email: email(ctx.body, "email")!,
        label: str(ctx.body, "label", "Подпись", { max: 80 }),
        kinds: ctx.body.kinds,
        siteIds: (siteIds as string[] | undefined) ?? null,
        sendHour: num(ctx.body, "sendHour", "Час отправки", { min: 0, max: 23, integer: true }),
      }),
    }
  }),
)
