// Заявка на подбор и покупку совместимого оборудования (оплата оборудования — отдельно от подписки).
import { api } from "@/lib/server/http.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { email, num, reqStr, str } from "@/lib/server/validate.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => ({
    requests: (await c.query(
      `SELECT r.request_id, r.model_id, m.manufacturer, m.model, r.quantity, r.status, r.created_at FROM ems_device_requests r JOIN ems_catalog_models m ON m.model_id = r.model_id
        WHERE r.org_id = $1 ORDER BY r.created_at DESC`,
      [ctx.orgId],
    )).rows,
  })),
)

export const POST = api({ perm: "sites.write", rate: 10 }, async (ctx) =>
  ctx.tx(async (c) => {
    const modelId = reqStr(ctx.body, "modelId", "Модель", 80)
    const model = (await c.query("SELECT compatibility FROM ems_catalog_models WHERE model_id = $1 AND is_public", [modelId])).rows[0]
    if (!model) throw badRequest("Модель не найдена в каталоге")
    if (model.compatibility === "planned") throw badRequest("Это оборудование пока не поддерживается — заявка недоступна")
    const r = await c.query(
      `INSERT INTO ems_device_requests (org_id, model_id, quantity, contact_name, contact_phone, contact_email, comment, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING request_id`,
      [ctx.orgId, modelId, num(ctx.body, "quantity", "Количество", { required: true, min: 1, max: 10000, integer: true }), reqStr(ctx.body, "contactName", "Контактное лицо", 120),
        str(ctx.body, "contactPhone", "Телефон", { max: 40 }), email(ctx.body, "contactEmail", "Email", false), str(ctx.body, "comment", "Комментарий", { max: 1000 }), ctx.user?.userId ?? null],
    )
    await audit(c, ctx.orgId, ctx.actor, "catalog.request", { type: "device_request", id: r.rows[0].request_id }, { modelId })
    return { requestId: r.rows[0].request_id }
  }),
)
