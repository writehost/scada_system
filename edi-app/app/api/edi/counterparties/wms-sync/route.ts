import { route } from "@/lib/http.ts"
import { linkWmsSuppliers } from "@/lib/edi/wms-suppliers.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = route(async ({ client, actor }) => linkWmsSuppliers(client, actor), { tx: true })
