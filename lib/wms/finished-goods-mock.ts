/** Демо-данные сериализованного учёта ГП. Заменить на API кодов маркировки. */

export type FgMarkingKind = "bottle" | "block" | "pallet"

export type FgMarkingTag = "export" | "expiry-risk" | "quarantine" | "promo"

export type FgMarkingNode = {
  id: string
  code: string
  kind: FgMarkingKind
  gtin: string
  serialNumber: string
  producedAt: string
  expiresAt: string
  tags: FgMarkingTag[]
  locationCode?: string
  rowLabel?: string
  children?: FgMarkingNode[]
}

export type FgNomenclatureRow = {
  itemCode: string
  name: string
  gtin: string
  productGroup: string
  bottles: number
  blocks: number
  pallets: number
  nearestExpiryAt: string | null
  oldestProductionAt: string | null
  tags: FgMarkingTag[]
  expiryCritical: number
  expiryWarning: number
  expiryOk: number
  tree: FgMarkingNode[]
}

export type FgPalletRow = {
  palletCode: string
  itemCode: string
  itemName: string
  locationCode: string
  rowLabel: string
  blocks: number
  bottles: number
  producedAt: string
  expiresAt: string
  tags: FgMarkingTag[]
}

export type FgExpiryBucket = {
  key: "critical" | "warning" | "ok" | "expired"
  label: string
  daysRange: string
  items: Array<{
    itemCode: string
    name: string
    bottles: number
    nearestExpiryAt: string
    daysLeft: number
  }>
}

const TAG_LABELS: Record<FgMarkingTag, string> = {
  export: "Экспорт",
  "expiry-risk": "Срок годности",
  quarantine: "Карантин",
  promo: "Акция",
}

export function fgTagLabel(tag: FgMarkingTag): string {
  return TAG_LABELS[tag] ?? tag
}

function daysUntil(iso: string): number {
  const end = new Date(iso)
  end.setHours(0, 0, 0, 0)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

function mkBottle(id: string, serial: string, producedAt: string, expiresAt: string, tags: FgMarkingTag[] = []): FgMarkingNode {
  return {
    id,
    code: `010460406000000021${serial}`,
    kind: "bottle",
    gtin: "04604060000000",
    serialNumber: serial,
    producedAt,
    expiresAt,
    tags,
  }
}

function mkBlock(
  id: string,
  serial: string,
  producedAt: string,
  expiresAt: string,
  bottles: FgMarkingNode[],
  tags: FgMarkingTag[] = []
): FgMarkingNode {
  return {
    id,
    code: `010460406000000021${serial}`,
    kind: "block",
    gtin: "04604060000000",
    serialNumber: serial,
    producedAt,
    expiresAt,
    tags,
    children: bottles,
  }
}

function mkPallet(
  id: string,
  serial: string,
  producedAt: string,
  expiresAt: string,
  locationCode: string,
  rowLabel: string,
  blocks: FgMarkingNode[],
  tags: FgMarkingTag[] = []
): FgMarkingNode {
  return {
    id,
    code: `010460406000000021${serial}`,
    kind: "pallet",
    gtin: "04604060000000",
    serialNumber: serial,
    producedAt,
    expiresAt,
    tags,
    locationCode,
    rowLabel,
    children: blocks,
  }
}

const PROD_A = "2026-05-20T08:00:00.000Z"
const EXP_A = "2027-05-20T00:00:00.000Z"
const PROD_B = "2026-06-01T10:00:00.000Z"
const EXP_B = "2026-06-15T00:00:00.000Z"
const PROD_C = "2026-05-28T12:00:00.000Z"
const EXP_C = "2027-05-28T00:00:00.000Z"

const MOCK_NOMENCLATURE: FgNomenclatureRow[] = [
  {
    itemCode: "FG-WATER-050",
    name: 'Вода питьевая «Crystal» 0,5 л',
    gtin: "04604060000001",
    productGroup: "Вода",
    bottles: 864,
    blocks: 72,
    pallets: 6,
    nearestExpiryAt: EXP_A,
    oldestProductionAt: PROD_A,
    tags: ["export"],
    expiryCritical: 0,
    expiryWarning: 0,
    expiryOk: 864,
    tree: [
      mkPallet(
        "plt-1",
        "PLT000001",
        PROD_A,
        EXP_A,
        "FG-A-12-03",
        "Ряд A · поз. 12",
        [
          mkBlock("blk-1", "BLK000101", PROD_A, EXP_A, [
            mkBottle("btl-1", "000000001", PROD_A, EXP_A, ["export"]),
            mkBottle("btl-2", "000000002", PROD_A, EXP_A, ["export"]),
            mkBottle("btl-3", "000000003", PROD_A, EXP_A),
          ]),
          mkBlock("blk-2", "BLK000102", PROD_A, EXP_A, [
            mkBottle("btl-4", "000000004", PROD_A, EXP_A),
            mkBottle("btl-5", "000000005", PROD_A, EXP_A),
          ]),
        ],
        ["export"]
      ),
      mkPallet(
        "plt-2",
        "PLT000002",
        PROD_A,
        EXP_A,
        "FG-A-12-04",
        "Ряд A · поз. 13",
        [
          mkBlock("blk-3", "BLK000201", PROD_A, EXP_A, [
            mkBottle("btl-6", "000000006", PROD_A, EXP_A),
            mkBottle("btl-7", "000000007", PROD_A, EXP_A),
          ]),
        ]
      ),
    ],
  },
  {
    itemCode: "FG-LEMON-100",
    name: 'Лимонад «Fruity» 1,0 л',
    gtin: "04604060000002",
    productGroup: "Лимонады",
    bottles: 480,
    blocks: 40,
    pallets: 4,
    nearestExpiryAt: EXP_B,
    oldestProductionAt: PROD_B,
    tags: ["expiry-risk"],
    expiryCritical: 120,
    expiryWarning: 360,
    expiryOk: 0,
    tree: [
      mkPallet(
        "plt-3",
        "PLT000101",
        PROD_B,
        EXP_B,
        "FG-B-05-01",
        "Ряд B · поз. 05",
        [
          mkBlock("blk-4", "BLK000301", PROD_B, EXP_B, [
            mkBottle("btl-8", "000000101", PROD_B, EXP_B, ["expiry-risk"]),
            mkBottle("btl-9", "000000102", PROD_B, EXP_B, ["expiry-risk"]),
            mkBottle("btl-10", "000000103", PROD_B, EXP_B),
          ], ["expiry-risk"]),
        ],
        ["expiry-risk"]
      ),
    ],
  },
  {
    itemCode: "FG-COLA-033",
    name: 'Кола «Black» 0,33 л',
    gtin: "04604060000003",
    productGroup: "Газированные",
    bottles: 1440,
    blocks: 120,
    pallets: 10,
    nearestExpiryAt: EXP_C,
    oldestProductionAt: PROD_C,
    tags: ["export", "promo"],
    expiryCritical: 0,
    expiryWarning: 240,
    expiryOk: 1200,
    tree: [
      mkPallet(
        "plt-4",
        "PLT000201",
        PROD_C,
        EXP_C,
        "FG-C-08-02",
        "Ряд C · поз. 08",
        [
          mkBlock("blk-5", "BLK000401", PROD_C, EXP_C, [
            mkBottle("btl-11", "000000201", PROD_C, EXP_C, ["export", "promo"]),
            mkBottle("btl-12", "000000202", PROD_C, EXP_C, ["export"]),
          ], ["export"]),
        ],
        ["export"]
      ),
    ],
  },
  {
    itemCode: "FG-JUICE-095",
    name: 'Сок «Orange» 0,95 л',
    gtin: "04604060000004",
    productGroup: "Соки",
    bottles: 288,
    blocks: 24,
    pallets: 2,
    nearestExpiryAt: EXP_B,
    oldestProductionAt: PROD_B,
    tags: ["quarantine"],
    expiryCritical: 48,
    expiryWarning: 240,
    expiryOk: 0,
    tree: [
      mkPallet(
        "plt-5",
        "PLT000301",
        PROD_B,
        EXP_B,
        "FG-Q-01-01",
        "Карантин · зона Q1",
        [
          mkBlock("blk-6", "BLK000501", PROD_B, EXP_B, [
            mkBottle("btl-13", "000000301", PROD_B, EXP_B, ["quarantine"]),
            mkBottle("btl-14", "000000302", PROD_B, EXP_B, ["quarantine"]),
          ], ["quarantine"]),
        ],
        ["quarantine"]
      ),
    ],
  },
]

export function listFgNomenclature(): FgNomenclatureRow[] {
  return MOCK_NOMENCLATURE
}

export function getFgNomenclature(itemCode: string): FgNomenclatureRow | null {
  return MOCK_NOMENCLATURE.find((r) => r.itemCode === itemCode) ?? null
}

export function listFgPallets(): FgPalletRow[] {
  const rows: FgPalletRow[] = []
  for (const nom of MOCK_NOMENCLATURE) {
    for (const plt of nom.tree) {
      if (plt.kind !== "pallet") continue
      const blocks = plt.children?.length ?? 0
      const bottles = (plt.children ?? []).reduce((s, b) => s + (b.children?.length ?? 0), 0)
      rows.push({
        palletCode: plt.code,
        itemCode: nom.itemCode,
        itemName: nom.name,
        locationCode: plt.locationCode ?? "—",
        rowLabel: plt.rowLabel ?? "—",
        blocks,
        bottles,
        producedAt: plt.producedAt,
        expiresAt: plt.expiresAt,
        tags: [...new Set([...nom.tags, ...plt.tags])],
      })
    }
  }
  return rows
}

export function fgSummaryStats() {
  const nom = listFgNomenclature()
  return {
    nomenclatureCount: nom.length,
    bottles: nom.reduce((s, r) => s + r.bottles, 0),
    blocks: nom.reduce((s, r) => s + r.blocks, 0),
    pallets: nom.reduce((s, r) => s + r.pallets, 0),
    expiryCritical: nom.reduce((s, r) => s + r.expiryCritical, 0),
    expiryWarning: nom.reduce((s, r) => s + r.expiryWarning, 0),
    exportBottles: nom.filter((r) => r.tags.includes("export")).reduce((s, r) => s + r.bottles, 0),
  }
}

export function fgExpiryBuckets(): FgExpiryBucket[] {
  const critical: FgExpiryBucket["items"] = []
  const warning: FgExpiryBucket["items"] = []
  const ok: FgExpiryBucket["items"] = []
  const expired: FgExpiryBucket["items"] = []

  for (const row of listFgNomenclature()) {
    if (!row.nearestExpiryAt) continue
    const d = daysUntil(row.nearestExpiryAt)
    const item = {
      itemCode: row.itemCode,
      name: row.name,
      bottles: row.bottles,
      nearestExpiryAt: row.nearestExpiryAt,
      daysLeft: d,
    }
    if (d < 0) expired.push(item)
    else if (d <= 7) critical.push(item)
    else if (d <= 30) warning.push(item)
    else ok.push(item)
  }

  return [
    { key: "expired", label: "Просрочено", daysRange: "< 0 дн.", items: expired },
    { key: "critical", label: "Критично", daysRange: "≤ 7 дн.", items: critical },
    { key: "warning", label: "Внимание", daysRange: "8–30 дн.", items: warning },
    { key: "ok", label: "Норма", daysRange: "> 30 дн.", items: ok },
  ]
}

export function fgTopByVolume(limit = 3) {
  return [...listFgNomenclature()]
    .sort((a, b) => b.bottles - a.bottles)
    .slice(0, limit)
}

export function fgKindLabel(kind: FgMarkingKind): string {
  if (kind === "bottle") return "Бутылка"
  if (kind === "block") return "Блок"
  return "Палета"
}

export function fmtFgDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU")
}

export function fmtFgQty(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n)
}
