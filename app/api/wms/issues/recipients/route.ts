import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  createIssueRecipientDef,
  listIssueRecipientOptions,
} from "@/lib/wms/issue-recipient-directory";
import { loadIssueRecipientsFromFile } from "@/lib/wms/issue-recipients-fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "DEFAULT";

  const pool = tryGetPool();
  if (pool) {
    const client = await pool.connect();
    try {
      const siteId = await getSiteId(client, siteCode);
      if (siteId != null) {
        let recipients = await listIssueRecipientOptions(client, siteId);
        if (recipients.length === 0) {
          const legacy = await loadIssueRecipientsFromFile();
          for (const row of legacy) {
            try {
              await createIssueRecipientDef(client, siteId, {
                displayName: row.displayName,
                position: row.subtitle,
                code:
                  typeof row.id === "string" && /^[A-Z0-9_]{1,64}$/i.test(row.id)
                    ? row.id.toUpperCase()
                    : undefined,
              });
            } catch {
              /* skip duplicate / invalid */
            }
          }
          recipients = await listIssueRecipientOptions(client, siteId);
        }
        if (recipients.length > 0) {
          return NextResponse.json({ recipients });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("wms_issue_recipient_defs") && !msg.includes("does not exist")) {
        throw e;
      }
    } finally {
      client.release();
    }
  }

  const recipients = await loadIssueRecipientsFromFile();
  return NextResponse.json({ recipients });
}
