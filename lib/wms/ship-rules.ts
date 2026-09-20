export type ShipRuleRow = {
  code: string
  name: string
  groupCode: string | null
  requiredLayers: number | null
  minRemainingDays: number | null
  note: string | null
  isActive: boolean
}

export type ShipLotPreview = {
  itemCode: string
  itemName: string
  lotCode: string
  bottles: number
  layers: number | null
  expiryAt: string | null
  manufacturedAt: string | null
  remainingDays: number | null
  reservedRuleCode: string | null
  reservedRuleName: string | null
  freshOk: boolean
  layerOk: boolean
  eligible: boolean
  reason: string | null
}

export function remainingShelfDays(expiryAt: string | Date | null | undefined, now = Date.now()): number | null {
  if (expiryAt == null) return null
  const d = expiryAt instanceof Date ? expiryAt : new Date(expiryAt)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((d.getTime() - now) / 86400000)
}

export function evaluateShipLot(
  lot: {
    remainingDays: number | null
    layers: number | null
    reservedRuleCode?: string | null
  },
  rule: Pick<ShipRuleRow, "code" | "requiredLayers" | "minRemainingDays">
): { freshOk: boolean; layerOk: boolean; eligible: boolean; reason: string | null } {
  const freshOk =
    rule.minRemainingDays == null ||
    (lot.remainingDays != null && lot.remainingDays >= rule.minRemainingDays)
  const layerOk = rule.requiredLayers == null || lot.layers == null || lot.layers === rule.requiredLayers
  if (lot.reservedRuleCode && lot.reservedRuleCode !== rule.code) {
    return {
      freshOk,
      layerOk,
      eligible: false,
      reason: `Партия помечена под другого контрагента (${lot.reservedRuleCode})`,
    }
  }
  if (!freshOk) {
    return {
      freshOk,
      layerOk,
      eligible: false,
      reason:
        lot.remainingDays == null
          ? "Нет срока годности — сеть просит свежую продукцию"
          : `Остаток срока ${lot.remainingDays} дн., нужно ≥ ${rule.minRemainingDays}`,
    }
  }
  if (!layerOk) {
    return {
      freshOk,
      layerOk,
      eligible: true,
      reason: `Собрать ${rule.requiredLayers} слоя (сейчас в карточке ${lot.layers})`,
    }
  }
  return { freshOk, layerOk, eligible: true, reason: null }
}
