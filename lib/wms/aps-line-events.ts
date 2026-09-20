import type { WmsCalendarEvent } from "@/lib/wms-api"
import { toDateKey } from "@/lib/wms/production-gantt-mapper"

export const APS_LINE_WASH_TYPE = "aps_line_wash"
export const APS_LINE_MAINT_TYPE = "aps_line_maint"

export type ApsLineEventKind = "wash" | "maint"

export type ApsLineEventRow = {
  eventId: string
  kind: ApsLineEventKind
  dateKey: string
  workshopCode: string | null
  shiftCode: string | null
  title: string
  afterPlanId: string | null
}

export function apsLineEventTypeCode(kind: ApsLineEventKind): string {
  return kind === "wash" ? APS_LINE_WASH_TYPE : APS_LINE_MAINT_TYPE
}

export function mapCalendarEventsToApsLineEvents(events: WmsCalendarEvent[]): ApsLineEventRow[] {
  return events
    .filter((e) => e.typeCode === APS_LINE_WASH_TYPE || e.typeCode === APS_LINE_MAINT_TYPE)
    .map((e) => {
      const d = new Date(e.startAt)
      const dateKey = Number.isNaN(d.getTime()) ? e.startAt.slice(0, 10) : toDateKey(d)
      const workshopCode = typeof e.refs?.workshopCode === "string" ? e.refs.workshopCode.trim() || null : null
      const shiftCode = typeof e.refs?.shiftCode === "string" ? e.refs.shiftCode.trim() || null : null
      const afterPlanId = typeof e.refs?.afterPlanId === "string" ? e.refs.afterPlanId.trim() || null : null
      return {
        eventId: e.eventId,
        kind: e.typeCode === APS_LINE_WASH_TYPE ? "wash" : "maint",
        dateKey,
        workshopCode,
        shiftCode,
        title: e.title,
        afterPlanId,
      }
    })
}

export function apsLineEventDayInMonth(
  event: ApsLineEventRow,
  year: number,
  monthIdx: number
): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.dateKey)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const day = Number(m[3])
  if (y !== year || mo !== monthIdx) return null
  return day
}

export function apsLineEventGroupKey(event: ApsLineEventRow): string {
  const w = (event.workshopCode || "").trim().toUpperCase()
  return w || "UNASSIGNED"
}
