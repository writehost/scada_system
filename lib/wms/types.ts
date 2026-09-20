export type WmsDisposition = "applied" | "duplicate" | "conflict" | "failed";

export interface WmsLookupItem {
  itemCode: string;
  barcode: string | null;
  name: string;
  locationCode: string;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  inTransitQty?: number;
  quarantineQty: number;
  rejectedQty: number;
  accuracyStatus: string;
  locationStatus?: string;
}

export interface WmsLookupResponse {
  items: WmsLookupItem[];
}

export interface WmsLocationSummary {
  locationCode: string;
  displayName: string;
  locationStatus: string;
  accuracyStatus: string;
  warehouseCode?: string;
  zoneCode?: string;
  isPickFace?: boolean;
}

export interface WmsLocationStockRow {
  itemCode: string;
  barcode: string | null;
  name: string;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  inTransitQty?: number;
  quarantineQty: number;
  rejectedQty: number;
  accuracyStatus: string;
}

export interface WmsMovementRow {
  at: string;
  movementType: string;
  qty: number;
  itemCode: string;
  fromLocationCode: string | null;
  toLocationCode: string | null;
}

export interface WmsLocationResponse {
  location: WmsLocationSummary;
  stock: WmsLocationStockRow[];
  history: WmsMovementRow[];
}

export interface WmsStockSnapshot {
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  inTransitQty?: number;
  quarantineQty: number;
  rejectedQty: number;
  accuracyStatus: string;
  locationCode: string;
  locationStatus: string;
}

export interface WmsLocationStatusPayload {
  locationCode: string;
  locationStatus: string;
}

export interface WmsWriteResult {
  disposition: WmsDisposition;
  documentId?: string;
  /** Код из `ref_wms_document_type.code` — приходит с API проводок для подписи и фильтров. */
  documentType?: string;
  revisionId?: string;
  stock?: WmsStockSnapshot | null;
  location?: WmsLocationStatusPayload;
  code?: string;
  error?: string;
  message?: string;
}

export interface WmsReceivingInput {
  requestId: string;
  siteCode: string;
  itemCode: string;
  targetLocationCode: string;
  qty: number;
  batchLabel?: string;
  /** Номер/идентификатор входящего документа в 1С → в `wms_documents.payload_json.externalRef1c`. */
  externalRef1c?: string | null;
  /** Дата/время приёмки (ISO) → в `wms_documents.payload_json.receiptAtIso`. */
  receiptAt?: string | null;
  /** Идентификатор номенклатуры в 1С (для сверки, в payload документа). */
  erpItem1cId?: string | null;
  /** Количество по строке входящего документа 1С. */
  erpDocumentLineQty?: number | string | null;
  /** Срок годности по документу 1С (дата строкой). */
  erpDocumentExpiryDate?: string | null;
  /** Обязателен, если заполнено хотя бы одно из полей erp*. */
  confirmedMatch1c?: boolean;
  /** Срок годности принимаемой партии (ISO) → `wms_stock_lots.expiry_at` и `wms_lots`. */
  lotExpiryAt?: string | null;
  /** ВГХ, зафиксированные на этой приёмке (не меняют карточку товара). */
  receiptUnitVolumeL?: number | string | null;
  receiptDimLengthMm?: number | string | null;
  receiptDimWidthMm?: number | string | null;
  receiptDimHeightMm?: number | string | null;
}

export interface WmsPutawayRecommendationRow {
  locationCode: string;
  score: number;
  forbidden: boolean;
  reason: string;
  details?: string | null;
}

export interface WmsPutawayRecommendResponse {
  itemCode: string;
  lotCode: string | null;
  policy: {
    mergeLots: boolean;
    rotationPolicy?: "fifo" | "fefo" | "manual";
    unitVolumeL?: number | null;
    hasDims?: boolean;
  };
  recommendations: WmsPutawayRecommendationRow[];
}

export interface WmsWarehouseOccupancyZoneRow {
  warehouseCode: string;
  zoneCode: string;
  locationCount: number;
  nonEmptyCount: number;
  emptyCount: number;
  totalAvailableQty: number;
  declaredCapacityQtySum: number;
  fillRatioDeclared: number | null;
}

export interface WmsWarehouseOccupancyResponse {
  siteCode: string;
  zones: WmsWarehouseOccupancyZoneRow[];
  totals: {
    locationCount: number;
    nonEmptyCount: number;
    emptyCount: number;
    totalAvailableQty: number;
    declaredCapacityQtySum: number;
    fillRatioDeclared: number | null;
  };
}

export interface WmsTransferInput {
  requestId: string;
  siteCode: string;
  itemCode: string;
  fromLocationCode: string;
  toLocationCode: string;
  qty: number;
}

export interface WmsIssueInput {
  requestId: string;
  siteCode: string;
  itemCode: string;
  sourceLocationCode: string;
  qty: number;
  recipientName: string;
  lineName?: string;
}

export interface WmsReturnInput {
  requestId: string;
  siteCode: string;
  itemCode: string;
  sourceLocationCode: string;
  targetLocationCode: string;
  qty: number;
  operatorName: string;
}

export interface WmsRevisionLine {
  itemCode: string;
  actualQty: number;
}

export interface WmsRevisionInput {
  requestId: string;
  siteCode: string;
  locationCode: string;
  checkedBy: string;
  comment?: string;
  lines: WmsRevisionLine[];
}

export interface WmsCursorResponse<T> {
  nextCursor: string;
  items?: T[];
  tasks?: T[];
  documents?: T[];
}

export interface WmsItemListRow {
  cursor: string;
  itemCode: string;
  sku: string | null;
  name: string;
  materialType: string | null;
  productGroup: string | null;
  itemGroupCode: string | null;
  itemClassCode: string | null;
  itemSubgroup: string | null;
  packagingFormat: string | null;
  packagingProfile: string | null;
  itemAttrs: Record<string, unknown> | null;
  nomenclature: string | null;
  lineGroup: string | null;
  uomCode: string;
  isMarked: boolean;
  isPerishable: boolean;
  rotationPolicy: string;
  shelfLifeDays: number | null;
  expiryWarningDays: number | null;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  inTransitQty: number;
  quarantineQty: number;
  rejectedQty: number;
  hasActiveSpec: boolean;
}

export interface WmsItemResourceRow {
  specComponentId: string;
  itemCode: string;
  name: string;
  materialType: string | null;
  productGroup: string | null;
  componentRoleCode: string | null;
  qtyPer: number;
  uomCode: string;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  inTransitQty: number;
  quarantineQty: number;
  rejectedQty: number;
  earliestExpiryAt: string | null;
  lotCount: number;
}

export interface WmsItemWhereUsedRow {
  itemCode: string;
  name: string;
  materialType: string | null;
  productGroup: string | null;
  specCode: string;
  versionNo: number;
  componentRoleCode: string | null;
  qtyPer: number;
  uomCode: string;
}

export interface WmsItemWhereUsedResponse {
  whereUsed: WmsItemWhereUsedRow[];
}

export interface WmsItemLotRow {
  lotId: string;
  lotCode: string;
  batchLabel: string | null;
  receivedAt: string | null;
  manufacturedAt: string | null;
  bestBeforeAt: string | null;
  expiryAt: string | null;
  qaStatusCode: string | null;
  availableQty: number;
  reservedQty: number;
  inTransitQty: number;
  quarantineQty: number;
  rejectedQty: number;
}

export interface WmsItemUomRow {
  itemUomId: string;
  uomCode: string;
  uomName: string | null;
  qtyInBase: number;
  levelNo: number;
  isBase: boolean;
  isShipping: boolean;
  maxPerLoadUnit: number | null;
  weightKg: number | null;
  volumeL: number | null;
}

export interface WmsItemLocationRow {
  locationCode: string;
  warehouseCode: string;
  zoneCode: string;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  inTransitQty: number;
  quarantineQty: number;
  rejectedQty: number;
  accuracyStatus: string;
}

export interface WmsItemOverviewResponse {
  item: {
    itemId: string;
    itemCode: string;
    sku: string | null;
    name: string;
    materialType: string | null;
    productGroup: string | null;
    itemGroupCode: string | null;
    itemClassCode: string | null;
    itemSubgroup: string | null;
    packagingFormat: string | null;
    packagingProfile: string | null;
    itemAttrs: Record<string, unknown> | null;
    nomenclature: string | null;
    lineGroup: string | null;
    uomCode: string;
    isMarked: boolean;
    isPerishable: boolean;
    rotationPolicy: string;
    shelfLifeDays: number | null;
    expiryWarningDays: number | null;
    primaryBarcode: string | null;
  };
  activeSpec: {
    specId: string;
    specCode: string;
    versionNo: number;
    effectiveFrom: string;
    comment: string | null;
  } | null;
  totals: {
    availableQty: number;
    reservedQty: number;
    inProductionQty: number;
    inTransitQty: number;
    quarantineQty: number;
    rejectedQty: number;
  };
  stockByLocation: WmsItemLocationRow[];
  lots: WmsItemLotRow[];
  itemUoms: WmsItemUomRow[];
  resources: WmsItemResourceRow[];
}

export interface WmsLotRow {
  lotId: string;
  itemCode: string;
  itemName: string;
  lotCode: string;
  batchLabel: string | null;
  supplierLotCode: string | null;
  receivedAt: string | null;
  bestBeforeAt: string | null;
  expiryAt: string | null;
  qaStatusCode: string | null;
  isBlocked: boolean;
  availableQty: number;
  reservedQty: number;
  inTransitQty: number;
  quarantineQty: number;
  rejectedQty: number;
}

export interface WmsDocumentRow {
  cursor: string;
  documentId: string;
  documentType: string;
  documentStatus: string;
  documentNo: string | null;
  sourceWarehouseCode: string | null;
  targetWarehouseCode: string | null;
  sourceLocationCode: string | null;
  targetLocationCode: string | null;
  externalRef: string | null;
  comment: string | null;
  priorityCode: string | null;
  createdAt: string;
  /** Проведение в WMS (если есть в выборке). */
  appliedAt?: string | null;
  /** Фактическая дата приёмки оператором. */
  receiptAt?: string | null;
  releasedAt: string | null;
  /** Доп. данные (1С, ВГХ при приёмке и т.п.). */
  payloadJson?: Record<string, unknown> | null;
  lineCount: number;
  taskCount: number;
}

export interface WmsDocumentDetailResponse {
  document: Omit<WmsDocumentRow, "cursor" | "lineCount" | "taskCount">;
  lines: Array<{
    documentLineId: string;
    lineNo: number;
    itemCode: string;
    itemName: string;
    requestedQty: number;
    confirmedQty: number;
    sourceLocationCode: string | null;
    targetLocationCode: string | null;
    requestedUomCode: string | null;
    loadUnitId: string | null;
    loadUnitCode: string | null;
    loadUnitType: string | null;
    lotCode: string | null;
    batchLabel: string | null;
    manufacturedAt: string | null;
    taskPayload: Record<string, unknown> | null;
    comment: string | null;
  }>;
  loadUnits: Array<{
    loadUnitId: string;
    loadUnitCode: string;
    loadUnitType: string;
    statusCode: string;
    label: string | null;
    mixedItemsAllowed: boolean;
    lineCount: number;
    totalBaseQty: number;
  }>;
  tasks: Array<{
    taskId: string;
    taskCode: string;
    taskType: string;
    taskStatus: string;
    priorityCode: string;
    plannedQty: number;
    confirmedQty: number;
    assignedUser: string | null;
    assignedDevice: string | null;
    dueAt: string | null;
    claimedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    exceptionCode: string | null;
  }>;
}

export interface WmsTaskRow {
  cursor: string;
  taskId: string;
  taskCode: string;
  documentId: string | null;
  taskType: string;
  taskStatus: string;
  priorityCode: string;
  itemCode: string | null;
  itemName: string | null;
  sourceWarehouseCode: string | null;
  targetWarehouseCode: string | null;
  sourceLocationCode: string | null;
  targetLocationCode: string | null;
  plannedQty: number;
  confirmedQty: number;
  assignedUser: string | null;
  assignedDevice?: string | null;
  documentNo: string | null;
  dueAt: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  exceptionCode: string | null;
}

export interface WmsTaskDetailResponse {
  task: {
    taskId: string;
    taskCode: string;
    taskType: string;
    taskStatus: string;
    priorityCode: string;
    plannedQty: number;
    confirmedQty: number;
    sequenceNo: number;
    dueAt: string | null;
    claimedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    releasedAt: string | null;
    exceptionCode: string | null;
    exceptionNote: string | null;
    taskPayload: Record<string, unknown> | null;
    itemCode: string | null;
    itemName: string | null;
    lotCode: string | null;
    batchLabel: string | null;
    documentId: string | null;
    documentNo: string | null;
    documentType: string | null;
    documentStatus: string | null;
    sourceWarehouseCode: string | null;
    targetWarehouseCode: string | null;
    sourceLocationCode: string | null;
    targetLocationCode: string | null;
    assignedUser: string | null;
    assignedDevice: string | null;
  };
  movements: Array<{
    movementId: string;
    at: string;
    qty: number;
    movementType: string;
    fromLocationCode: string | null;
    toLocationCode: string | null;
  }>;
}

export type WmsTaskOperationType = "receipt" | "shipment" | "revision";

export interface WmsTaskCreateLineInput {
  itemCode: string;
  qty?: number;
  uomCode?: string;
  palletsQty?: number;
  blocksQty?: number;
  unitsQty?: number;
  sourceLocationCode?: string;
  targetLocationCode?: string;
  lotCode?: string;
  batchLabel?: string;
  manufacturedAt?: string;
  bestBeforeAt?: string;
  expiryAt?: string;
  loadUnitCode?: string;
  loadUnitLabel?: string;
  loadUnitType?: string;
  mixedItemsAllowed?: boolean;
  comment?: string;
}

export interface WmsTaskCreateInput {
  requestId: string;
  siteCode: string;
  operationType: WmsTaskOperationType;
  priorityCode?: "low" | "normal" | "high" | "urgent";
  documentNo?: string;
  externalRef?: string;
  comment?: string;
  sourceWarehouseCode?: string;
  targetWarehouseCode?: string;
  sourceLocationCode?: string;
  targetLocationCode?: string;
  assignUserId?: string;
  lines: WmsTaskCreateLineInput[];
}

export interface WmsTaskCreateResult {
  documentId: string;
  lineCount: number;
  taskCount: number;
  operationType: WmsTaskOperationType;
  documentType: string;
  loadUnits: Array<{
    loadUnitId: string;
    loadUnitCode: string;
  }>;
  createdLines: Array<{
    documentLineId: string;
    taskId: string;
  }>;
}

export interface WmsTaskMutationResult {
  taskId: string;
  documentId?: string | null;
  stock?: WmsStockSnapshot | null;
  deviceId?: string | null;
  deviceUid?: string | null;
  deviceName?: string | null;
}

export interface WmsDeviceRow {
  deviceId: string;
  deviceUid: string;
  deviceName: string;
  platform: string | null;
  appVersion: string | null;
  deviceStatus: string;
  assignedUser: string | null;
  lastSeenAt: string | null;
  openTaskCount: number;
  activeTaskCount: number;
  exceptionTaskCount: number;
  completedTaskCount: number;
  totalTaskCount: number;
}

export interface WmsDevicesResponse {
  devices: WmsDeviceRow[];
}

export interface WmsDeviceRegisterResult {
  device: {
    deviceId: string;
    deviceUid: string;
    deviceName: string;
    platform: string | null;
    appVersion: string | null;
    deviceStatus: string;
    lastSeenAt: string | null;
  };
}

export type WmsVirtualNodeType =
  | "room"
  | "rack"
  | "shelf"
  | "pallet"
  | "box"
  | "bin"
  | "container"
  | "pallet_slot";

export interface WmsVirtualLayoutSummary {
  layoutId: string;
  layoutCode: string;
  name: string;
  description: string | null;
  warehouseCode: string | null;
  zoneCode: string | null;
  scenePrefs: Record<string, unknown> | null;
  updatedAt: string;
  nodeCount: number;
}

export interface WmsVirtualNodeRow {
  nodeId: string;
  parentNodeId: string | null;
  nodeType: WmsVirtualNodeType;
  code: string | null;
  label: string;
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  sortOrder: number;
  props: Record<string, unknown> | null;
  locationId: string | null;
  locationCode: string | null;
  linkedItemId: string | null;
  linkedItemCode: string | null;
  loadUnitId: string | null;
  loadUnitCode: string | null;
  loadUnitType: string | null;
  taskId: string | null;
  locationAvailableQty: number;
  locationReservedQty: number;
  locationSkuCount: number;
}

export interface WmsVirtualContentRow {
  virtualContentId: string;
  nodeId: string;
  itemCode: string;
  itemName: string;
  lotCode: string | null;
  isPerishable: boolean;
  rotationPolicy: string | null;
  expiryWarningDays: number | null;
  bestBeforeAt: string | null;
  expiryAt: string | null;
  qty: number;
  uomCode: string;
  note: string | null;
  sortOrder: number;
  locationAvailableQty: number | null;
  locationReservedQty: number | null;
}

export interface WmsVirtualLayoutDetailResponse {
  layout: {
    layoutId: string;
    layoutCode: string;
    name: string;
    description: string | null;
    warehouseCode: string | null;
    zoneCode: string | null;
    scenePrefs: Record<string, unknown> | null;
    updatedAt: string;
  };
  nodes: WmsVirtualNodeRow[];
  contents: WmsVirtualContentRow[];
}

export interface WmsVirtualLayoutsResponse {
  layouts: WmsVirtualLayoutSummary[];
}

export interface WmsLocationListRow {
  locationCode: string;
  displayName: string;
  warehouseCode: string;
  zoneCode: string;
  locationStatus: string;
  accuracyStatus: string;
  availableQty: number;
  reservedQty: number;
  inProductionQty: number;
  inTransitQty: number;
  skuCount: number;
}

export interface WmsReservationRow {
  reservationId: string;
  itemCode: string;
  itemName: string;
  locationCode: string | null;
  documentId: string | null;
  documentNo: string | null;
  stockBucket: string;
  reservedFor: string | null;
  reservedQty: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface WmsConflictRow {
  conflictId: string;
  conflictType: string;
  entityType: string | null;
  entityId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface WmsDocumentCreateLineInput {
  itemCode: string;
  qty: number;
  sourceLocationCode?: string;
  targetLocationCode?: string;
  lotCode?: string;
  batchLabel?: string;
  comment?: string;
  taskPayload?: Record<string, unknown>;
}

export interface WmsDocumentCreateInput {
  requestId: string;
  siteCode: string;
  documentType:
    | "receiving"
    | "putaway"
    | "replenishment"
    | "transfer"
    | "interwarehouse_transfer"
    | "issue"
    | "return"
    | "revision"
    | "picking"
    | "shipping";
  sourceWarehouseCode?: string;
  targetWarehouseCode?: string;
  sourceLocationCode?: string;
  targetLocationCode?: string;
  priorityCode?: "low" | "normal" | "high" | "urgent";
  documentNo?: string;
  externalRef?: string;
  comment?: string;
  assignUserId?: string;
  lines: WmsDocumentCreateLineInput[];
}
