import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const CRPT_STATUS_LABELS: Record<string, string> = {
  INTRODUCED: "В обороте",
  APPLIED: "Нанесён",
  EMITTED: "Эмитирован",
  WRITTEN_OFF: "Списан",
  RETIRED: "Выведен",
  WITHDRAWN: "Изъят",
  DISAGGREGATION: "Расформирован",
  DISAGGREGATED: "Расформирован",
}

const ITEM_STATUS_LABELS: Record<string, string> = {
  эммитирован: "Эмитирован",
  эмитирован: "Эмитирован",
  просрочен: "Просрочен",
  истекает: "Истекает",
  нанесен: "Нанесён",
}

function crptStatusLabel(code: string | null | undefined): string | null {
  if (!code) return null
  const key = code.trim().toUpperCase()
  return CRPT_STATUS_LABELS[key] ?? code
}

function itemStatusLabel(code: string | null | undefined): string | null {
  if (!code) return null
  const key = code.trim().toLowerCase()
  return ITEM_STATUS_LABELS[key] ?? code
}

function toneForStatus(stickerStatus?: string | null, itemStatus?: string | null): string {
  const crpt = (stickerStatus ?? "").toUpperCase()
  const local = (itemStatus ?? "").toLowerCase()
  if (local === "просрочен" || crpt === "WRITTEN_OFF" || crpt === "RETIRED" || crpt === "WITHDRAWN") {
    return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
  }
  if (local === "истекает") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400"
  }
  if (crpt === "EMITTED") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  }
  if (crpt === "INTRODUCED" || crpt === "APPLIED" || local === "эммитирован" || local === "эмитирован") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  }
  return "border-border bg-secondary text-foreground"
}

export function StickerStatusBadge({
  stickerStatus,
  itemStatus,
  className,
}: {
  stickerStatus?: string | null
  itemStatus?: string | null
  className?: string
}) {
  const primary = crptStatusLabel(stickerStatus) ?? itemStatusLabel(itemStatus)
  if (!primary) return <span className="text-muted-foreground">—</span>

  const secondary =
    stickerStatus && itemStatus && crptStatusLabel(stickerStatus) !== itemStatusLabel(itemStatus)
      ? itemStatusLabel(itemStatus)
      : null

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Badge variant="outline" className={cn("w-fit rounded-lg font-medium", toneForStatus(stickerStatus, itemStatus))}>
        {primary}
      </Badge>
      {secondary ? <span className="text-[11px] text-muted-foreground">Приёмка: {secondary}</span> : null}
    </div>
  )
}

export function formatEmissionDate(value: string | null | undefined): string {
  if (!value) return "—"
  const compactDate = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDate) {
    const d = new Date(Date.UTC(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3])))
    return d.toLocaleDateString("ru-RU", { timeZone: "UTC" })
  }
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDate) {
    const d = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])))
    return d.toLocaleDateString("ru-RU", { timeZone: "UTC" })
  }
  const ruDate = value.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})(?:\s|$)/)
  if (ruDate) return `${ruDate[1]}.${ruDate[2]}.${ruDate[3]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })
}
