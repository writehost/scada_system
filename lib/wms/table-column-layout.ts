export type TableColumnLayout = {
  order: string[]
  hidden: string[]
}

export function emptyTableLayout(): TableColumnLayout {
  return { order: [], hidden: [] }
}

export function mergeTableLayout(
  allIds: string[],
  lockedIds: string[],
  saved?: TableColumnLayout | null,
  defaultHidden: string[] = []
): { order: string[]; hidden: string[]; visible: string[] } {
  const allowed = new Set(allIds)
  const locked = new Set(lockedIds.filter((id) => allowed.has(id)))
  const movable = allIds.filter((id) => !locked.has(id))

  const fromSaved = (saved?.order || []).filter((id) => allowed.has(id) && !locked.has(id))
  const order = [...fromSaved]
  for (const id of movable) {
    if (!order.includes(id)) order.push(id)
  }

  const savedOrder = saved?.order || []
  const savedHidden = saved?.hidden || []
  const isPristine = savedOrder.length === 0 && savedHidden.length === 0
  const hiddenSource = isPristine ? defaultHidden : savedHidden

  const hidden = new Set(hiddenSource.filter((id) => allowed.has(id) && !locked.has(id)))
  if (order.every((id) => hidden.has(id)) && order[0]) hidden.delete(order[0])

  // Locked columns keep their place in the column definition (code left, actions right).
  const movableVisible = order.filter((id) => !hidden.has(id))
  const visible: string[] = []
  let qi = 0
  for (const id of allIds) {
    if (locked.has(id)) {
      visible.push(id)
    } else if (!hidden.has(id)) {
      const next = movableVisible[qi++]
      if (next) visible.push(next)
    }
  }
  return { order, hidden: [...hidden], visible }
}

export function moveColumn(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order
  const next = order.filter((id) => id !== fromId)
  const idx = next.indexOf(toId)
  if (idx < 0) return order
  next.splice(idx, 0, fromId)
  return next
}

export function layoutStorageKey(ownerKey: string, tableId: string): string {
  return `wms.tableLayout.v1.${ownerKey}.${tableId}`
}
