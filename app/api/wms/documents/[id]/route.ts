import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { getDocumentDetail } from "@/lib/wms/documents";
import { getCodeListById } from "@/lib/wms/code-lists";
import { assertDeviceMayReadDocument } from "@/lib/wms/device-operator-auth";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeDocumentId(raw: string): string {
  let value = (raw || "").trim();
  // Some clients can send double-encoded path params (code-list%253A1).
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      break;
    }
  }
  return value;
}

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const documentId = normalizeDocumentId(params.id ?? "");
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const deviceUid = url.searchParams.get("deviceUid") ?? "";
  const operatorUserId = url.searchParams.get("operatorUserId") ?? "";
  const taskId = url.searchParams.get("taskId") ?? "";
  if (!siteCode.trim() || !documentId.trim()) {
    return NextResponse.json(
      { error: "siteCode and document id are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    if (documentId.startsWith("code-list:")) {
      const codeListId = documentId.slice("code-list:".length).trim();
      if (!codeListId) {
        return NextResponse.json({ error: "document not found" }, { status: 404 });
      }
      const row = await getCodeListById(client, siteId, codeListId);
      if (!row) {
        return NextResponse.json({ error: "document not found" }, { status: 404 });
      }
      const entries = Array.isArray((row as any).entries) ? (row as any).entries : [];
      const requestId = String((row as any).requestId ?? codeListId);
      const listType = String((row as any).listType ?? "scanner_collect");
      const documentType =
        listType === "aggregation_block_doc" ||
        listType === "aggregation_pallet_doc" ||
        listType === "aggregation_extract_doc"
          ? listType
          : "scanner_collect";
      const documentNoPrefix =
        listType === "aggregation_block_doc"
          ? "AGB"
          : listType === "aggregation_pallet_doc"
            ? "AGP"
            : listType === "aggregation_extract_doc"
              ? "AGE"
              : "SCAN";
      const docComment =
        listType === "aggregation_block_doc"
          ? "Документ агрегации блоков"
          : listType === "aggregation_pallet_doc"
            ? "Документ агрегации паллет"
            : listType === "aggregation_extract_doc"
              ? "Документ изъятия из паллеты"
              : "Список сканов с ТСД";
      const document = {
        documentId: `code-list:${codeListId}`,
        documentType,
        documentStatus: "in_progress",
        documentNo: `${documentNoPrefix}-${requestId.slice(0, 8).toUpperCase()}`,
        externalRef: (row as any).deviceUid ? `ТСД ${(row as any).deviceUid}` : null,
        comment: docComment,
        priorityCode: null,
        createdAt: (row as any).createdAt,
        appliedAt: null,
        receiptAt: null,
        releasedAt: null,
        payloadJson: {
          requestId,
          listType: (row as any).listType ?? "scanner_collect",
          deviceUid: (row as any).deviceUid ?? null,
          palletCode: (row as any).palletCode ?? null,
          reasonCode: (row as any).reasonCode ?? null,
        },
        sourceWarehouseCode: null,
        targetWarehouseCode: null,
        sourceLocationCode: null,
        targetLocationCode: null,
      };
      const lines = entries.map((entry: any, index: number) => ({
        documentLineId: `code-list-line:${codeListId}:${index + 1}`,
        lineNo: index + 1,
        itemCode: String(entry?.code ?? entry?.packageCode ?? ""),
        itemName: listType.startsWith("aggregation_")
          ? `${String(entry?.code ?? "")} -> ${String(entry?.itemCode ?? "")}`
          : String(entry?.code ?? entry?.packageCode ?? "Код"),
        requestedQty: 1,
        confirmedQty: 1,
        sourceLocationCode: null,
        targetLocationCode: null,
        requestedUomCode: "шт",
        loadUnitId: null,
        loadUnitCode: null,
        loadUnitType: null,
        lotCode: null,
        batchLabel: null,
        manufacturedAt: null,
        taskPayload: entry ?? {},
        comment: listType.startsWith("aggregation_")
          ? `Операция: ${String(entry?.note ?? "add")}`
          : null,
      }));
      return NextResponse.json({ document, lines, loadUnits: [], tasks: [] });
    }
    if (deviceUid.trim()) {
      await assertDeviceMayReadDocument(
        client,
        siteId,
        deviceUid,
        operatorUserId.trim() || null,
        documentId,
        taskId.trim() || null
      );
    }
    const detail = await getDocumentDetail(client, siteId, documentId);
    if (!detail) {
      return NextResponse.json({ error: "document not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
