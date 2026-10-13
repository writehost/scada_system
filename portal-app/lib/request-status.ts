export type RequestStatus = "new" | "in_review" | "approved" | "rejected" | "invited" | "access_granted"

export const REQUEST_STATUSES: RequestStatus[] = [
  "new",
  "in_review",
  "approved",
  "rejected",
  "invited",
  "access_granted",
]

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  new: "Новая",
  in_review: "На рассмотрении",
  approved: "Одобрена",
  rejected: "Отклонена",
  invited: "Приглашение отправлено",
  access_granted: "Доступ предоставлен",
}

/**
 * Переходы, которые админ делает вручную. `approved → invited` происходит только
 * через отправку приглашения, `invited → access_granted` — через активацию
 * пользователем или подтверждение ручной выдачи.
 */
const MANUAL: Record<RequestStatus, RequestStatus[]> = {
  new: ["in_review", "rejected"],
  in_review: ["approved", "rejected"],
  approved: ["in_review", "rejected"],
  rejected: ["in_review"],
  invited: [],
  access_granted: [],
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return MANUAL[from]?.includes(to) ?? false
}

export function manualTargets(from: RequestStatus): RequestStatus[] {
  return MANUAL[from] ?? []
}

export function isRequestStatus(v: unknown): v is RequestStatus {
  return typeof v === "string" && (REQUEST_STATUSES as string[]).includes(v)
}

/** Одобрять можно только подмножество запрошенного — частичное одобрение. */
export function validateApproval(requested: string[], approved: string[]): string | null {
  if (approved.length === 0) return "Выберите хотя бы один модуль для одобрения"
  const extra = approved.filter((m) => !requested.includes(m))
  if (extra.length) return `Нельзя одобрить незапрошенные модули: ${extra.join(", ")}`
  return null
}

/** Как статус видит заявитель: «Новая» для него — уже «На рассмотрении». */
export const APPLICANT_STATUS_LABEL: Record<RequestStatus, string> = {
  new: "На рассмотрении",
  in_review: "На рассмотрении",
  approved: "Одобрена",
  rejected: "Отклонена",
  invited: "Ожидает активации",
  access_granted: "Доступ предоставлен",
}
