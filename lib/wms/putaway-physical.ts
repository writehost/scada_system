/** Правила ВГХ/ёмкости для рекомендаций размещения (см. location_attrs_json / item_attrs_json). */

export type ItemPutawayPhysical = {
  unitVolumeL: number | null;
  /** Отсортированные по возрастанию стороны, мм */
  dimsMmSorted: [number, number, number] | null;
};

export type LocationPutawayPhysical = {
  capacityQty: number | null;
  capacityVolumeL: number | null;
  innerDimsMmSorted: [number, number, number] | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function extractItemPhysical(
  itemAttrsJson: unknown,
  baseUomVolumeL: number | null
): ItemPutawayPhysical {
  const attrs = asRecord(itemAttrsJson);
  const fromAttr = attrs ? num(attrs.unitVolumeL) : null;
  const unitVolumeL =
    fromAttr != null && fromAttr > 0 ? fromAttr : baseUomVolumeL != null && baseUomVolumeL > 0 ? baseUomVolumeL : null;

  let dimsMmSorted: [number, number, number] | null = null;
  const d = attrs?.dimsMm;
  const o = asRecord(d);
  if (o) {
    const l = num(o.l ?? o.L ?? o.length);
    const w = num(o.w ?? o.W ?? o.width);
    const h = num(o.h ?? o.H ?? o.height);
    if (l != null && w != null && h != null && l > 0 && w > 0 && h > 0) {
      const sorted = [l, w, h].sort((a, b) => a - b) as [number, number, number];
      dimsMmSorted = sorted;
    }
  }

  return { unitVolumeL, dimsMmSorted };
}

export function extractLocationPhysical(locAttrsJson: unknown): LocationPutawayPhysical {
  const attrs = asRecord(locAttrsJson);
  if (!attrs) {
    return { capacityQty: null, capacityVolumeL: null, innerDimsMmSorted: null };
  }
  const cq = num(attrs.capacityQty);
  const cv = num(attrs.capacityVolumeL);
  let innerDimsMmSorted: [number, number, number] | null = null;
  const inner = asRecord(attrs.innerDimsMm ?? attrs.dimsMm);
  if (inner) {
    const l = num(inner.l ?? inner.L ?? inner.length);
    const w = num(inner.w ?? inner.W ?? inner.width);
    const h = num(inner.h ?? inner.H ?? inner.height);
    if (l != null && w != null && h != null && l > 0 && w > 0 && h > 0) {
      innerDimsMmSorted = [l, w, h].sort((a, b) => a - b) as [number, number, number];
    }
  }
  return {
    capacityQty: cq != null && cq > 0 ? cq : null,
    capacityVolumeL: cv != null && cv > 0 ? cv : null,
    innerDimsMmSorted,
  };
}

/** Упаковка кладётся в ячейку, если при сортировке сторон по возрастанию помещается (3D «мини-в-макси»). */
export function packFitsCell(
  itemDims: [number, number, number] | null,
  cellDims: [number, number, number] | null
): boolean | null {
  if (!itemDims || !cellDims) return null;
  for (let i = 0; i < 3; i += 1) {
    if (itemDims[i] > cellDims[i]) return false;
  }
  return true;
}

export function describePhysicalBlock(
  item: ItemPutawayPhysical,
  loc: LocationPutawayPhysical,
  occupiedVolumeL: number,
  totalQtyAtLocation: number,
  incomingQty: number
): { forbidden: boolean; scorePenalty: number; note: string } {
  let forbidden = false;
  let scorePenalty = 0;
  const bits: string[] = [];

  const fit = packFitsCell(item.dimsMmSorted, loc.innerDimsMmSorted);
  if (fit === false) {
    forbidden = true;
    scorePenalty -= 10_000;
    bits.push("ВГХ не проходит в объём ячейки (innerDimsMm)");
  }

  if (loc.capacityVolumeL != null && item.unitVolumeL != null) {
    const after = occupiedVolumeL + item.unitVolumeL * incomingQty;
    if (after > loc.capacityVolumeL + 1e-9) {
      forbidden = true;
      scorePenalty -= 10_000;
      bits.push(`по объёму переполнение: ${after.toFixed(3)} л > ${loc.capacityVolumeL} л`);
    }
  } else if (loc.capacityVolumeL != null && item.unitVolumeL == null) {
    bits.push("у товара нет объёма единицы — проверка л не выполнена");
  }

  if (loc.capacityQty != null) {
    const afterQ = totalQtyAtLocation + incomingQty;
    if (afterQ > loc.capacityQty + 1e-9) {
      forbidden = true;
      scorePenalty -= 10_000;
      bits.push(`по количеству переполнение: ${afterQ} > ${loc.capacityQty}`);
    }
  }

  return { forbidden, scorePenalty, note: bits.join(" · ") };
}
