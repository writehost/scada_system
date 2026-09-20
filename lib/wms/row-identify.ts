import type { PoolClient } from "pg"
import { fetchCrptInfoFromUpstream, normalizeCrptCode } from "@/lib/wms/crpt"
import { getUpstreamCrptBearerToken } from "@/lib/wms/crpt-auth"
import { readFgPlanInventory, writeFgPlanInventory, type FgPlanInventorySlot } from "@/lib/wms/fg-plan-inventory-storage"
import { findPlanRow, slotAddressesForRow } from "@/lib/wms/row-identify-rows"
import {
  classifyScanCode,
  compactMarking,
  isAggregatePackageType,
  isSsccCode,
  normalizeSscc,
  pickPrintTime,
  pickRangeCode,
  producedFromHint,
} from "@/lib/wms/row-identify-print-time"
import {
  listVekasCodesInPrintRange,
  listVekasPalletsBetween,
  lookupVekasBottle,
  vekasTimeKey,
  type VekasBottleLookup,
} from "@/lib/wms/row-identify-vekas"
import { newSessionId } from "@/lib/wms/row-identify-token"
import { readRowIdentifySession, writeRowIdentifySession } from "@/lib/wms/row-identify-storage"
import type {
  RowIdentifyMatchedCode,
  RowIdentifyPallet,
  RowIdentifyScanRole,
  RowIdentifyScannedCode,
  RowIdentifySession,
} from "@/lib/wms/row-identify-types"

function parseProductionAt(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const text = String(value).trim()
  if (!text) return null
  if (/^\d{8}$/.test(text)) {
    return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00.000Z`).toISOString()
  }
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?/)
  if (iso) {
    const time = iso[2] ? (iso[2].length === 5 ? `${iso[2]}:00` : iso[2]) : "00:00:00"
    const parsed = new Date(`${iso[1]}T${time}${text.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(text) ? "" : "Z"}`)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  const ru = text.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/)
  if (ru) {
    const parsed = new Date(`${ru[3]}-${ru[2]}-${ru[1]}T${ru[4] ?? "00:00:00"}Z`)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseGs1(code: string): { gtin: string | null; serial: string | null } {
  const compact = normalizeCrptCode(code).replace(/\s+/g, "")
  const unit = compact.match(/^01(\d{14})21(.+)$/)
  if (unit) return { gtin: unit[1], serial: unit[2] }
  const sscc = compact.match(/^00(\d{18})$/)
  if (sscc) return { gtin: `00${sscc[1].slice(0, 12)}`, serial: sscc[1] }
  return { gtin: null, serial: null }
}

async function lookupCodeInDb(
  client: PoolClient,
  siteId: number,
  rawCode: string
): Promise<{
  productionAt: string | null
  gtin: string | null
  serial: string | null
  itemCode: string | null
  itemName: string | null
} | null> {
  const compact = rawCode.replace(/\s+/g, "")
  const parsed = parseGs1(compact)
  const r = await client.query<{
    emittedAt: Date | string | null
    gtin: string | null
    serial: string | null
    itemCode: string | null
    itemName: string | null
  }>(
    `
    SELECT
      cs.emitted_at AS "emittedAt",
      c.ai01_gtin AS gtin,
      c.ai21_serial AS serial,
      i.item_code AS "itemCode",
      i.name AS "itemName"
    FROM codes c
    LEFT JOIN code_state cs ON cs.code_id = c.code_id
    LEFT JOIN wms_item_codes mic ON mic.code_id = c.code_id AND mic.unlinked_at IS NULL
    LEFT JOIN wms_items i ON i.item_id = mic.item_id
    WHERE
      encode(c.raw, 'escape') ILIKE '%' || $1 || '%'
      OR c.ai01_gtin || COALESCE(c.ai21_serial, '') = $2
      OR ($3::text IS NOT NULL AND c.ai01_gtin = $3 AND c.ai21_serial = $4)
    ORDER BY cs.emitted_at DESC NULLS LAST
    LIMIT 1
    `,
    [compact.slice(-24), compact.replace(/^01/, ""), parsed.gtin, parsed.serial]
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    productionAt: parseProductionAt(row.emittedAt),
    gtin: row.gtin,
    serial: row.serial,
    itemCode: row.itemCode,
    itemName: row.itemName,
  }
}

async function crptCisInfo(code: string): Promise<Record<string, unknown> | null> {
  const payload = await fetchCrptInfoFromUpstream([code], getUpstreamCrptBearerToken())
  const first = Array.isArray(payload) ? payload[0] : null
  const cis = first && typeof first === "object" ? (first as { cisInfo?: unknown }).cisInfo : null
  return cis && typeof cis === "object" ? (cis as Record<string, unknown>) : null
}

function crptChildren(cis: Record<string, unknown> | null): string[] {
  if (!cis || !Array.isArray(cis.child)) return []
  return cis.child.map((value) => String(value || "").trim()).filter(Boolean)
}

async function lookupVekasPrint(
  code: string,
  producedFrom?: string
): Promise<VekasBottleLookup | null> {
  try {
    return await lookupVekasBottle(code, producedFrom ? { producedFrom } : undefined)
  } catch {
    return null
  }
}

function vekasPrintTime(vekas: VekasBottleLookup | null): string {
  if (!vekas) return ""
  return pickPrintTime(vekas.printedOn, vekas.validatedOn, vekas.productionDate)
}

function packageTypeOf(cis: Record<string, unknown> | null): string {
  return String(cis?.packageType || cis?.generalPackageType || "")
    .trim()
    .toUpperCase()
}

function parentSsccOf(cis: Record<string, unknown> | null): string | null {
  const parent = String(cis?.parent || "").trim()
  return parent && isSsccCode(parent) ? normalizeSscc(parent) : null
}

function cisHint(cis: Record<string, unknown> | null): string | undefined {
  if (!cis) return undefined
  return producedFromHint(
    String(cis.producedDate || ""),
    String(cis.productionDate || ""),
    String(cis.applicationDate || ""),
    String(cis.introducedDate || "")
  )
}

function isConfirmedUnit(cis: Record<string, unknown> | null): boolean {
  return packageTypeOf(cis) === "UNIT"
}

function isAggregateCis(cis: Record<string, unknown> | null): boolean {
  return isAggregatePackageType(packageTypeOf(cis), crptChildren(cis).length)
}

async function walkUpToSscc(start: Record<string, unknown> | null): Promise<string | null> {
  const direct = parentSsccOf(start)
  if (direct) return direct
  let parent = String(start?.parent || "").trim()
  for (let depth = 0; depth < 4 && parent; depth += 1) {
    if (isSsccCode(parent)) return normalizeSscc(parent)
    let parentCis: Record<string, unknown> | null = null
    try {
      parentCis = await crptCisInfo(normalizeCrptCode(parent))
    } catch {
      break
    }
    const sscc = parentSsccOf(parentCis)
    if (sscc) return sscc
    const next = String(parentCis?.parent || "").trim()
    if (!next || next === parent) break
    parent = next
  }
  return null
}

function prepareLookupCode(raw: string): string {
  return classifyScanCode(raw) === "sscc" ? normalizeSscc(raw) : normalizeCrptCode(compactMarking(raw) || raw)
}

async function unwrapToUnitKm(
  rawCode: string,
  role: RowIdentifyScanRole
): Promise<{
  unitCode: string
  palletCode: string | null
  itemName: string | null
  hint?: string
}> {
  const kind = classifyScanCode(rawCode)
  let code = prepareLookupCode(rawCode)
  const scannedSscc = kind === "sscc" ? code : null

  let cis: Record<string, unknown> | null = null
  try {
    cis = await crptCisInfo(code)
  } catch (error) {
    if (kind === "unit") {
      return { unitCode: code, palletCode: null, itemName: null, hint: undefined }
    }
    const message = error instanceof Error ? error.message : "CRPT lookup failed"
    throw Object.assign(new Error(`Не удалось раскрыть код в ЧЗ: ${message}`), { status: 422 })
  }

  // Палета LEVEL2 → блоки LEVEL1 → единичный UNIT. Формат 01+21 у блока не значит продукт.
  for (let depth = 0; depth < 5 && isAggregateCis(cis); depth += 1) {
    const pick = pickRangeCode(crptChildren(cis), role)
    if (!pick) break
    code = prepareLookupCode(pick)
    try {
      cis = await crptCisInfo(code)
    } catch {
      break
    }
  }

  if (isAggregateCis(cis) && !isConfirmedUnit(cis)) {
    throw Object.assign(
      new Error("ЧЗ не вернул единичный КМ продукта — у палеты и блока нет времени печати, сканируйте бутылку или SSCC"),
      { status: 422 }
    )
  }

  return {
    unitCode: normalizeCrptCode(code),
    palletCode: scannedSscc || (await walkUpToSscc(cis)),
    itemName: String(cis?.productName || "").trim() || null,
    hint: cisHint(cis),
  }
}

export async function resolveScannedBottle(
  client: PoolClient,
  siteId: number,
  rawCode: string,
  role: RowIdentifyScanRole
): Promise<RowIdentifyScannedCode> {
  const fullCode = rawCode.replace(/\r/g, "").trim()
  if (fullCode.length < 8) {
    throw Object.assign(new Error("code is too short"), { status: 400 })
  }
  const fromDb = await lookupCodeInDb(client, siteId, normalizeCrptCode(fullCode))
  const unwrapped = await unwrapToUnitKm(fullCode, role)
  const parsed = parseGs1(unwrapped.unitCode)

  let productionAt = ""
  let gtin = fromDb?.gtin ?? parsed.gtin
  let serial = fromDb?.serial ?? parsed.serial
  let itemCode = fromDb?.itemCode ?? null
  let itemName = unwrapped.itemName || fromDb?.itemName || null
  let source: "wms" | "crpt" | "vekas" = "vekas"
  let batchNumber: string | null = null
  let palletCode = unwrapped.palletCode

  let vekas = await lookupVekasPrint(unwrapped.unitCode, unwrapped.hint)
  if (!vekas && unwrapped.hint) {
    vekas = await lookupVekasPrint(unwrapped.unitCode)
  }
  productionAt = vekasPrintTime(vekas)
  if (vekas) {
    gtin = vekas.gtin ?? gtin
    serial = vekas.serial ?? serial
    itemName = vekas.productName ?? itemName
    batchNumber = vekas.batchNumber
    palletCode = vekas.palletCode || palletCode
    source = "vekas"
  } else {
    productionAt = pickPrintTime(fromDb?.productionAt)
    if (productionAt) source = "wms"
  }

  if (!productionAt) {
    throw Object.assign(
      new Error(
        "Время печати есть только у единичного КМ продукта. Отсканируйте бутылку или SSCC палеты — палету раскроем до продукта."
      ),
      { status: 422 }
    )
  }

  return {
    role,
    rawCode,
    normalizedCode: unwrapped.unitCode,
    gtin,
    serial,
    productionAt,
    source,
    itemCode,
    itemName,
    batchNumber,
    palletCode,
  }
}

async function matchCodesInRange(
  _client: PoolClient,
  _siteId: number,
  rangeFrom: string,
  rangeTo: string,
  gtin: string | null,
  startPallet?: string | null,
  endPallet?: string | null
): Promise<{ codes: RowIdentifyMatchedCode[]; pallets: RowIdentifyPallet[]; codeCount: number }> {
  if (!gtin) return { codes: [], pallets: [], codeCount: 0 }
  const from = vekasTimeKey(rangeFrom)
  const to = vekasTimeKey(rangeTo)
  const [codesRes, palletsRes] = await Promise.all([
    listVekasCodesInPrintRange({ gtin, timeFrom: from, timeTo: to }),
    startPallet || endPallet
      ? listVekasPalletsBetween({
          gtin,
          startPallet,
          endPallet,
          timeFrom: from,
          timeTo: to,
        })
      : Promise.resolve({ total: 0, items: [] }),
  ])

  const allCodes: RowIdentifyMatchedCode[] = codesRes.items.map((row) => ({
    code: row.code,
    gtin: row.gtin ?? gtin,
    serial: row.serial ?? parseGs1(row.code.replace(/\u001d/g, "")).serial,
    productionAt: vekasTimeKey(row.printedOn) || null,
    itemCode: null,
    itemName: row.productName ?? null,
    palletCode: row.palletCode ?? null,
    batchNumber: row.batchNumber ?? null,
  }))
  const codes =
    allCodes.length <= 10 ? allCodes : [...allCodes.slice(0, 5), ...allCodes.slice(-5)]

  const pallets: RowIdentifyPallet[] = palletsRes.items.map((row, index) => ({
    index: index + 1,
    palletId: row.palletId,
    palletCode: row.palletId,
    itemCode: null,
    itemName: row.productName ?? row.nomenclature ?? null,
    gtin: row.gtin ?? gtin,
    productionDate: null,
    bottles: Number(row.quantity) || 0,
    batchNumber: row.batchNumber ?? null,
    firstBottleAt: index === 0 ? from : index === palletsRes.items.length - 1 ? to : null,
  }))

  return { codes, pallets, codeCount: codesRes.total ?? allCodes.length }
}

function refreshRange(session: RowIdentifySession): RowIdentifySession {
  if (!session.start || !session.end) {
    return { ...session, rangeFrom: null, rangeTo: null, codes: [], pallets: [], palletCount: 0, codeCount: 0, bottleCount: 0 }
  }
  const a = vekasTimeKey(session.start.productionAt)
  const b = vekasTimeKey(session.end.productionAt)
  const from = a <= b ? a : b
  const to = a <= b ? b : a
  return {
    ...session,
    rangeFrom: from,
    rangeTo: to,
    gtin: session.start.gtin ?? session.end.gtin,
    itemCode: session.start.itemCode ?? session.end.itemCode,
    itemName: session.start.itemName ?? session.end.itemName,
  }
}

export async function createRowIdentifySession(input: {
  siteCode: string
  rowId?: string | null
}): Promise<RowIdentifySession> {
  const now = new Date().toISOString()
  return writeRowIdentifySession({
    id: newSessionId(),
    siteCode: input.siteCode.trim() || "DEFAULT",
    rowId: input.rowId?.trim() || null,
    createdAt: now,
    updatedAt: now,
    start: null,
    end: null,
    rangeFrom: null,
    rangeTo: null,
    itemCode: null,
    itemName: null,
    gtin: null,
    codes: [],
    pallets: [],
    palletCount: 0,
    codeCount: 0,
    bottleCount: 0,
    appliedAt: null,
    appliedAddresses: [],
  })
}

export async function getRowIdentifySession(id: string): Promise<RowIdentifySession | null> {
  return readRowIdentifySession(id)
}

export async function scanRowIdentifyCode(
  client: PoolClient,
  siteId: number,
  sessionId: string,
  rawCode: string,
  role: RowIdentifyScanRole
): Promise<RowIdentifySession> {
  const session = await readRowIdentifySession(sessionId)
  if (!session) throw Object.assign(new Error("session not found"), { status: 404 })
  const scanned = await resolveScannedBottle(client, siteId, rawCode, role)
  if (role === "start") session.start = scanned
  else session.end = scanned
  if (session.start?.gtin && session.end?.gtin && session.start.gtin !== session.end.gtin) {
    throw Object.assign(new Error("Стартовый и конечный коды относятся к разной номенклатуре (разный GTIN)"), {
      status: 409,
    })
  }
  const next = refreshRange(session)
  if (next.rangeFrom && next.rangeTo) {
    const startPallet = next.start?.palletCode ?? next.end?.palletCode
    const endPallet = next.end?.palletCode ?? next.start?.palletCode
    const matched = await matchCodesInRange(
      client,
      siteId,
      next.rangeFrom,
      next.rangeTo,
      next.gtin,
      startPallet,
      endPallet
    )
    next.codes = matched.codes
    next.pallets = matched.pallets
    next.codeCount = matched.codeCount
  }
  return writeRowIdentifySession(next)
}

export async function resolveRowIdentifySession(
  client: PoolClient,
  siteId: number,
  sessionId: string
): Promise<RowIdentifySession> {
  const session = await readRowIdentifySession(sessionId)
  if (!session) throw Object.assign(new Error("session not found"), { status: 404 })
  const next = refreshRange(session)
  if (!next.rangeFrom || !next.rangeTo) {
    throw Object.assign(new Error("Сначала отсканируйте начальный и конечный коды ряда"), { status: 409 })
  }
  const matched = await matchCodesInRange(
    client,
    siteId,
    next.rangeFrom,
    next.rangeTo,
    next.gtin,
    next.start?.palletCode,
    next.end?.palletCode
  )
  next.codes = matched.codes
  next.pallets = matched.pallets
  next.codeCount = matched.codeCount
  return writeRowIdentifySession(next)
}

export async function applyRowIdentifySession(
  siteId: number,
  sessionId: string,
  rowId?: string | null
): Promise<RowIdentifySession> {
  const session = await readRowIdentifySession(sessionId)
  if (!session) throw Object.assign(new Error("session not found"), { status: 404 })
  const targetRowId = (rowId ?? session.rowId ?? "").trim()
  if (!targetRowId) throw Object.assign(new Error("rowId is required"), { status: 400 })
  if (!session.pallets.length) {
    throw Object.assign(new Error("Нет паллет в диапазоне — сначала отсканируйте оба кода"), { status: 409 })
  }

  const planRow = await findPlanRow(targetRowId)
  if (!planRow) throw Object.assign(new Error(`Неизвестный ряд карты: ${targetRowId}`), { status: 404 })
  const addresses = slotAddressesForRow(planRow)
  if (addresses.length < session.pallets.length) {
    throw Object.assign(
      new Error(`В ряду ${planRow.id} только ${addresses.length} мест, а паллет ${session.pallets.length}`),
      { status: 409 }
    )
  }

  const snapshot = await readFgPlanInventory(siteId)
  const inventory: Record<string, FgPlanInventorySlot> = { ...snapshot.inventory }
  const used = new Set(
    Object.entries(inventory)
      .filter(([, slot]) => slot.status === "occupied" || slot.status === "reserved" || slot.status === "blocked")
      .map(([address]) => address)
  )
  const appliedAddresses: string[] = []
  let addressIndex = 0
  for (const pallet of session.pallets) {
    while (addressIndex < addresses.length && used.has(addresses[addressIndex])) addressIndex += 1
    const address = addresses[addressIndex]
    if (!address) {
      throw Object.assign(new Error("В ряду не хватает свободных паллетомест"), { status: 409 })
    }
    inventory[address] = {
      address,
      status: "occupied",
      palletId: pallet.palletCode,
      nomenclature: pallet.itemName ?? session.itemName ?? undefined,
      gtin: pallet.gtin ?? session.gtin ?? undefined,
      batch: pallet.batchNumber ?? session.start?.batchNumber ?? session.rangeFrom?.slice(0, 10),
      productionDate: pallet.firstBottleAt?.slice(0, 10) ?? session.rangeFrom?.slice(0, 10) ?? undefined,
      quantity: pallet.bottles,
      unit: "шт.",
    }
    pallet.address = address
    appliedAddresses.push(address)
    used.add(address)
    addressIndex += 1
  }

  await writeFgPlanInventory(siteId, inventory)
  session.rowId = planRow.id
  session.appliedAt = new Date().toISOString()
  session.appliedAddresses = appliedAddresses
  return writeRowIdentifySession(session)
}

export function httpErrorStatus(error: unknown): number {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status
  }
  return 500
}
