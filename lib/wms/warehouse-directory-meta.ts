/** MVP расширения карточки склада (хранятся в meta_json). */
export type WarehouseAddressMeta = {
  country?: string;
  region?: string;
  city?: string;
  street?: string;
  building?: string;
  room?: string;
  fullAddress?: string;
};

export type WarehouseMeta = {
  /** Доп. признаки (дублируют смысл типа там, где удобно фильтрам и ТСД) */
  isDefault?: boolean;
  isVirtual?: boolean;
  isQuarantine?: boolean;
  isProduction?: boolean;
  isTransit?: boolean;
  hasZones: boolean;
  hasCells: boolean;
  defaultZoneId?: string;
  defaultCellId?: string;
  locationName?: string;
  address?: WarehouseAddressMeta;
  managerUserId?: string;
  defaultKeeperUserId?: string;
  allowedUserIds?: string[];
  allowReceiving: boolean;
  allowTransferFrom: boolean;
  allowTransferTo: boolean;
  allowWriteOff: boolean;
  allowInventory: boolean;
  fefoEnabled: boolean;
  expirationControlEnabled: boolean;
  nearExpirationDays: number;
  criticalExpirationDays: number;
  blockExpiredItems: boolean;
  allowNoExpirationDate: boolean;
  defaultPrinterId?: string;
  defaultPrinterName?: string;
  printLabelOnReceiving: boolean;
  labelTemplateId?: string;
  labelWidthMm?: number;
  labelHeightMm?: number;
  accountingMode: "PIECE" | "BATCH" | "SERIAL" | "MARKING";
  negativeStockAllowed: boolean;
  reservationEnabled: boolean;
  batchControlEnabled: boolean;
  serialControlEnabled: boolean;
  markingCodeControlEnabled: boolean;
  externalId?: string;
  externalCode?: string;
  erpWarehouseCode?: string;
  scadaAreaCode?: string;
};

export function defaultWarehouseMeta(): WarehouseMeta {
  return {
    isDefault: false,
    isVirtual: false,
    isQuarantine: false,
    isProduction: false,
    isTransit: false,
    hasZones: true,
    hasCells: true,
    locationName: "",
    allowReceiving: true,
    allowTransferFrom: true,
    allowTransferTo: true,
    allowWriteOff: true,
    allowInventory: true,
    fefoEnabled: true,
    expirationControlEnabled: true,
    nearExpirationDays: 60,
    criticalExpirationDays: 30,
    blockExpiredItems: true,
    allowNoExpirationDate: false,
    printLabelOnReceiving: true,
    accountingMode: "MARKING",
    negativeStockAllowed: false,
    reservationEnabled: true,
    batchControlEnabled: true,
    serialControlEnabled: false,
    markingCodeControlEnabled: true,
  };
}

export function mergeWarehouseMeta(
  stored: Record<string, unknown> | null | undefined
): WarehouseMeta {
  const d = defaultWarehouseMeta();
  if (!stored || typeof stored !== "object") return d;
  return { ...d, ...(stored as Partial<WarehouseMeta>) };
}

export function statusToIsActive(statusCode: string): boolean {
  return statusCode === "ACTIVE";
}

/** Статусы карточки склада в справочнике (колонка status_code). */
export const WAREHOUSE_STATUS_CODES = ["ACTIVE", "INACTIVE", "BLOCKED", "ARCHIVED"] as const;
