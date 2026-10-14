/**
 * Права EDI. Личность общая (wms_users / SCADA ID), роли EDI — отдельная таблица edi_user_roles,
 * чтобы не перезаписывать складские роли. Если ролей EDI нет, действуют роли по умолчанию от роли WMS.
 * Все проверки выполняются на сервере; скрытие кнопок на клиенте — только удобство.
 */

import { wmsRoleFallbackEnabled } from "../auth/policy.ts"

export const EDI_PERMISSIONS = [
  "edi.doc.read",
  "edi.doc.read_confidential",
  "edi.doc.create",
  "edi.doc.edit",
  "edi.doc.sign",
  "edi.doc.send",
  "edi.doc.archive",
  "edi.doc.delete",
  "edi.import",
  "edi.counterparty.write",
  "edi.wms.receipt",
  "edi.workflow.admin",
  "edi.template.admin",
  "edi.admin",
  "edi.audit.read",
] as const

export type EdiPermission = (typeof EDI_PERMISSIONS)[number]

export const EDI_ROLES: Record<string, { name: string; permissions: EdiPermission[] }> = {
  edi_admin: { name: "Администратор EDI", permissions: [...EDI_PERMISSIONS] },
  edi_clerk: {
    name: "Делопроизводитель / бухгалтер",
    permissions: [
      "edi.doc.read",
      "edi.doc.create",
      "edi.doc.edit",
      "edi.doc.send",
      "edi.doc.archive",
      "edi.doc.delete",
      "edi.import",
      "edi.counterparty.write",
      "edi.wms.receipt",
    ],
  },
  edi_approver: { name: "Согласующий", permissions: ["edi.doc.read"] },
  edi_signer: { name: "Подписант", permissions: ["edi.doc.read", "edi.doc.sign", "edi.doc.send"] },
  edi_lawyer: { name: "Юрист", permissions: ["edi.doc.read", "edi.doc.read_confidential", "edi.doc.edit", "edi.template.admin"] },
  edi_viewer: { name: "Просмотр", permissions: ["edi.doc.read"] },
  edi_auditor: { name: "Аудитор", permissions: ["edi.doc.read", "edi.doc.read_confidential", "edi.audit.read"] },
}

/** Роли EDI по умолчанию для существующих ролей WMS (когда в edi_user_roles пусто). */
export const EDI_DEFAULTS_FROM_WMS: Record<string, string[]> = {
  admin: ["edi_admin"],
  warehouse_manager: ["edi_clerk", "edi_approver"],
  warehouse_operator: ["edi_viewer"],
  line_operator: [],
  auditor: ["edi_auditor"],
  yms_logist: ["edi_viewer"],
}

/** Роль из гранта SCADA ID для приложения scada-edi. */
export const EDI_ROLES_FROM_SCADA: Record<string, string[]> = {
  god: ["edi_admin"],
  admin: ["edi_admin"],
  operator: ["edi_clerk", "edi_approver"],
  signer: ["edi_signer", "edi_approver"],
  approver: ["edi_approver"],
  viewer: ["edi_viewer"],
  none: [],
}

export function effectiveEdiRoles(wmsRoles: string[], ediRoles: string[]): string[] {
  const explicit = ediRoles.filter((r) => r in EDI_ROLES)
  if (explicit.length > 0) return [...new Set(explicit)].sort()
  if (!wmsRoleFallbackEnabled()) return []
  const out = new Set<string>()
  for (const role of wmsRoles) for (const r of EDI_DEFAULTS_FROM_WMS[role] ?? []) out.add(r)
  return [...out].sort()
}

export function permissionsForRoles(roles: string[]): Set<EdiPermission> {
  const out = new Set<EdiPermission>()
  for (const role of roles) for (const p of EDI_ROLES[role]?.permissions ?? []) out.add(p)
  return out
}
