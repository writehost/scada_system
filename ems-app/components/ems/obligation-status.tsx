import { Badge } from "@/components/ui"

export function ObligationStatusBadge({ status, daysLeft }: { status: string; daysLeft?: number }) {
  if (status === "paid") return <Badge tone="success">Оплачено</Badge>
  if (status === "overdue") return <Badge tone="danger">Просрочено{daysLeft != null ? ` ${Math.abs(daysLeft)} дн.` : ""}</Badge>
  if (status === "due_soon") return <Badge tone="warning">{daysLeft === 0 ? "Сегодня" : daysLeft != null ? `Через ${daysLeft} дн.` : "Скоро срок"}</Badge>
  if (status === "cancelled") return <Badge>Отменено</Badge>
  return <Badge tone="neutral">Ожидается</Badge>
}
