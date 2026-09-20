import { readFile } from "fs/promises";
import path from "path";
import type { IssueRecipientOption } from "@/lib/wms/issue-recipient-directory";

export async function loadIssueRecipientsFromFile(): Promise<IssueRecipientOption[]> {
  const candidates = [
    path.join(process.cwd(), "interface", "data", "wms-users.json"),
    path.join(process.cwd(), "web", "interface", "data", "wms-users.json"),
    path.join(process.cwd(), "data", "wms-users.json"),
  ];
  for (const filePath of candidates) {
    try {
      const raw = await readFile(filePath, "utf8");
      const arr = JSON.parse(raw) as Array<{
        fio?: string;
        position?: string;
        login?: string;
      }>;
      if (!Array.isArray(arr)) continue;
      return arr
        .map((row) => {
          const fio = String(row.fio ?? "").trim();
          if (!fio) return null;
          const login = String(row.login ?? "").trim();
          const position = String(row.position ?? "").trim();
          return {
            id: login || fio,
            displayName: fio,
            subtitle: position || login || null,
          };
        })
        .filter((r): r is IssueRecipientOption => r != null)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
    } catch {
      continue;
    }
  }
  return [];
}
