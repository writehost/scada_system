export type BottleSize = {
  volumeL: number
  bottleWeightG: number
  bottleHeightMm: number
  bottleDiameterMm: number
  bottlesPerLayer: number
  defaultLayers: number
}

export const BOTTLE_SIZES: BottleSize[] = [
  { volumeL: 0.33, bottleWeightG: 370, bottleHeightMm: 185, bottleDiameterMm: 60, bottlesPerLayer: 24, defaultLayers: 8 },
  { volumeL: 0.5, bottleWeightG: 600, bottleHeightMm: 210, bottleDiameterMm: 65, bottlesPerLayer: 24, defaultLayers: 6 },
  { volumeL: 1, bottleWeightG: 1070, bottleHeightMm: 280, bottleDiameterMm: 80, bottlesPerLayer: 16, defaultLayers: 5 },
  { volumeL: 1.5, bottleWeightG: 1570, bottleHeightMm: 320, bottleDiameterMm: 90, bottlesPerLayer: 12, defaultLayers: 5 },
  { volumeL: 5, bottleWeightG: 5200, bottleHeightMm: 350, bottleDiameterMm: 170, bottlesPerLayer: 4, defaultLayers: 3 },
  { volumeL: 11, bottleWeightG: 11400, bottleHeightMm: 400, bottleDiameterMm: 230, bottlesPerLayer: 2, defaultLayers: 2 },
  { volumeL: 19, bottleWeightG: 19600, bottleHeightMm: 480, bottleDiameterMm: 270, bottlesPerLayer: 2, defaultLayers: 2 },
]

export const EURO_PALLET_MM = { length: 1200, width: 800, height: 144 }
export const DEFAULT_PALLET_TARE_KG = 22
export const DEFAULT_FILM_KG = 0.4

export type PackVghInput = {
  name?: string | null
  volumeL?: number | null
  bottleWeightG?: number | null
  bottlesPerPallet?: number | null
  layers?: number | null
  bottlesPerLayer?: number | null
  palletTareKg?: number | null
  filmKg?: number | null
}

export type PackVghResult = {
  volumeL: number
  bottleWeightG: number
  bottleHeightMm: number
  bottleDiameterMm: number
  bottlesPerLayer: number
  layers: number
  bottlesPerPallet: number
  palletTareKg: number
  filmKg: number
  unitNetKg: number
  palletNetKg: number
  palletGrossKg: number
  palletLengthMm: number
  palletWidthMm: number
  palletHeightMm: number
  hint: string
}

function asNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function parseVolumeLiters(name: string | null | undefined): number | null {
  const t = (name ?? "").toLowerCase().replace(/ё/g, "е").replace(",", ".")
  const m =
    t.match(/(\d+(?:\.\d+)?)\s*л\b/) ||
    t.match(/(\d+(?:\.\d+)?)\s*l\b/) ||
    t.match(/\b(\d+(?:\.\d+)?)л\b/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export function parsePackMultiplier(name: string | null | undefined): number | null {
  const t = (name ?? "").toLowerCase()
  const m = t.match(/(\d+)\s*[xх×]/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 1 ? n : null
}

export function nearestBottleSize(volumeL: number): BottleSize {
  let best = BOTTLE_SIZES[1]!
  let dist = Math.abs(best.volumeL - volumeL)
  for (const row of BOTTLE_SIZES) {
    const d = Math.abs(row.volumeL - volumeL)
    if (d < dist) {
      best = row
      dist = d
    }
  }
  return best
}

export function computePackVgh(input: PackVghInput): PackVghResult | null {
  const volumeL = asNum(input.volumeL) ?? parseVolumeLiters(input.name)
  if (volumeL == null) return null
  const size = nearestBottleSize(volumeL)
  const bottleWeightG = asNum(input.bottleWeightG) ?? size.bottleWeightG
  const bottlesPerLayer = Math.max(1, Math.round(asNum(input.bottlesPerLayer) ?? size.bottlesPerLayer))
  const layers = Math.max(1, Math.round(asNum(input.layers) ?? size.defaultLayers))
  const bottlesPerPallet = Math.max(
    1,
    Math.round(asNum(input.bottlesPerPallet) ?? bottlesPerLayer * layers)
  )
  const resolvedLayers =
    asNum(input.layers) != null ? layers : Math.max(1, Math.round(bottlesPerPallet / bottlesPerLayer))
  const palletTareKg = asNum(input.palletTareKg) ?? DEFAULT_PALLET_TARE_KG
  const filmKg = asNum(input.filmKg) ?? DEFAULT_FILM_KG
  const unitNetKg = bottleWeightG / 1000
  const palletNetKg = unitNetKg * bottlesPerPallet
  const palletGrossKg = palletNetKg + palletTareKg + filmKg
  const palletHeightMm = EURO_PALLET_MM.height + resolvedLayers * size.bottleHeightMm
  return {
    volumeL,
    bottleWeightG,
    bottleHeightMm: size.bottleHeightMm,
    bottleDiameterMm: size.bottleDiameterMm,
    bottlesPerLayer,
    layers: resolvedLayers,
    bottlesPerPallet,
    palletTareKg,
    filmKg,
    unitNetKg: Number(unitNetKg.toFixed(3)),
    palletNetKg: Number(palletNetKg.toFixed(2)),
    palletGrossKg: Number(palletGrossKg.toFixed(2)),
    palletLengthMm: EURO_PALLET_MM.length,
    palletWidthMm: EURO_PALLET_MM.width,
    palletHeightMm,
    hint: `${volumeL} л ≈ ${bottleWeightG} г бутылка × ${bottlesPerPallet} шт + поддон ${palletTareKg} кг + плёнка ${filmKg} кг = ${palletGrossKg.toFixed(1)} кг брутто палеты`,
  }
}

export function packVghToTypical(result: PackVghResult) {
  return {
    lengthMm: result.palletLengthMm,
    widthMm: result.palletWidthMm,
    heightMm: result.palletHeightMm,
    weightG: Math.round(result.palletGrossKg * 1000),
    unitNetKg: result.unitNetKg,
    bottlesPerPallet: result.bottlesPerPallet,
    layers: result.layers,
    hint: result.hint,
  }
}
