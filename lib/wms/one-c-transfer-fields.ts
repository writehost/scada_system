export type ErpCatalogKind = "organization" | "priority" | "user" | "department"

export type ErpCatalogItem = {
  kind: ErpCatalogKind
  refKey: string
  code: string
  name: string
}

export type ErpTransferCatalogs = {
  organizations: ErpCatalogItem[]
  priorities: ErpCatalogItem[]
  users: ErpCatalogItem[]
  departments: ErpCatalogItem[]
}

export type TransferHeaderFields = {
  organizationKey: string
  recipientOrganizationKey: string
  priorityKey: string
  authorKey: string
  departmentKey: string
  responsibleKey: string
  sourceWarehouseKey: string
  targetWarehouseKey: string
  status: string
  operation: string
  deliveryMethod: string
  activity: string
  acceptanceVariant: string
  supplyVariant: string
}

export const DEFAULT_TRANSFER_HEADER: TransferHeaderFields = {
  organizationKey: "",
  recipientOrganizationKey: "",
  priorityKey: "",
  authorKey: "",
  departmentKey: "",
  responsibleKey: "",
  sourceWarehouseKey: "",
  targetWarehouseKey: "",
  status: "КВыполнению",
  operation: "ПеремещениеТоваров",
  deliveryMethod: "Самовывоз",
  activity: "ПродажаОблагаетсяНДС",
  acceptanceVariant: "РазделенаТолькоПоНакладным",
  supplyVariant: "Отгрузить",
}

export const ERP_TRANSFER_ENUMS: Record<
  "status" | "operation" | "deliveryMethod" | "activity" | "acceptanceVariant" | "supplyVariant",
  Array<{ value: string; label: string }>
> = {
  status: [
    { value: "КВыполнению", label: "К выполнению" },
    { value: "КОбеспечению", label: "К обеспечению" },
    { value: "Согласован", label: "Согласован" },
    { value: "Закрыт", label: "Закрыт" },
  ],
  operation: [
    { value: "ПеремещениеТоваров", label: "Перемещение товаров" },
    { value: "ПеремещениеТоваровМеждуФилиалами", label: "Между филиалами" },
  ],
  deliveryMethod: [
    { value: "Самовывоз", label: "Самовывоз" },
    { value: "ДоКлиента", label: "До клиента" },
    { value: "СиламиПеревозчика", label: "Силами перевозчика" },
  ],
  activity: [
    { value: "ПродажаОблагаетсяНДС", label: "Продажа, облагается НДС" },
    { value: "ПродажаНеОблагаетсяНДС", label: "Продажа, не облагается НДС" },
    { value: "ПродажаОблагаетсяЕНВД", label: "Продажа, ЕНВД" },
  ],
  acceptanceVariant: [
    { value: "РазделенаТолькоПоНакладным", label: "Разделена только по накладным" },
    { value: "РазделенаПоЗаказамИНакладным", label: "Разделена по заказам и накладным" },
    { value: "НеРазделена", label: "Не разделена" },
  ],
  supplyVariant: [
    { value: "Отгрузить", label: "Отгрузить" },
    { value: "СоСклада", label: "Со склада" },
    { value: "ИзЗаказов", label: "Из заказов" },
  ],
}

export function emptyErpCatalogs(): ErpTransferCatalogs {
  return { organizations: [], priorities: [], users: [], departments: [] }
}

export function headerFromSettings(settings: Partial<Record<string, string | boolean | null>> | null | undefined): TransferHeaderFields {
  const s = settings ?? {}
  const pick = (key: string, fallback: string) => {
    const value = s[key]
    return typeof value === "string" && value.trim() ? value.trim() : fallback
  }
  return {
    organizationKey: pick("defaultOrganizationKey", DEFAULT_TRANSFER_HEADER.organizationKey),
    recipientOrganizationKey: pick("defaultRecipientOrganizationKey", DEFAULT_TRANSFER_HEADER.recipientOrganizationKey),
    priorityKey: pick("defaultPriorityKey", DEFAULT_TRANSFER_HEADER.priorityKey),
    authorKey: pick("defaultAuthorKey", DEFAULT_TRANSFER_HEADER.authorKey),
    departmentKey: pick("defaultDepartmentKey", DEFAULT_TRANSFER_HEADER.departmentKey),
    responsibleKey: pick("defaultResponsibleKey", DEFAULT_TRANSFER_HEADER.responsibleKey),
    sourceWarehouseKey: pick("defaultSourceWarehouseKey", DEFAULT_TRANSFER_HEADER.sourceWarehouseKey),
    targetWarehouseKey: pick("defaultTargetWarehouseKey", DEFAULT_TRANSFER_HEADER.targetWarehouseKey),
    status: pick("defaultStatus", DEFAULT_TRANSFER_HEADER.status),
    operation: pick("defaultOperation", DEFAULT_TRANSFER_HEADER.operation),
    deliveryMethod: pick("defaultDeliveryMethod", DEFAULT_TRANSFER_HEADER.deliveryMethod),
    activity: pick("defaultActivity", DEFAULT_TRANSFER_HEADER.activity),
    acceptanceVariant: pick("defaultAcceptanceVariant", DEFAULT_TRANSFER_HEADER.acceptanceVariant),
    supplyVariant: pick("defaultSupplyVariant", DEFAULT_TRANSFER_HEADER.supplyVariant),
  }
}

export function settingsFromHeader(header: TransferHeaderFields): Record<string, string> {
  return {
    defaultOrganizationKey: header.organizationKey,
    defaultRecipientOrganizationKey: header.recipientOrganizationKey,
    defaultPriorityKey: header.priorityKey,
    defaultAuthorKey: header.authorKey,
    defaultDepartmentKey: header.departmentKey,
    defaultResponsibleKey: header.responsibleKey,
    defaultSourceWarehouseKey: header.sourceWarehouseKey,
    defaultTargetWarehouseKey: header.targetWarehouseKey,
    defaultStatus: header.status,
    defaultOperation: header.operation,
    defaultDeliveryMethod: header.deliveryMethod,
    defaultActivity: header.activity,
    defaultAcceptanceVariant: header.acceptanceVariant,
    defaultSupplyVariant: header.supplyVariant,
  }
}
