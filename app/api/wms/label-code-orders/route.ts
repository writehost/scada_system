import { NextRequest, NextResponse } from "next/server"
import type { PoolClient } from "pg"
import {
  createLabelCodeOrder,
  deleteLabelCodeOrder,
  listLabelCodeOrders,
  patchLabelCodeOrder,
  printLabelCodeOrder,
  type LabelCodeOrder,
} from "@/lib/wms/label-code-orders"
import { assertLabelOrderMasterCode } from "@/lib/wms/label-order-master"
import { ingestLabelOrderToReceiving } from "@/lib/wms/label-order-receiving"
import { describeRequestOrigin, resolveLabelOrderAuthor } from "@/lib/wms/label-order-author"
import {
  addLabelOrderAdjustment,
  appendLabelOrderEvent,
  backfillLabelOrderDocs,
  createLabelOrderDoc,
  getLabelOrderWasteSettings,
  getLabelSuzSettingsRow,
  loadLabelOrderBundles,
  revertLabelOrderAdjustment,
  saveLabelOrderWasteSettings,
  saveLabelSuzSettingsRow,
  syncLabelOrderDocPlan,
  type LabelOrderDoc,
} from "@/lib/wms/label-order-docs"
import {
  buildLabelOrderPlan,
  plannedWasteQty,
  summarizeLabelOrderFact,
  type LabelOrderFact,
  type LabelOrderWasteSettings,
} from "@/lib/wms/label-order-waste"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError } from "@/lib/wms/errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type OrderWithDoc = LabelCodeOrder & { doc?: LabelOrderDoc; fact?: LabelOrderFact }

function siteCodeOf(raw: string | null | undefined): string {
  return (raw || "DEFAULT").trim() || "DEFAULT"
}

async function withSite<T>(
  siteCode: string,
  run: (client: PoolClient, siteId: number) => Promise<T>
): Promise<T> {
  const pool = tryGetPool()
  if (!pool) throw new WmsHttpError(503, "База WMS не настроена", "database_not_configured")
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) throw new WmsHttpError(404, "Неизвестный склад", "unknown_site")
    return await run(client, siteId)
  } finally {
    client.release()
  }
}

/**
 * GET /api/wms/label-code-orders — очередь заказов с терминала печати и из WMS,
 * склеенная с документами заказа (кто, откуда, когда) и фактом печати.
 */
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status") || undefined
    const limit = Number(req.nextUrl.searchParams.get("limit") || "100") || 100
    const siteCode = siteCodeOf(req.nextUrl.searchParams.get("siteCode"))
    const orders = (await listLabelCodeOrders({ status, limit })) as OrderWithDoc[]

    let settings: LabelOrderWasteSettings | null = null
    let suzSettings: Awaited<ReturnType<typeof getLabelSuzSettingsRow>> = null
    try {
      await withSite(siteCode, async (client, siteId) => {
        settings = await getLabelOrderWasteSettings(client, siteId)
        suzSettings = await getLabelSuzSettingsRow(client, siteId)
        await backfillLabelOrderDocs(
          client,
          siteId,
          orders.map((o) => ({
            id: o.id,
            createdAt: o.createdAt,
            gtin: o.gtin,
            nomenclatureName: o.nomenclatureName,
            stickerType: o.stickerType,
            quantity: o.quantity,
            source: o.source,
            deviceId: o.deviceId,
          })),
          settings
        )
        const bundles = await loadLabelOrderBundles(
          client,
          siteId,
          orders.map((o) => o.id)
        )
        for (const order of orders) {
          const bundle = bundles.get(order.id)
          if (!bundle) continue
          order.doc = bundle.doc
          order.fact = bundle.fact
        }
      })
    } catch (dbError) {
      // Очередь важнее журнала: без базы страница всё равно должна показать заказы.
      console.error("[label-code-orders] docs enrich failed", dbError)
    }

    return NextResponse.json({ ok: true, orders, settings, suzSettings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}

type PostBody = {
  action?:
    | "print"
    | "patch"
    | "delete"
    | "unlock-delete"
    | "to-receiving"
    | "create"
    | "adjust"
    | "revert-adjustment"
    | "save-settings"
  id?: string
  status?: string
  note?: string
  codes?: string[] | string
  autoStart?: boolean
  deviceId?: string
  masterCode?: string
  siteCode?: string
  // create
  gtin?: string
  quantity?: number
  itemCode?: string
  nomenclatureName?: string
  stickerType?: string
  comment?: string
  wastePercent?: number
  addWasteToOrder?: boolean
  // adjust
  printedQty?: number
  spooledQty?: number
  defectQty?: number
  adjustmentId?: string
  // settings
  settings?: unknown
  suz?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PostBody
    const siteCode = siteCodeOf(body.siteCode)

    if (body.action === "unlock-delete") {
      if (!assertLabelOrderMasterCode(body.masterCode)) {
        return NextResponse.json({ ok: false, error: "Неверный мастер-код" }, { status: 403 })
      }
      return NextResponse.json({ ok: true })
    }

    if (body.action === "save-settings") {
      const author = await resolveLabelOrderAuthor(req)
      const saved = await withSite(siteCode, async (client, siteId) => {
        const settings = await saveLabelOrderWasteSettings(client, siteId, body.settings ?? body, author)
        const suzSettings =
          body.suz != null ? await saveLabelSuzSettingsRow(client, siteId, body.suz) : await getLabelSuzSettingsRow(client, siteId)
        return { settings, suzSettings }
      })
      return NextResponse.json({ ok: true, ...saved })
    }

    if (body.action === "create") {
      return await createOrder(req, body, siteCode)
    }

    const id = body.id?.trim()

    if (body.action === "revert-adjustment") {
      const author = await resolveLabelOrderAuthor(req)
      const adjustmentId = body.adjustmentId?.trim()
      if (!adjustmentId) {
        return NextResponse.json({ ok: false, error: "adjustmentId required" }, { status: 400 })
      }
      await withSite(siteCode, (client, siteId) =>
        revertLabelOrderAdjustment(client, siteId, {
          adjustmentId,
          author,
          origin: describeRequestOrigin(req),
        })
      )
      return NextResponse.json({ ok: true })
    }

    if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 })

    if (body.action === "adjust") {
      const author = await resolveLabelOrderAuthor(req)
      const result = await withSite(siteCode, async (client, siteId) => {
        await addLabelOrderAdjustment(client, siteId, {
          orderId: id,
          author,
          origin: describeRequestOrigin(req),
          printedQty: Number(body.printedQty) || 0,
          spooledQty: Number(body.spooledQty) || 0,
          defectQty: Number(body.defectQty) || 0,
          comment: body.comment,
        })
        const bundles = await loadLabelOrderBundles(client, siteId, [id])
        return bundles.get(id) ?? null
      })
      return NextResponse.json({
        ok: true,
        fact: result?.fact ?? summarizeLabelOrderFact([]),
        adjustments: result?.adjustments ?? [],
        events: result?.events ?? [],
      })
    }

    if (body.action === "delete") {
      if (!assertLabelOrderMasterCode(body.masterCode)) {
        return NextResponse.json({ ok: false, error: "Неверный мастер-код" }, { status: 403 })
      }
      const author = await resolveLabelOrderAuthor(req)
      await deleteLabelCodeOrder(id)
      await withSite(siteCode, (client, siteId) =>
        appendLabelOrderEvent(client, siteId, {
          orderId: id,
          kind: "deleted",
          author,
          origin: describeRequestOrigin(req),
          detail: "Заказ удалён из очереди печати",
        })
      ).catch(() => undefined)
      return NextResponse.json({ ok: true, deleted: id })
    }

    if (body.action === "to-receiving") {
      const author = await resolveLabelOrderAuthor(req)
      const result = await ingestLabelOrderToReceiving({ orderId: id, siteCode })
      await withSite(siteCode, (client, siteId) =>
        appendLabelOrderEvent(client, siteId, {
          orderId: id,
          kind: "receiving",
          author,
          origin: describeRequestOrigin(req),
          detail: `Коды переданы в приёмку ${result.documentId} (${result.codesCount})`,
          payload: { ...result },
        })
      ).catch(() => undefined)
      return NextResponse.json({ ok: true, ...result })
    }

    if (body.action === "print") {
      const author = await resolveLabelOrderAuthor(req)
      const result = await printLabelCodeOrder(id, {
        autoStart: body.autoStart !== false,
        deviceId: body.deviceId,
      })
      await withSite(siteCode, (client, siteId) =>
        appendLabelOrderEvent(client, siteId, {
          orderId: id,
          kind: "printed",
          author,
          origin: describeRequestOrigin(req),
          detail: `Отправлено в печать: ${result.codesCount} кодов`,
          payload: { printJobId: result.printJobId, codesCount: result.codesCount },
        })
      ).catch(() => undefined)
      let receiving: { documentId: string; codesCount: number; already?: boolean } | null = null
      try {
        receiving = await ingestLabelOrderToReceiving({ orderId: id, siteCode })
      } catch (ingestErr) {
        const msg = ingestErr instanceof Error ? ingestErr.message : String(ingestErr)
        return NextResponse.json({ ok: true, ...result, receivingError: msg })
      }
      return NextResponse.json({ ok: true, ...result, receiving })
    }

    const order = await patchLabelCodeOrder(id, {
      status: body.status,
      note: body.note,
      codes: body.codes,
    })
    if (body.codes != null || body.status) {
      const author = await resolveLabelOrderAuthor(req)
      await withSite(siteCode, async (client, siteId) => {
        const settings = await getLabelOrderWasteSettings(client, siteId)
        await syncLabelOrderDocPlan(client, siteId, {
          orderId: order.id,
          quantity: order.quantity,
          settings,
        })
        await appendLabelOrderEvent(client, siteId, {
          orderId: order.id,
          kind: order.hasCodes ? "codes_ready" : "status",
          author,
          origin: describeRequestOrigin(req),
          detail: order.hasCodes
            ? `Коды получены: ${order.codesCount} КМ`
            : `Статус заказа: ${order.status}`,
          payload: { status: order.status, codesCount: order.codesCount, note: order.note },
        })
      }).catch(() => undefined)
    }
    return NextResponse.json({ ok: true, order })
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}

/** Заказ, оформленный в WMS: документ с автором и планом погрешности + строка в очереди печати. */
async function createOrder(req: NextRequest, body: PostBody, siteCode: string) {
  const author = await resolveLabelOrderAuthor(req)
  const gtin = String(body.gtin ?? "").replace(/\D/g, "")
  if (gtin.length < 8) {
    return NextResponse.json({ ok: false, error: "Укажите GTIN номенклатуры" }, { status: 400 })
  }
  const neededQty = Math.round(Number(body.quantity) || 0)
  if (neededQty < 1) {
    return NextResponse.json({ ok: false, error: "Количество должно быть больше нуля" }, { status: 400 })
  }

  const settings = await withSite(siteCode, (client, siteId) =>
    getLabelOrderWasteSettings(client, siteId)
  )
  const plan = buildLabelOrderPlan(neededQty, settings, {
    wastePercent: body.wastePercent,
    addWasteToOrder: body.addWasteToOrder,
  })

  const gtin14 = gtin.padStart(14, "0").slice(-14)
  const originDetail = describeRequestOrigin(req)
  const created = await createLabelCodeOrder({
    gtin: gtin14,
    quantity: plan.orderQty,
    nomenclatureName: body.nomenclatureName?.trim() || "",
    stickerType: body.stickerType?.trim() || "single",
    source: "wms-ui",
    note: body.comment?.trim() || "",
  })

  const doc = await withSite(siteCode, async (client, siteId) => {
    const row = await createLabelOrderDoc(client, siteId, {
      orderId: created.id,
      author,
      origin: "wms-ui",
      originDetail,
      gtin: gtin14,
      itemCode: body.itemCode?.trim() || "",
      nomenclatureName: body.nomenclatureName?.trim() || created.nomenclatureName,
      stickerType: created.stickerType || body.stickerType?.trim() || "single",
      quantity: plan.orderQty,
      plannedWasteQty: plan.wasteQty || plannedWasteQty(plan.orderQty, settings),
      wastePercent: plan.wastePercent,
      comment: body.comment?.trim() || "",
      createdAt: created.createdAt,
      payload: {
        neededQty: plan.neededQty,
        labelsQty: plan.labelsQty,
        addWasteToOrder: Boolean(body.addWasteToOrder ?? settings.addWasteToOrder),
      },
    })
    await appendLabelOrderEvent(client, siteId, {
      orderId: created.id,
      kind: "created",
      author,
      origin: originDetail,
      detail: `Заказ ${row.docNo} на ${plan.orderQty} кодов · плановый хвост ${plan.wasteQty}`,
      at: created.createdAt,
      payload: { docNo: row.docNo, plan },
    })
    return row
  })

  return NextResponse.json({ ok: true, order: created, doc, plan })
}
