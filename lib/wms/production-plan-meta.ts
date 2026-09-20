export type ProductionPlanStatus =
  | "draft"
  | "checked"
  | "reserved"
  | "in_progress"
  | "done"
  | "cancelled";

export type ProductionPlanExternalSource = "manual" | "1c" | "import" | "vekas";

export type ProductionPlanMaterialRow = {
  planMaterialId: string;
  itemCode: string;
  itemName: string;
  qtyPer: number;
  scrapPct: number;
  requiredQty: number;
  availableQty: number;
  reservedQty: number;
  shortageQty: number;
  uomCode: string;
  sortOrder: number;
};

export type ProductionPlanLinkType = "s2s" | "s2e" | "e2s" | "e2e";

export type ProductionPlanLinkRow = {
  linkId: string;
  sourcePlanId: string;
  targetPlanId: string;
  type: ProductionPlanLinkType;
  lagDays: number;
};

export type ProductionPlanRow = {
  planId: string;
  code: string;
  planDate: string;
  planDateTo: string | null;
  workshopCode: string | null;
  lineCode: string | null;
  itemCode: string;
  itemName: string;
  /** Составное наименование / формат (колонка `wms_items.nomenclature`). */
  itemNomenclature?: string | null;
  itemSku?: string | null;
  packagingFormat?: string | null;
  packagingProfile?: string | null;
  plannedQty: number;
  status: ProductionPlanStatus;
  materialWarehouseCode: string;
  externalSource: ProductionPlanExternalSource;
  externalId: string | null;
  actualPercent: number;
  actualQty: number | null;
  actualUpdatedAt: string | null;
  actualSource: string | null;
  note: string | null;
  shortageCount: number;
  isFullyCovered: boolean;
  reservedAt: string | null;
  materials?: ProductionPlanMaterialRow[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  vekasProducedQty?: number | null;
};

export function normalizePlanCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "-");
}

export function planCodeFromDate(dateKey: string, seq: number): string {
  const compact = dateKey.replace(/-/g, "");
  return `PLN-${compact}-${String(seq).padStart(3, "0")}`;
}

export function reservedForPlan(planId: number | string): string {
  return `aps:plan:${planId}`;
}
