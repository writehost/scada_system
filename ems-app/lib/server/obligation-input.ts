import type { Body } from "./validate.ts"
import { dateKey, num, oneOf, reqStr, str, uuid } from "./validate.ts"
import { badRequest } from "./errors.ts"
import { isUuid } from "./db.ts"
import type { ObligationInput } from "../services/finance.ts"

export function obligationFromBody(body: Body, partial = false): Partial<ObligationInput> {
  const out: Partial<ObligationInput> = {}
  if (!partial || "title" in body) out.title = reqStr(body, "title", "Название услуги", 120)
  if (!partial || "service" in body) out.service = oneOf(body, "service", "Услуга", ["electricity", "cold_water", "hot_water", "wastewater", "heating", "gas", "internet", "other"] as const)
  if (!partial || "amountMode" in body) out.amountMode = oneOf(body, "amountMode", "Способ расчёта суммы", ["fixed", "calculated", "manual"] as const)
  if ("amount" in body) out.amount = num(body, "amount", "Сумма", { min: 0, max: 1e10 })
  if (!partial || "dueDate" in body) out.dueDate = dateKey(body, "dueDate", "Дата оплаты", true)!
  if ("readingsDueDate" in body) out.readingsDueDate = dateKey(body, "readingsDueDate", "Срок передачи показаний")
  if ("recurrence" in body) out.recurrence = body.recurrence
  if ("remindDays" in body) out.remindDays = num(body, "remindDays", "Напомнить за, дней", { min: 0, max: 60, integer: true }) ?? 3
  if ("readingsRemindDays" in body) out.readingsRemindDays = num(body, "readingsRemindDays", "Напомнить о показаниях за, дней", { min: 0, max: 60, integer: true }) ?? 2
  if ("providerName" in body) out.providerName = str(body, "providerName", "Поставщик", { max: 120 })
  if ("accountNumber" in body) out.accountNumber = str(body, "accountNumber", "Лицевой счёт", { max: 60 })
  if ("note" in body) out.note = str(body, "note", "Примечание", { max: 500 })
  if ("siteId" in body) out.siteId = uuid(body, "siteId", "Объект")
  if ("accountId" in body) out.accountId = uuid(body, "accountId", "Лицевой счёт")
  if ("recipientIds" in body) {
    if (!Array.isArray(body.recipientIds) || !body.recipientIds.every(isUuid)) throw badRequest("Получатели: список идентификаторов")
    out.recipientIds = body.recipientIds as string[]
  }
  return out
}
