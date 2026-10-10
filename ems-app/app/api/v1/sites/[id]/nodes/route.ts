import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { oneOf, reqStr, str, uuid } from "@/lib/server/validate.ts"
import { createNode, NODE_KINDS } from "@/lib/services/assets.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "sites.write" }, async (ctx, p) =>
  ctx.tx(async (c) => ({
    nodeId: await createNode(c, ctx.orgId, ctx.actor, {
      siteId: idParam(p.id),
      parentId: uuid(ctx.body, "parentId", "Родительский узел"),
      kind: oneOf(ctx.body, "kind", "Тип узла", NODE_KINDS),
      name: reqStr(ctx.body, "name", "Название", 120),
      code: str(ctx.body, "code", "Код", { max: 40 }),
    }),
  })),
)
