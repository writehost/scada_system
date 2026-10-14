import { route } from "@/lib/http.ts"
import { dashboard } from "@/lib/edi/journal.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor }) => dashboard(client, actor))
