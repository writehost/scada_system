export type TsdSessionRow = {
  documentId: string;
  status: string;
  lineCount: number | null;
  updatedAtIso: string | null;
  deviceUid: string | null;
  /** product_group с ТСД (поле itemCode в статусе сессии). */
  productGroup?: string | null;
  itemName?: string | null;
  itemCode?: string | null;
  totalQty?: number | null;
  scanCount?: number | null;
  allowedCount?: number | null;
  blockedCount?: number | null;
};

const STATUS_RANK: Record<string, number> = {
  closed: 3,
  paused: 2,
  active: 1,
};

export function normalizeTsdDocumentId(raw: string): string {
  return raw.trim().toUpperCase();
}

function statusRank(status: string): number {
  return STATUS_RANK[status.trim().toLowerCase()] ?? 0;
}

/** Сводим статусы сессии: closed побеждает active с более ранним временем (порядок записей в feed не важен). */
export function pickNewerTsdSessionStatus(prev: TsdSessionRow, next: TsdSessionRow): TsdSessionRow {
  const prevKey = prev.status.trim().toLowerCase();
  const nextKey = next.status.trim().toLowerCase();
  const prevTs = Date.parse(prev.updatedAtIso || "");
  const nextTs = Date.parse(next.updatedAtIso || "");

  if (nextKey === "closed") return next;
  if (prevKey === "closed") {
    if (nextKey === "active" && nextTs > prevTs) return next;
    return prev;
  }

  if (nextTs > prevTs) return next;
  if (nextTs < prevTs) return prev;
  return statusRank(next.status) >= statusRank(prev.status) ? next : prev;
}

export function isTerminalTsdSessionStatus(status: string): boolean {
  const key = status.trim().toLowerCase();
  return key === "closed" || key === "paused";
}

export function latestIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const aTs = Date.parse(a || "");
  const bTs = Date.parse(b || "");
  if (!Number.isFinite(aTs) && !Number.isFinite(bTs)) return a || b || null;
  if (!Number.isFinite(aTs)) return b || null;
  if (!Number.isFinite(bTs)) return a || null;
  return aTs >= bTs ? a! : b!;
}
