"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { buildTopologyTree, type TopologyNode } from "@/lib/storage-slot-ui"
import { cn } from "@/lib/utils"
import { isCalendarExpiryPast } from "@/lib/wms/expiry-sticker"
import type { WmsLocationRow } from "@/lib/wms-api"
import { buildOccupancyIndex, occupancyBusyFree, type CellOccupancyBucket } from "./cells-utils"

type Props = {
  locations: WmsLocationRow[]
  selectedCode: string | null
  activeZoneKey: string | null
  activeWarehouseCode?: string | null
  warehouseLabels?: Record<string, string>
  workshopCodes?: string[]
  onSelectZone: (warehouseCode: string, zoneCode: string | null) => void
  onSelectLocation: (code: string) => void
  onSelectWarehouse?: (warehouseCode: string) => void
}

function filterTree(nodes: TopologyNode[], query: string): TopologyNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes

  function walk(node: TopologyNode): TopologyNode | null {
    const labelMatch = node.label.toLowerCase().includes(q)
    const codeMatch = node.locationCode?.toLowerCase().includes(q)
    const kids = node.children.map(walk).filter(Boolean) as TopologyNode[]
    if (labelMatch || codeMatch || kids.length > 0) {
      return { ...node, children: kids }
    }
    return null
  }

  return nodes.map(walk).filter(Boolean) as TopologyNode[]
}

function findPath(
  nodes: TopologyNode[],
  match: (node: TopologyNode) => boolean
): string[] | null {
  for (const node of nodes) {
    if (match(node)) return [node.id]
    const childPath = findPath(node.children, match)
    if (childPath) return [node.id, ...childPath]
  }
  return null
}

function parseZoneNodeId(nodeId: string): { warehouseCode: string; zoneCode: string } | null {
  if (!nodeId.startsWith("zone:")) return null
  const rest = nodeId.slice("zone:".length)
  const sep = rest.indexOf(":")
  if (sep <= 0) return null
  return {
    warehouseCode: rest.slice(0, sep),
    zoneCode: rest.slice(sep + 1),
  }
}

function zoneKeyFromNodeId(nodeId: string): string | null {
  const parsed = parseZoneNodeId(nodeId)
  return parsed ? `${parsed.warehouseCode}::${parsed.zoneCode}` : null
}

function collectNodeIds(nodes: TopologyNode[], ids: string[] = []): string[] {
  for (const n of nodes) {
    ids.push(n.id)
    collectNodeIds(n.children, ids)
  }
  return ids
}

function warehouseCodeFromNode(node: TopologyNode): string | null {
  const zone = parseZoneNodeId(node.id)
  if (zone) return zone.warehouseCode
  const prefixed = node.id.match(/^(?:wh|warehouse|site):(.+)$/i)
  if (prefixed?.[1]) return prefixed[1]
  const fromKids = new Set<string>()
  for (const child of node.children) {
    const code = warehouseCodeFromNode(child)
    if (code) fromKids.add(code)
  }
  if (fromKids.size === 1) return [...fromKids][0]
  return null
}

function occupancyForNode(
  node: TopologyNode,
  index: ReturnType<typeof buildOccupancyIndex>
): CellOccupancyBucket | undefined {
  const zoneKey = zoneKeyFromNodeId(node.id)
  if (zoneKey) return index.byZone.get(zoneKey)
  const warehouse = warehouseCodeFromNode(node)
  if (warehouse) return index.byWarehouse.get(warehouse)
  return undefined
}

export function CellsTopologyPanel({
  locations,
  selectedCode,
  activeZoneKey,
  activeWarehouseCode,
  warehouseLabels,
  workshopCodes,
  onSelectZone,
  onSelectLocation,
  onSelectWarehouse,
}: Props) {
  const [treeQuery, setTreeQuery] = useState("")
  /** false = развёрнут, true / отсутствие ключа = свёрнут (по умолчанию свёрнуто) */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const topology = useMemo(
    () => buildTopologyTree(locations, { warehouseLabels, workshopCodes }),
    [locations, warehouseLabels, workshopCodes]
  )
  const visible = useMemo(() => filterTree(topology, treeQuery), [topology, treeQuery])
  const occupancy = useMemo(() => buildOccupancyIndex(locations), [locations])
  const expiredCodes = useMemo(() => {
    const set = new Set<string>()
    for (const loc of locations) {
      if (isCalendarExpiryPast(loc.nearestExpiryAt)) set.add(loc.locationCode)
    }
    return set
  }, [locations])

  function isOpen(id: string) {
    return collapsed[id] === false
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const currentlyOpen = prev[id] === false
      return { ...prev, [id]: currentlyOpen ? true : false }
    })
  }

  function setExpandedForNodes(nodes: TopologyNode[], expanded: boolean) {
    const next: Record<string, boolean> = {}
    for (const id of collectNodeIds(nodes)) {
      next[id] = !expanded
    }
    setCollapsed((prev) => ({ ...prev, ...next }))
  }

  function expandAll(expanded: boolean) {
    setExpandedForNodes(topology, expanded)
  }

  useEffect(() => {
    if (!treeQuery.trim()) return
    setExpandedForNodes(visible, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при смене запроса
  }, [treeQuery])

  useEffect(() => {
    const toExpand = new Set<string>()
    if (selectedCode) {
      const path = findPath(topology, (n) => n.locationCode === selectedCode)
      if (path && path.length > 1) {
        for (const id of path.slice(0, -1)) toExpand.add(id)
      }
    }
    if (activeZoneKey) {
      const [wh, zone] = activeZoneKey.split("::")
      if (wh && zone) {
        const path = findPath(topology, (n) => n.id === `zone:${wh}:${zone}`)
        if (path) {
          for (const id of path) toExpand.add(id)
        }
      }
    }
    if (toExpand.size === 0) return
    setCollapsed((prev) => {
      const next = { ...prev }
      for (const id of toExpand) next[id] = false
      return next
    })
  }, [selectedCode, activeZoneKey, topology])

  function renderNode(node: TopologyNode, depth: number) {
    const hasChildren = node.children.length > 0
    const open = isOpen(node.id)
    const isZone = node.kind === "zone"
    const zoneKey = isZone ? zoneKeyFromNodeId(node.id) : null
    const zoneActive = isZone && activeZoneKey === zoneKey
    const isLoc = node.kind === "location" && node.locationCode
    const isWarehouse = node.kind === "warehouse"
    const warehouseCode = isWarehouse ? warehouseCodeFromNode(node) : null
    const locSelected = isLoc && selectedCode === node.locationCode
    const warehouseActive =
      isWarehouse && Boolean(warehouseCode) && warehouseCode === activeWarehouseCode && !activeZoneKey
    const locExpired = Boolean(isLoc && node.locationCode && expiredCodes.has(node.locationCode))
    const stats = !isLoc ? occupancyBusyFree(occupancyForNode(node, occupancy)) : null
    const selected = zoneActive || locSelected || warehouseActive

    function onRowClick() {
      if (isLoc && node.locationCode) {
        onSelectLocation(node.locationCode)
        return
      }
      if (isZone) {
        const parsed = parseZoneNodeId(node.id)
        if (parsed) {
          onSelectZone(parsed.warehouseCode, zoneActive ? null : parsed.zoneCode)
        }
        return
      }
      if (warehouseCode && onSelectWarehouse) {
        onSelectWarehouse(warehouseCode)
      }
    }

    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex w-full items-start gap-0.5 rounded-md pr-1.5 transition-colors",
            "hover:bg-muted/70",
            selected && "bg-primary/10 ring-1 ring-inset ring-primary/25",
            locExpired && !locSelected && "bg-destructive/5",
            depth === 0 && "font-medium"
          )}
          style={{ paddingLeft: `${6 + depth * 10}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="mt-0.5 flex h-6 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
              aria-expanded={open}
              aria-label={open ? "Свернуть" : "Развернуть"}
              onClick={(e) => {
                e.stopPropagation()
                toggle(node.id)
              }}
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
              />
            </button>
          ) : (
            <span className="mt-0.5 w-5 shrink-0" />
          )}
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-start gap-1.5 py-1 text-left",
              (isLoc || isZone || isWarehouse) && "cursor-pointer"
            )}
            title={isLoc ? node.locationCode ?? node.label : node.label}
            onClick={onRowClick}
            disabled={!isLoc && !isZone && !isWarehouse}
          >
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block leading-snug text-foreground",
                  isLoc
                    ? "break-all font-mono text-[11px] font-medium"
                    : "break-words text-[13px] [overflow-wrap:anywhere]",
                  depth === 0 && "text-[13px] font-semibold",
                  !isLoc && !isZone && "text-muted-foreground",
                  locExpired && "text-destructive"
                )}
              >
                {node.label}
              </span>
              {stats && stats.total > 0 ? (
                <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                  <span className="tabular-nums text-foreground">{stats.total}</span>
                  {" · "}
                  <span className="tabular-nums">{stats.busy} занято</span>
                  {" / "}
                  <span className="tabular-nums">{stats.free} свободно</span>
                </span>
              ) : null}
            </span>
            {locExpired ? (
              <span
                className="mt-0.5 shrink-0 rounded bg-destructive px-1 py-px text-[10px] font-semibold text-white"
                title="Просрочено"
              >
                !!!
              </span>
            ) : node.count != null && !stats ? (
              <span className="mt-0.5 shrink-0 tabular-nums text-[11px] text-muted-foreground">
                {node.count}
              </span>
            ) : null}
          </button>
        </div>
        {hasChildren && open ? node.children.map((c) => renderNode(c, depth + 1)) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card">
      <div className="shrink-0 border-b border-border/80 px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold tracking-tight">Топология</span>
          <div className="flex gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => expandAll(true)}
              title="Развернуть всё"
            >
              <ChevronsDownUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => expandAll(false)}
              title="Свернуть всё"
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <Input
          value={treeQuery}
          onChange={(e) => setTreeQuery(e.target.value)}
          placeholder="Поиск"
          className="h-8 rounded-md text-[13px]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
            Нет узлов по фильтру
          </p>
        ) : (
          visible.map((n) => renderNode(n, 0))
        )}
      </div>
    </div>
  )
}
