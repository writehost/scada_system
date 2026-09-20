import { NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { updateItemMaster } from "@/lib/wms/catalog"
import { WmsHttpError } from "@/lib/wms/errors"
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions"
import { requireWmsSession } from "@/lib/wms/require-session"
import { ensureQpassPassport } from "@/lib/wms/qpass-api"
import {
  exactQpassText,
  fetchQpassPublic,
  parseQpassPublicId,
  qpassToAttrsValue,
  readEquipmentSerialFromAttrs,
  readQpassLinkFromAttrs,
  type QpassLink,
} from "@/lib/wms/qpass"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function persistSerial(attrs: Record<string, unknown>, serial: string, name: string, pass: QpassLink) {
  attrs.qpass = qpassToAttrsValue({ ...pass, title: pass.title || name, serial: pass.serial || serial })
  attrs.equipmentSerial = serial
  const nom = asRecord(attrs.nomenclature)
  if (Object.keys(nom).length > 0 || attrs.nomenclature) {
    nom.equipmentSerial = serial
    attrs.nomenclature = nom
  }
}

async function loadItem(client: PoolClient, siteId: number, itemCode: string) {
  return client.query<{ name: string; item_attrs_json: unknown }>(
    `SELECT name, item_attrs_json FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
    [siteId, itemCode]
  )
}

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ itemCode: string }> }
) {
  const auth = await requireWmsSession(req)
  if ("error" in auth) return auth.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const params = await segmentData.params
  const itemCode = decodeURIComponent(params.itemCode ?? "")
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? ""
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const row = await loadItem(client, siteId, itemCode)
    if (!row.rows[0]) return NextResponse.json({ error: "item not found" }, { status: 404 })
    const stored = readQpassLinkFromAttrs(row.rows[0].item_attrs_json)
    if (!stored) return NextResponse.json({ found: false, pass: null })
    const live = await fetchQpassPublic(stored.publicId).catch(() => stored)
    return NextResponse.json({ found: Boolean(live), pass: live ?? stored })
  } finally {
    client.release()
  }
}

export async function PUT(
  req: Request,
  segmentData: { params: Promise<{ itemCode: string }> }
) {
  const auth = await requireWmsSession(req)
  if ("error" in auth) return auth.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const params = await segmentData.params
  const itemCode = decodeURIComponent(params.itemCode ?? "")
  let body: { siteCode?: string; q?: string | null; name?: string; serial?: string; serialNumber?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = (body.siteCode || "").trim()
  if (!siteCode || !itemCode.trim()) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await requireWmsPermission(client, auth.session.userId, WMS_PERMISSION.itemsWrite, auth.session.login)
    const existing = await loadItem(client, siteId, itemCode)
    if (!existing.rows[0]) return NextResponse.json({ error: "item not found" }, { status: 404 })
    const attrs = asRecord(existing.rows[0].item_attrs_json)
    const rawQ = body.q
    const unlink = rawQ === null || (typeof rawQ === "string" && rawQ.trim() === "" && body.name == null && body.serial == null && body.serialNumber == null)
    if (unlink && rawQ !== undefined) {
      delete attrs.qpass
      await updateItemMaster(client, siteId, itemCode, { itemAttrs: attrs })
      return NextResponse.json({ found: false, pass: null })
    }

    const name = exactQpassText(body.name) || exactQpassText(existing.rows[0].name)
    const serial =
      exactQpassText(body.serialNumber) ||
      exactQpassText(body.serial) ||
      readEquipmentSerialFromAttrs(attrs)

    if (name && serial && (rawQ == null || String(rawQ).trim() === "")) {
      const ensured = await ensureQpassPassport(name, serial)
      persistSerial(attrs, serial, name, ensured.pass)
      await updateItemMaster(client, siteId, itemCode, { itemAttrs: attrs })
      return NextResponse.json({ found: true, created: ensured.created, pass: ensured.pass })
    }

    if (rawQ == null || String(rawQ).trim() === "") {
      return NextResponse.json({ error: "нужны точное название и серийный номер" }, { status: 400 })
    }
    const publicId = parseQpassPublicId(String(rawQ))
    if (!publicId) {
      return NextResponse.json({ error: "укажите ссылку или код паспорта QPass" }, { status: 400 })
    }
    /* Привязка идёт сразу после создания паспорта, поэтому читаем без кэша. */
    const pass = await fetchQpassPublic(publicId, undefined, { fresh: true })
    if (!pass) {
      return NextResponse.json({ error: "паспорт в QPass не найден" }, { status: 404 })
    }
    attrs.qpass = qpassToAttrsValue(pass)
    if (pass.serial) attrs.equipmentSerial = pass.serial
    await updateItemMaster(client, siteId, itemCode, { itemAttrs: attrs })
    return NextResponse.json({ found: true, pass })
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : "QPass недоступен"
    return NextResponse.json({ error: message }, { status: 502 })
  } finally {
    client.release()
  }
}
