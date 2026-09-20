export type RowIdentifyScanRole = "start" | "end"

export type RowIdentifyScannedCode = {
  role: RowIdentifyScanRole
  rawCode: string
  normalizedCode: string
  gtin: string | null
  serial: string | null
  productionAt: string
  source: "wms" | "crpt" | "vekas"
  itemCode: string | null
  itemName: string | null
  batchNumber?: string | null
  palletCode?: string | null
}

export type RowIdentifyMatchedCode = {
  code: string
  gtin: string | null
  serial: string | null
  productionAt: string | null
  itemCode: string | null
  itemName: string | null
  palletCode: string | null
  batchNumber?: string | null
}

export type RowIdentifyPallet = {
  index: number
  palletId: string
  palletCode: string
  itemCode: string | null
  itemName: string | null
  gtin: string | null
  productionDate: string | null
  bottles: number
  batchNumber?: string | null
  firstBottleAt?: string | null
  address?: string
}

export type RowIdentifySession = {
  id: string
  siteCode: string
  rowId: string | null
  createdAt: string
  updatedAt: string
  start: RowIdentifyScannedCode | null
  end: RowIdentifyScannedCode | null
  rangeFrom: string | null
  rangeTo: string | null
  itemCode: string | null
  itemName: string | null
  gtin: string | null
  codes: RowIdentifyMatchedCode[]
  pallets: RowIdentifyPallet[]
  palletCount: number
  codeCount: number
  bottleCount: number
  appliedAt: string | null
  appliedAddresses: string[]
}

export function withRowIdentifyCounts(session: RowIdentifySession): RowIdentifySession {
  const pallets = (session.pallets ?? []).map((pallet, i) => ({
    ...pallet,
    index: i + 1,
  }))
  return {
    ...session,
    pallets,
    palletCount: pallets.length,
    codeCount: session.codeCount ?? session.codes?.length ?? 0,
    bottleCount: pallets.reduce((sum, pallet) => sum + (Number(pallet.bottles) || 0), 0),
  }
}

export type FgPlanRowCatalogItem = {
  id: string
  zone: string
  number: string
  group: string | null
  capacity: number
  sections: Array<{ code: string; label: string; count: number }>
}
