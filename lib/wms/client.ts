import { loadWmsSiteCode, saveWmsSiteCode } from "@/lib/prefs";
import type {
  WmsDisposition,
  WmsCursorResponse,
  WmsDocumentDetailResponse,
  WmsDeviceRegisterResult,
  WmsDevicesResponse,
  WmsDocumentRow,
  WmsIssueInput,
  WmsItemListRow,
  WmsItemOverviewResponse,
  WmsItemWhereUsedResponse,
  WmsLocationResponse,
  WmsLookupResponse,
  WmsTaskCreateInput,
  WmsTaskCreateResult,
  WmsTaskDetailResponse,
  WmsTaskMutationResult,
  WmsTaskRow,
  WmsVirtualContentRow,
  WmsVirtualLayoutDetailResponse,
  WmsVirtualLayoutsResponse,
  WmsReceivingInput,
  WmsPutawayRecommendResponse,
  WmsWarehouseOccupancyResponse,
  WmsReturnInput,
  WmsRevisionInput,
  WmsTransferInput,
  WmsWriteResult,
} from "@/lib/wms/types";

const DEFAULT_SITE_CODE = "DEFAULT";

export class WmsClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly disposition?: WmsDisposition
  ) {
    super(message);
    this.name = "WmsClientError";
  }
}

export function getDefaultWmsSiteCode(): string {
  return loadWmsSiteCode() ?? DEFAULT_SITE_CODE;
}

export function rememberWmsSiteCode(siteCode: string) {
  saveWmsSiteCode(siteCode);
}

export function createWmsRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<Record<string, unknown>>(res);
  if (!res.ok) {
    throw new WmsClientError(
      typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
      res.status,
      typeof data?.code === "string" ? data.code : undefined,
      typeof data?.disposition === "string"
        ? (data.disposition as WmsDisposition)
        : undefined
    );
  }
  return (data ?? {}) as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const data = await parseJson<Record<string, unknown>>(res);
  if (!res.ok) {
    throw new WmsClientError(
      typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
      res.status,
      typeof data?.code === "string" ? data.code : undefined,
      typeof data?.disposition === "string"
        ? (data.disposition as WmsDisposition)
        : undefined
    );
  }
  return (data ?? {}) as T;
}

export async function lookupWms(
  siteCode: string,
  query: string
): Promise<WmsLookupResponse> {
  return postJson<WmsLookupResponse>("/api/wms/lookup", {
    siteCode,
    query,
  });
}

export async function getWmsLocation(
  siteCode: string,
  locationCode: string
): Promise<WmsLocationResponse> {
  return getJson<WmsLocationResponse>(
    `/api/wms/locations/${encodeURIComponent(locationCode)}?siteCode=${encodeURIComponent(siteCode)}`
  );
}

export async function setWmsLocationBlocked(input: {
  requestId: string;
  siteCode: string;
  locationCode: string;
  blocked: boolean;
}): Promise<WmsWriteResult> {
  return postJson<WmsWriteResult>(
    `/api/wms/locations/${encodeURIComponent(input.locationCode)}/block`,
    {
      requestId: input.requestId,
      siteCode: input.siteCode,
      blocked: input.blocked,
    }
  );
}

export async function createReceiving(
  input: WmsReceivingInput
): Promise<WmsWriteResult> {
  return postJson<WmsWriteResult>("/api/wms/receivings", input);
}

export async function recommendWmsPutaway(input: {
  siteCode: string;
  itemCode: string;
  lotCode?: string | null;
  limit?: number;
  /** Количество к размещению — для проверки ёмкости ячейки */
  qty?: number;
}): Promise<WmsPutawayRecommendResponse> {
  return postJson<WmsPutawayRecommendResponse>("/api/wms/putaway/recommend", input);
}

export async function getWmsWarehouseOccupancy(input: {
  siteCode: string;
}): Promise<WmsWarehouseOccupancyResponse> {
  const q = new URLSearchParams({ siteCode: input.siteCode });
  const res = await fetch(`/api/wms/warehouse/occupancy?${q.toString()}`, { method: "GET" });
  const data = (await res.json()) as WmsWarehouseOccupancyResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function createTransfer(
  input: WmsTransferInput
): Promise<WmsWriteResult> {
  return postJson<WmsWriteResult>("/api/wms/transfers/confirm", input);
}

export async function createIssue(input: WmsIssueInput): Promise<WmsWriteResult> {
  return postJson<WmsWriteResult>("/api/wms/issues", input);
}

export async function createReturn(
  input: WmsReturnInput
): Promise<WmsWriteResult> {
  return postJson<WmsWriteResult>("/api/wms/returns", input);
}

export async function createRevision(
  input: WmsRevisionInput
): Promise<WmsWriteResult> {
  return postJson<WmsWriteResult>("/api/wms/revisions", input);
}

export async function listWmsTasks(input: {
  siteCode: string;
  cursor?: string;
  limit?: number;
  status?: string;
  type?: string;
  assignedUserId?: string;
  assignedDeviceId?: string;
  query?: string;
}): Promise<WmsCursorResponse<WmsTaskRow>> {
  const qp = new URLSearchParams();
  qp.set("siteCode", input.siteCode);
  if (input.cursor) qp.set("cursor", input.cursor);
  if (input.limit) qp.set("limit", String(input.limit));
  if (input.status) qp.set("status", input.status);
  if (input.type) qp.set("type", input.type);
  if (input.assignedUserId) qp.set("assignedUserId", input.assignedUserId);
  if (input.assignedDeviceId) qp.set("assignedDeviceId", input.assignedDeviceId);
  if (input.query) qp.set("query", input.query);
  return getJson<WmsCursorResponse<WmsTaskRow>>(`/api/wms/tasks?${qp.toString()}`);
}

export async function listWmsDevices(input: {
  siteCode: string;
  status?: string;
  query?: string;
}): Promise<WmsDevicesResponse> {
  const qp = new URLSearchParams();
  qp.set("siteCode", input.siteCode);
  if (input.status) qp.set("status", input.status);
  if (input.query) qp.set("query", input.query);
  return getJson<WmsDevicesResponse>(`/api/wms/devices?${qp.toString()}`);
}

export async function registerWmsDevice(input: {
  siteCode: string;
  deviceUid: string;
  deviceName: string;
  platform?: string;
  appVersion?: string;
}): Promise<WmsDeviceRegisterResult> {
  return postJson<WmsDeviceRegisterResult>("/api/wms/devices/register", input);
}

export async function createWmsTasks(
  input: WmsTaskCreateInput
): Promise<WmsTaskCreateResult> {
  return postJson<WmsTaskCreateResult>("/api/wms/tasks", input);
}

export async function getWmsTaskDetail(input: {
  siteCode: string;
  taskId: string;
}): Promise<WmsTaskDetailResponse> {
  return getJson<WmsTaskDetailResponse>(
    `/api/wms/tasks/${encodeURIComponent(input.taskId)}?siteCode=${encodeURIComponent(input.siteCode)}`
  );
}

export async function claimWmsTask(input: {
  requestId: string;
  siteCode: string;
  taskId: string;
  assignedUserId?: string;
}): Promise<WmsTaskMutationResult> {
  return postJson<WmsTaskMutationResult>(
    `/api/wms/tasks/${encodeURIComponent(input.taskId)}/claim`,
    input
  );
}

export async function assignWmsTaskDevice(input: {
  requestId: string;
  siteCode: string;
  taskId: string;
  deviceUid: string;
  assignedUserId?: string;
}): Promise<WmsTaskMutationResult> {
  return postJson<WmsTaskMutationResult>(
    `/api/wms/tasks/${encodeURIComponent(input.taskId)}/assign-device`,
    input
  );
}

export async function startWmsTask(input: {
  requestId: string;
  siteCode: string;
  taskId: string;
}): Promise<WmsTaskMutationResult> {
  return postJson<WmsTaskMutationResult>(
    `/api/wms/tasks/${encodeURIComponent(input.taskId)}/start`,
    input
  );
}

export async function completeWmsTask(input: {
  requestId: string;
  siteCode: string;
  taskId: string;
  confirmedQty?: number;
  targetLocationCode?: string;
  note?: string;
}): Promise<WmsTaskMutationResult> {
  return postJson<WmsTaskMutationResult>(
    `/api/wms/tasks/${encodeURIComponent(input.taskId)}/complete`,
    input
  );
}

export async function reportWmsTaskException(input: {
  requestId: string;
  siteCode: string;
  taskId: string;
  exceptionCode: string;
  exceptionNote?: string;
}): Promise<WmsTaskMutationResult> {
  return postJson<WmsTaskMutationResult>(
    `/api/wms/tasks/${encodeURIComponent(input.taskId)}/exception`,
    input
  );
}

export async function listWmsDocuments(input: {
  siteCode: string;
  cursor?: string;
  limit?: number;
  documentType?: string;
  status?: string;
}): Promise<WmsCursorResponse<WmsDocumentRow>> {
  const qp = new URLSearchParams();
  qp.set("siteCode", input.siteCode);
  if (input.cursor) qp.set("cursor", input.cursor);
  if (input.limit) qp.set("limit", String(input.limit));
  if (input.documentType) qp.set("documentType", input.documentType);
  if (input.status) qp.set("status", input.status);
  return getJson<WmsCursorResponse<WmsDocumentRow>>(
    `/api/wms/documents?${qp.toString()}`
  );
}

export async function getWmsDocumentDetail(input: {
  siteCode: string;
  documentId: string;
}): Promise<WmsDocumentDetailResponse> {
  return getJson<WmsDocumentDetailResponse>(
    `/api/wms/documents/${encodeURIComponent(input.documentId)}?siteCode=${encodeURIComponent(input.siteCode)}`
  );
}

export async function listWmsItems(input: {
  siteCode: string;
  cursor?: string;
  limit?: number;
  query?: string;
  materialType?: string;
  productGroup?: string;
  groupCode?: string;
  classCode?: string;
}): Promise<WmsCursorResponse<WmsItemListRow>> {
  const qp = new URLSearchParams();
  qp.set("siteCode", input.siteCode);
  if (input.cursor) qp.set("cursor", input.cursor);
  if (input.limit) qp.set("limit", String(input.limit));
  if (input.query) qp.set("query", input.query);
  if (input.materialType) qp.set("materialType", input.materialType);
  if (input.productGroup) qp.set("productGroup", input.productGroup);
  if (input.groupCode) qp.set("groupCode", input.groupCode);
  if (input.classCode) qp.set("classCode", input.classCode);
  return getJson<WmsCursorResponse<WmsItemListRow>>(`/api/wms/items?${qp.toString()}`);
}

export async function getWmsItemOverview(input: {
  siteCode: string;
  itemCode: string;
}): Promise<WmsItemOverviewResponse> {
  return getJson<WmsItemOverviewResponse>(
    `/api/wms/items/${encodeURIComponent(input.itemCode)}?siteCode=${encodeURIComponent(input.siteCode)}`
  );
}

export async function getWmsItemWhereUsed(input: {
  siteCode: string;
  itemCode: string;
}): Promise<WmsItemWhereUsedResponse> {
  return getJson<WmsItemWhereUsedResponse>(
    `/api/wms/items/${encodeURIComponent(input.itemCode)}/where-used?siteCode=${encodeURIComponent(input.siteCode)}`
  );
}

export async function listWmsVirtualLayouts(input: {
  siteCode: string;
  warehouseCode?: string;
  query?: string;
}): Promise<WmsVirtualLayoutsResponse> {
  const qp = new URLSearchParams();
  qp.set("siteCode", input.siteCode);
  if (input.warehouseCode) qp.set("warehouseCode", input.warehouseCode);
  if (input.query) qp.set("query", input.query);
  return getJson<WmsVirtualLayoutsResponse>(`/api/wms/virtual/layouts?${qp.toString()}`);
}

export async function createWmsVirtualLayout(input: {
  siteCode: string;
  layoutCode: string;
  name: string;
  warehouseCode?: string;
  zoneCode?: string;
  description?: string;
  scenePrefs?: Record<string, unknown> | null;
}): Promise<WmsVirtualLayoutDetailResponse> {
  return postJson<WmsVirtualLayoutDetailResponse>("/api/wms/virtual/layouts", input);
}

export async function getWmsVirtualLayout(input: {
  siteCode: string;
  layoutId: string;
  includeContents?: boolean;
}): Promise<WmsVirtualLayoutDetailResponse> {
  const qp = new URLSearchParams();
  qp.set("siteCode", input.siteCode);
  if (input.includeContents === false) qp.set("includeContents", "0");
  return getJson<WmsVirtualLayoutDetailResponse>(
    `/api/wms/virtual/layouts/${encodeURIComponent(input.layoutId)}?${qp.toString()}`
  );
}

export async function getWmsVirtualNodeContents(input: {
  siteCode: string;
  nodeId: string;
}): Promise<{ contents: WmsVirtualContentRow[] }> {
  return getJson<{ contents: WmsVirtualContentRow[] }>(
    `/api/wms/virtual/nodes/${encodeURIComponent(input.nodeId)}/contents?siteCode=${encodeURIComponent(input.siteCode)}`
  );
}

/** Узел виртуального склада, привязанный к физической ячейке (если есть). */
export async function resolveVirtualLocationOnLayout(input: {
  siteCode: string;
  locationCode: string;
}): Promise<{ layoutId: string | null; nodeId: string | null }> {
  const qp = new URLSearchParams({
    siteCode: input.siteCode,
    locationCode: input.locationCode,
  });
  return getJson<{ layoutId: string | null; nodeId: string | null }>(
    `/api/wms/virtual/resolve-location?${qp.toString()}`
  );
}

export async function updateWmsVirtualLayout(input: {
  siteCode: string;
  layoutId: string;
  layoutCode?: string;
  name: string;
  warehouseCode?: string;
  zoneCode?: string;
  description?: string;
  scenePrefs?: Record<string, unknown> | null;
}): Promise<WmsVirtualLayoutDetailResponse> {
  return postJson<WmsVirtualLayoutDetailResponse>(
    `/api/wms/virtual/layouts/${encodeURIComponent(input.layoutId)}`,
    input
  );
}

export async function createWmsVirtualNode(input: {
  siteCode: string;
  layoutId: string;
  parentNodeId?: string | null;
  nodeType: string;
  code?: string;
  label: string;
  posX?: number;
  posY?: number;
  posZ?: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  sortOrder?: number;
  props?: Record<string, unknown> | null;
}): Promise<{ nodeId: string }> {
  return postJson<{ nodeId: string }>("/api/wms/virtual/nodes", input);
}

export async function updateWmsVirtualNode(input: {
  siteCode: string;
  nodeId: string;
  parentNodeId?: string | null;
  code?: string;
  label?: string;
  posX?: number;
  posY?: number;
  posZ?: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  sortOrder?: number;
  props?: Record<string, unknown> | null;
  locationCode?: string | null;
  loadUnitCode?: string | null;
}): Promise<{ nodeId: string }> {
  return postJson<{ nodeId: string }>(
    `/api/wms/virtual/nodes/${encodeURIComponent(input.nodeId)}`,
    input
  );
}

export async function deleteWmsVirtualNode(input: {
  siteCode: string;
  nodeId: string;
}): Promise<{ nodeId: string }> {
  return postJson<{ nodeId: string }>(
    `/api/wms/virtual/nodes/${encodeURIComponent(input.nodeId)}/delete`,
    input
  );
}

export async function saveWmsVirtualNodeContents(input: {
  siteCode: string;
  nodeId: string;
  contents: Array<{
    itemCode: string;
    qty: number;
    uomCode?: string;
    lotCode?: string;
    note?: string;
    sortOrder?: number;
  }>;
}): Promise<{ nodeId: string; count: number }> {
  return postJson<{ nodeId: string; count: number }>(
    `/api/wms/virtual/nodes/${encodeURIComponent(input.nodeId)}/contents`,
    input
  );
}
