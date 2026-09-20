"use client"

import { ERP_TRANSFER_ENUMS, type ErpCatalogItem, type TransferHeaderFields } from "@/lib/wms/one-c-transfer-fields"
import type { ErpWarehouse } from "@/lib/wms/one-c-erp-client"

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  extra,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  extra?: ErpCatalogItem | ErpWarehouse | null
}) {
  const seen = new Set(options.map((row) => row.value))
  const extras: Array<{ value: string; label: string }> = []
  if (extra && "refKey" in extra && extra.refKey && !seen.has(extra.refKey)) {
    extras.push({
      value: extra.refKey,
      label: "name" in extra ? extra.name || extra.refKey : extra.refKey,
    })
  } else if (value && !seen.has(value)) {
    extras.push({ value, label: value })
  }
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder || "Не задано"}</option>
        {extras.map((row) => (
          <option key={`extra-${row.value}`} value={row.value}>
            {row.label}
          </option>
        ))}
        {options.map((row) => (
          <option key={row.value} value={row.value}>
            {row.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function catalogOptions(items: ErpCatalogItem[]): Array<{ value: string; label: string }> {
  return items.map((item) => ({
    value: item.refKey,
    label: item.code ? `${item.name} · ${item.code}` : item.name,
  }))
}

function warehouseOptions(items: ErpWarehouse[]): Array<{ value: string; label: string }> {
  return items.map((item) => ({
    value: item.refKey,
    label: item.wmsCode ? `${item.name} · ${item.wmsCode}` : item.name,
  }))
}

export function ErpTransferHeaderFields({
  value,
  onChange,
  warehouses,
  organizations,
  priorities,
  users,
  departments,
  compact,
}: {
  value: TransferHeaderFields
  onChange: (next: TransferHeaderFields) => void
  warehouses: ErpWarehouse[]
  organizations: ErpCatalogItem[]
  priorities: ErpCatalogItem[]
  users: ErpCatalogItem[]
  departments: ErpCatalogItem[]
  compact?: boolean
}) {
  const patch = (partial: Partial<TransferHeaderFields>) => onChange({ ...value, ...partial })
  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-2 sm:grid-cols-2"}>
      <FieldSelect
        label="Склад-отправитель"
        value={value.sourceWarehouseKey}
        onChange={(sourceWarehouseKey) => patch({ sourceWarehouseKey })}
        options={warehouseOptions(warehouses)}
        placeholder="Выберите склад 1С"
      />
      <FieldSelect
        label="Склад-получатель"
        value={value.targetWarehouseKey}
        onChange={(targetWarehouseKey) => patch({ targetWarehouseKey })}
        options={warehouseOptions(warehouses)}
        placeholder="Выберите склад 1С"
      />
      <FieldSelect
        label="Организация"
        value={value.organizationKey}
        onChange={(organizationKey) => patch({ organizationKey })}
        options={catalogOptions(organizations)}
        placeholder="Организация 1С"
      />
      <FieldSelect
        label="Организация-получатель"
        value={value.recipientOrganizationKey}
        onChange={(recipientOrganizationKey) => patch({ recipientOrganizationKey })}
        options={catalogOptions(organizations)}
        placeholder="Как отправитель, если пусто"
      />
      <FieldSelect
        label="Подразделение"
        value={value.departmentKey}
        onChange={(departmentKey) => patch({ departmentKey })}
        options={catalogOptions(departments)}
      />
      <FieldSelect
        label="Ответственный"
        value={value.responsibleKey}
        onChange={(responsibleKey) => patch({ responsibleKey })}
        options={catalogOptions(users)}
      />
      <FieldSelect
        label="Автор"
        value={value.authorKey}
        onChange={(authorKey) => patch({ authorKey })}
        options={catalogOptions(users)}
      />
      <FieldSelect
        label="Приоритет 1С"
        value={value.priorityKey}
        onChange={(priorityKey) => patch({ priorityKey })}
        options={catalogOptions(priorities)}
      />
      <FieldSelect
        label="Статус"
        value={value.status}
        onChange={(status) => patch({ status })}
        options={ERP_TRANSFER_ENUMS.status}
      />
      <FieldSelect
        label="Хоз. операция"
        value={value.operation}
        onChange={(operation) => patch({ operation })}
        options={ERP_TRANSFER_ENUMS.operation}
      />
      <FieldSelect
        label="Способ доставки"
        value={value.deliveryMethod}
        onChange={(deliveryMethod) => patch({ deliveryMethod })}
        options={ERP_TRANSFER_ENUMS.deliveryMethod}
      />
      <FieldSelect
        label="Перемещение под деятельность"
        value={value.activity}
        onChange={(activity) => patch({ activity })}
        options={ERP_TRANSFER_ENUMS.activity}
      />
      <FieldSelect
        label="Вариант приёмки"
        value={value.acceptanceVariant}
        onChange={(acceptanceVariant) => patch({ acceptanceVariant })}
        options={ERP_TRANSFER_ENUMS.acceptanceVariant}
      />
      <FieldSelect
        label="Вариант обеспечения"
        value={value.supplyVariant}
        onChange={(supplyVariant) => patch({ supplyVariant })}
        options={ERP_TRANSFER_ENUMS.supplyVariant}
      />
    </div>
  )
}
