import { route } from "@/lib/http.ts"
import { folderCounts } from "@/lib/edi/journal.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor }) => folderCounts(client, actor))
