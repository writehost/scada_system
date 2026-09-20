import type { MarkingCodeRow } from "@/lib/types";

/** Разбор ответа ScanCodes (строки с statusLabel «Ошибка» = ошибка gRPC по позиции). */
export function classifyScanRows(rows: MarkingCodeRow[]) {
  let found = 0;
  let notFound = 0;
  let otherError = 0;
  for (const r of rows) {
    if (r.statusLabel === "Ошибка") {
      const n = r.note ?? "";
      if (/NOT_FOUND/i.test(n)) notFound++;
      else otherError++;
    } else {
      found++;
    }
  }
  return { found, notFound, otherError };
}
