/** Заводская укладка ГП: 6 бутылок в блоке, в палете обычно 84 блока. */

export const FG_BOTTLES_PER_BLOCK = 6

export function blocksFromBottles(bottles: number, perBlock = FG_BOTTLES_PER_BLOCK): number {
  const n = Math.round(Number(bottles) || 0)
  if (n <= 0 || perBlock <= 0) return 0
  return Math.floor(n / perBlock)
}

export function bottlesFromBlocks(blocks: number, perBlock = FG_BOTTLES_PER_BLOCK): number {
  const n = Math.round(Number(blocks) || 0)
  if (n <= 0 || perBlock <= 0) return 0
  return n * perBlock
}

export function ruBlocksWord(n: number): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return "блоков"
  if (b === 1) return "блок"
  if (b >= 2 && b <= 4) return "блока"
  return "блоков"
}

export function ruPalletsWord(n: number): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return "палет"
  if (b === 1) return "палета"
  if (b >= 2 && b <= 4) return "палеты"
  return "палет"
}

export function ruBottlesWord(n: number): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return "бутылок"
  if (b === 1) return "бутылка"
  if (b >= 2 && b <= 4) return "бутылки"
  return "бутылок"
}

const PALLET_PACKAGE = new Set(["LEVEL2", "LEVEL3", "PALLET", "BOX"])
const UNIT_PACKAGE = new Set(["LEVEL1", "UNIT"])

/** Дети LEVEL2/палеты в ЧЗ — блоки, не бутылки. */
export function inferPalletPack(input: {
  packageType?: string
  childCount: number
  planBottles?: number
}): { blocks: number; bottles: number } {
  const type = String(input.packageType || "").trim().toUpperCase()
  const children = Math.max(0, Math.round(Number(input.childCount) || 0))
  const planBottles = Math.max(0, Math.round(Number(input.planBottles) || 0))
  if (PALLET_PACKAGE.has(type) || (!type && children > 0 && children <= 200)) {
    const blocks = children
    const bottles = planBottles > 0 ? planBottles : bottlesFromBlocks(blocks)
    return { blocks, bottles }
  }
  if (UNIT_PACKAGE.has(type)) {
    return { blocks: blocksFromBottles(children || planBottles), bottles: children || planBottles }
  }
  return {
    blocks: children > 0 && children <= 200 ? children : blocksFromBottles(planBottles),
    bottles: planBottles || (children > 200 ? children : bottlesFromBlocks(children)),
  }
}
