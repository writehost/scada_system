export type RotationPolicy = "fifo" | "fefo" | "manual";

export type LotRotationRow = {
  lotId: string;
  lotCode: string;
  manufacturedAt?: string | null;
  bestBeforeAt?: string | null;
  expiryAt?: string | null;
  receivedAt?: string | null;
  availableQty?: number;
};

function parseTs(value: unknown): number | null {
  if (value == null) return null;
  const normalized = value instanceof Date ? value.toISOString() : String(value).trim();
  if (!normalized) return null;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : t;
}

/** Скоропорт без явной политики → FEFO. */
export function effectiveRotationPolicy(
  rotationPolicy: string | null | undefined,
  isPerishable: boolean
): RotationPolicy {
  const p = (rotationPolicy ?? "").trim().toLowerCase();
  if (p === "fefo" || p === "fifo" || p === "manual") return p;
  return isPerishable ? "fefo" : "fifo";
}

function fefoSortKey(lot: LotRotationRow): number[] {
  const expiry = parseTs(lot.expiryAt);
  const bestBefore = parseTs(lot.bestBeforeAt);
  const emission = parseTs(lot.manufacturedAt);
  const received = parseTs(lot.receivedAt);
  // nulls last — без даты уходит в конец очереди
  return [
    expiry ?? Number.MAX_SAFE_INTEGER,
    bestBefore ?? Number.MAX_SAFE_INTEGER,
    emission ?? Number.MAX_SAFE_INTEGER,
    received ?? Number.MAX_SAFE_INTEGER,
  ];
}

function fifoSortKey(lot: LotRotationRow): number[] {
  const received = parseTs(lot.receivedAt);
  const emission = parseTs(lot.manufacturedAt);
  return [received ?? Number.MAX_SAFE_INTEGER, emission ?? Number.MAX_SAFE_INTEGER];
}

export function compareLotsForRotation(
  a: LotRotationRow,
  b: LotRotationRow,
  policy: RotationPolicy
): number {
  if (policy === "manual") return a.lotCode.localeCompare(b.lotCode);
  const ka = policy === "fefo" ? fefoSortKey(a) : fifoSortKey(a);
  const kb = policy === "fefo" ? fefoSortKey(b) : fifoSortKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return a.lotCode.localeCompare(b.lotCode);
}

export function sortLotsForRotation<T extends LotRotationRow>(
  lots: T[],
  rotationPolicy: string | null | undefined,
  isPerishable: boolean
): T[] {
  const policy = effectiveRotationPolicy(rotationPolicy, isPerishable);
  return [...lots].sort((a, b) => compareLotsForRotation(a, b, policy));
}

/** Первая партия с остатком по правилам FEFO/FIFO. */
export function pickRecommendedIssueLot<T extends LotRotationRow>(
  lots: T[],
  rotationPolicy: string | null | undefined,
  isPerishable: boolean
): T | null {
  const withStock = lots.filter((l) => (l.availableQty ?? 0) > 0);
  const sorted = sortLotsForRotation(withStock, rotationPolicy, isPerishable);
  return sorted[0] ?? null;
}
