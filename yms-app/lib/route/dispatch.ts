/**
 * Выбор следующего задания для погрузчика. Чистая функция: вход — кандидаты и стоимость пустого пробега.
 *
 * Порядок (ТЗ 6.4):
 *  1. безопасность и ограничения маршрута — без допустимого пути кандидат исключается;
 *  2. срочность производства/отгрузки — приоритет задания + срочность типа + ожидание;
 *  3. правила WMS и FEFO — в группе «номенклатура + тип отбора» доступна только палета
 *     с самым ранним сроком годности; близость FEFO не отменяет;
 *  4. совместимость погрузчика — тип погрузчика из задания;
 *  5–6. положение и холостой пробег — только как разрешение ничьей внутри одного уровня срочности.
 */
import { TYPE_URGENCY, type RouteTaskType } from "@/lib/route/state-machine"

export type Candidate = {
  taskId: string
  type: RouteTaskType
  priority: number
  createdAt: string
  itemCode: string | null
  expiryAt: string | null
  forkliftTypes: string[] | null
  declinedBy: string[]
}

export type Scored = Candidate & { band: number; emptyRunM: number | null; reason: string }

const FEFO_TYPES: ReadonlySet<RouteTaskType> = new Set(["SHIPPING_PICK", "STAGING"])

export function fefoEligible(cands: Candidate[]): Set<string> {
  const groups = new Map<string, Candidate[]>()
  const out = new Set<string>()
  for (const c of cands) {
    if (!FEFO_TYPES.has(c.type) || !c.itemCode) {
      out.add(c.taskId)
      continue
    }
    const k = `${c.type}|${c.itemCode}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(c)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const ea = a.expiryAt ? Date.parse(a.expiryAt) : Infinity
      const eb = b.expiryAt ? Date.parse(b.expiryAt) : Infinity
      if (ea !== eb) return ea - eb
      return Date.parse(a.createdAt) - Date.parse(b.createdAt)
    })
    out.add(list[0].taskId)
  }
  return out
}

export function urgencyBand(c: Candidate, now: number): number {
  const waitedMin = Math.max(0, (now - Date.parse(c.createdAt)) / 60000)
  // ожидание поднимает задание не более чем на 20 пунктов (один «уровень»)
  return Math.round(c.priority + (TYPE_URGENCY[c.type] ?? 0) + Math.min(20, waitedMin / 3))
}

/**
 * emptyRun: метров пустого пробега до места получения, null — пути нет (кандидат исключён).
 * Возвращает отсортированный список допустимых.
 */
export function rankCandidates(
  cands: Candidate[],
  opts: { karaId: string; forkliftType: string | null; now?: number },
  emptyRun: (c: Candidate) => number | null
): Scored[] {
  const now = opts.now ?? Date.now()
  const fefo = fefoEligible(cands)
  const out: Scored[] = []
  for (const c of cands) {
    if (c.declinedBy.includes(opts.karaId)) continue
    if (!fefo.has(c.taskId)) continue
    if (c.forkliftTypes && c.forkliftTypes.length && opts.forkliftType && !c.forkliftTypes.includes(opts.forkliftType)) continue
    const run = emptyRun(c)
    if (run == null) continue
    out.push({ ...c, band: urgencyBand(c, now), emptyRunM: run, reason: "" })
  }
  out.sort((a, b) => {
    // уровни по 10 пунктов: внутри уровня решает пробег
    const la = Math.floor(a.band / 10)
    const lb = Math.floor(b.band / 10)
    if (la !== lb) return lb - la
    if ((a.emptyRunM ?? 0) !== (b.emptyRunM ?? 0)) return (a.emptyRunM ?? 0) - (b.emptyRunM ?? 0)
    return Date.parse(a.createdAt) - Date.parse(b.createdAt)
  })
  for (const s of out) {
    s.reason = `срочность ${s.band}, пустой пробег ${Math.round(s.emptyRunM ?? 0)} м`
  }
  return out
}
