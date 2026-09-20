import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { parseRequestId } from "@/lib/wms/uuid";
import {
  createDocumentWithTasks,
  listDocuments,
  type CreateDocumentInput,
} from "@/lib/wms/documents";
import { listCodeListsForSite } from "@/lib/wms/code-lists";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await listDocuments(client, siteId, {
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? "50"),
      documentType: url.searchParams.get("documentType") ?? "",
      status: url.searchParams.get("status") ?? "",
    });
    const requestedType = (url.searchParams.get("documentType") ?? "").trim().toLowerCase();
    const requestedStatus = (url.searchParams.get("status") ?? "").trim().toLowerCase();
    const includeVirtualCodeLists =
      requestedType === "" ||
      requestedType === "scanner_collect" ||
      requestedType === "aggregation_block_doc" ||
      requestedType === "aggregation_pallet_doc" ||
      requestedType === "aggregation_extract_doc";
    const statusAllowsScanLists =
      requestedStatus === "" ||
      requestedStatus === "in_progress" ||
      requestedStatus === "open";

    if (!includeVirtualCodeLists || !statusAllowsScanLists) {
      return NextResponse.json(data);
    }

    const lists = await listCodeListsForSite(client, siteId, {
      limit: Number(url.searchParams.get("limit") ?? "50"),
    });
    const scanDocs = lists.lists
      .filter((row: any) =>
        [
          "scanner_collect",
          "aggregation_block_doc",
          "aggregation_pallet_doc",
          "aggregation_extract_doc",
        ].includes(String(row.listType ?? ""))
      )
      .map((row: any) => {
      const entries = Array.isArray(row.entries) ? row.entries : [];
      const codeListId = String(row.codeListId ?? "");
      const requestId = String(row.requestId ?? codeListId);
      const listType = String(row.listType ?? "scanner_collect");
      const prefix =
        listType === "aggregation_block_doc"
          ? "AGB"
          : listType === "aggregation_pallet_doc"
            ? "AGP"
            : listType === "aggregation_extract_doc"
              ? "AGE"
              : "SCAN";
      const comment =
        listType === "aggregation_block_doc"
          ? "Документ агрегации блоков"
          : listType === "aggregation_pallet_doc"
            ? "Документ агрегации паллет"
            : listType === "aggregation_extract_doc"
              ? "Документ изъятия из паллеты"
              : "Список сканов с ТСД";
      return {
        cursor: `code-list:${codeListId}`,
        documentId: `code-list:${codeListId}`,
        documentType: listType,
        documentStatus: "in_progress",
        documentNo: `${prefix}-${requestId.slice(0, 8).toUpperCase()}`,
        sourceWarehouseCode: null,
        targetWarehouseCode: null,
        sourceLocationCode: null,
        targetLocationCode: null,
        externalRef: row.deviceUid ? `ТСД ${row.deviceUid}` : null,
        comment,
        priorityCode: null,
        createdAt: row.createdAt,
        releasedAt: null,
        lineCount: entries.length,
        taskCount: 0,
      };
    });
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const merged = [...scanDocs, ...data.documents]
      .sort((a: any, b: any) => {
        const ta = Date.parse(String(a.createdAt ?? "")) || 0;
        const tb = Date.parse(String(b.createdAt ?? "")) || 0;
        return tb - ta;
      })
      .slice(0, Math.max(1, Math.min(limit, 100)));
    return NextResponse.json({ documents: merged, nextCursor: "" });
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: CreateDocumentInput;
  try {
    body = (await req.json()) as CreateDocumentInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId((body as { requestId?: string }).requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!body.documentType || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json(
      { error: "documentType and non-empty lines are required" },
      { status: 400 }
    );
  }

  const probe = await pool.connect();
  let siteId: number;
  try {
    const resolvedSiteId = await getSiteId(probe, siteCode);
    if (resolvedSiteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    siteId = resolvedSiteId;
  } finally {
    probe.release();
  }

  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      `document_${body.documentType}`,
      body,
      (client) => createDocumentWithTasks(client, siteId, body)
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json(
        { error: error.message, code: error.code, disposition: "failed" },
        { status: error.status }
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "internal error", disposition: "failed" },
      { status: 500 }
    );
  }
}
