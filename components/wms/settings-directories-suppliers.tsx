"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  createDirectorySupplier,
  deleteDirectorySupplier,
  listDirectorySuppliers,
  patchDirectorySupplier,
  type SupplierMeta,
  type SupplierDirectoryRow,
} from "@/lib/wms-api"
import { WmsEmptyState, WmsTableSkeleton } from "@/components/wms/wms-shared"
import { SettingsSupplierContractsPanel } from "@/components/wms/settings-supplier-contracts-panel"

function emptyMeta(): SupplierMeta {
  return {
    legalName: "",
    kpp: "",
    ogrn: "",
    addresses: { legal: "", actual: "", delivery: "", postal: "" },
    phone: "",
    email: "",
    contactPerson: "",
    website: "",
    bankName: "",
    bankBik: "",
    bankAccount: "",
    corrAccount: "",
    note: "",
  }
}

function primaryAddress(meta?: SupplierMeta): string {
  const a = meta?.addresses
  return a?.delivery?.trim() || a?.actual?.trim() || a?.legal?.trim() || a?.postal?.trim() || ""
}

function contactLine(meta?: SupplierMeta): string {
  return [meta?.contactPerson, meta?.phone, meta?.email].filter(Boolean).join(" · ")
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground border-b pb-1 text-[11px] font-semibold uppercase tracking-wide">{children}</p>
  )
}

export function SettingsDirectoriesSuppliers() {
  const [rows, setRows] = useState<SupplierDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SupplierDirectoryRow | null>(null)
  const [saving, setSaving] = useState(false)

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [taxId, setTaxId] = useState("")
  const [meta, setMeta] = useState<SupplierMeta>(emptyMeta())
  const [isActive, setIsActive] = useState(true)

  function setAddress(key: keyof NonNullable<SupplierMeta["addresses"]>, value: string) {
    setMeta((m) => ({ ...m, addresses: { ...m.addresses, [key]: value } }))
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listDirectorySuppliers()
      setRows(res.suppliers || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить контрагентов")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditing(null)
    setCode("")
    setName("")
    setTaxId("")
    setMeta(emptyMeta())
    setIsActive(true)
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(row: SupplierDirectoryRow) {
    setEditing(row)
    setCode(row.code)
    setName(row.name)
    setTaxId(row.taxId || "")
    setMeta({ ...emptyMeta(), ...row.meta, addresses: { ...emptyMeta().addresses, ...row.meta?.addresses } })
    setIsActive(row.isActive)
    setError(null)
    setDialogOpen(true)
  }

  async function submitDialog() {
    const supplierName = name.trim()
    if (!supplierName) {
      setError("Укажите краткое наименование контрагента")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = { name: supplierName, taxId: taxId.trim() || null, meta }
      if (editing) {
        await patchDirectorySupplier(editing.code, { ...payload, isActive })
        setDialogOpen(false)
      } else {
        const res = await createDirectorySupplier({ code: code.trim() || undefined, ...payload })
        setEditing(res.supplier)
        setCode(res.supplier.code)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  async function deactivate(row: SupplierDirectoryRow) {
    if (!window.confirm(`Деактивировать контрагента «${row.name}»?`)) return
    setError(null)
    try {
      await deleteDirectorySupplier(row.code)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось деактивировать")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Контрагенты</h3>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Полная карточка поставщика: реквизиты, адреса, контакты, банк и договоры. Используется в ручной приёмке и
            алиасах номенклатуры.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          <Button size="sm" className="rounded-xl" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
        </div>
      </div>

      {error && !dialogOpen ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : null}

      {loading ? (
        <WmsTableSkeleton rows={5} columns={6} />
      ) : rows.length === 0 ? (
        <WmsEmptyState
          title="Контрагентов пока нет"
          description="Добавьте поставщика с адресом и контактами."
          action={
            <Button className="rounded-xl" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить контрагента
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Контрагент</th>
                <th className="px-4 py-3 font-medium">Реквизиты</th>
                <th className="px-4 py-3 font-medium">Адрес</th>
                <th className="px-4 py-3 font-medium">Контакт</th>
                <th className="px-4 py-3 font-medium">Договоры</th>
                <th className="px-4 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">{row.code}</div>
                    {!row.isActive ? <span className="text-muted-foreground text-xs">неактивен</span> : null}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {row.taxId ? <div>ИНН {row.taxId}</div> : null}
                    {row.meta?.kpp ? <div>КПП {row.meta.kpp}</div> : null}
                    {row.meta?.ogrn ? <div>ОГРН {row.meta.ogrn}</div> : null}
                    {!row.taxId && !row.meta?.kpp && !row.meta?.ogrn ? "—" : null}
                  </td>
                  <td className="text-muted-foreground max-w-[220px] px-4 py-3 text-xs">
                    {primaryAddress(row.meta) || "—"}
                  </td>
                  <td className="text-muted-foreground max-w-[180px] px-4 py-3 text-xs">
                    {contactLine(row.meta) || "—"}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {(row.contractCount ?? 0) > 0 ? (
                      <>
                        <div>{row.contractCount} шт.</div>
                        {row.defaultContractNumber ? (
                          <div className="text-[10px]">осн. {row.defaultContractNumber}</div>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {row.isActive ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void deactivate(row)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать контрагента" : "Новый контрагент"}</DialogTitle>
            <DialogDescription>
              Код — для приёмки и алиасов. Реквизиты и адреса — для документов и связи с поставщиком.
            </DialogDescription>
          </DialogHeader>

          {error && dialogOpen ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          ) : null}

          <div className="grid gap-5">
            <div className="grid gap-3">
              <SectionTitle>Основное</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {!editing ? (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Код</label>
                    <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="IP_SUKHOTSKY" className="rounded-xl font-mono" />
                  </div>
                ) : null}
                <div className={`space-y-1.5 ${editing ? "sm:col-span-2" : ""}`}>
                  <label className="text-sm font-medium">Краткое наименование</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ИП Сухотский" className="rounded-xl" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium">Полное наименование</label>
                  <Input
                    value={meta.legalName ?? ""}
                    onChange={(e) => setMeta((m) => ({ ...m, legalName: e.target.value }))}
                    placeholder="Индивидуальный предприниматель Сухотский …"
                    className="rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <SectionTitle>Реквизиты</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">ИНН</label>
                  <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="7700000000" className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">КПП</label>
                  <Input value={meta.kpp ?? ""} onChange={(e) => setMeta((m) => ({ ...m, kpp: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">ОГРН / ОГРНИП</label>
                  <Input value={meta.ogrn ?? ""} onChange={(e) => setMeta((m) => ({ ...m, ogrn: e.target.value }))} className="rounded-xl" />
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <SectionTitle>Адреса</SectionTitle>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Юридический адрес</label>
                  <Textarea
                    value={meta.addresses?.legal ?? ""}
                    onChange={(e) => setAddress("legal", e.target.value)}
                    rows={2}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Фактический адрес / склад поставщика</label>
                  <Textarea
                    value={meta.addresses?.actual ?? ""}
                    onChange={(e) => setAddress("actual", e.target.value)}
                    rows={2}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Адрес доставки на наш склад</label>
                  <Textarea
                    value={meta.addresses?.delivery ?? ""}
                    onChange={(e) => setAddress("delivery", e.target.value)}
                    rows={2}
                    className="rounded-xl"
                    placeholder="Куда привозят материалы"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Почтовый адрес</label>
                  <Textarea
                    value={meta.addresses?.postal ?? ""}
                    onChange={(e) => setAddress("postal", e.target.value)}
                    rows={2}
                    className="rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <SectionTitle>Контакты</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Контактное лицо</label>
                  <Input
                    value={meta.contactPerson ?? ""}
                    onChange={(e) => setMeta((m) => ({ ...m, contactPerson: e.target.value }))}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Телефон</label>
                  <Input value={meta.phone ?? ""} onChange={(e) => setMeta((m) => ({ ...m, phone: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">E-mail</label>
                  <Input
                    value={meta.email ?? ""}
                    onChange={(e) => setMeta((m) => ({ ...m, email: e.target.value }))}
                    type="email"
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Сайт</label>
                  <Input value={meta.website ?? ""} onChange={(e) => setMeta((m) => ({ ...m, website: e.target.value }))} className="rounded-xl" />
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <SectionTitle>Банковские реквизиты</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium">Банк</label>
                  <Input value={meta.bankName ?? ""} onChange={(e) => setMeta((m) => ({ ...m, bankName: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">БИК</label>
                  <Input value={meta.bankBik ?? ""} onChange={(e) => setMeta((m) => ({ ...m, bankBik: e.target.value }))} className="rounded-xl font-mono" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Расчётный счёт</label>
                  <Input
                    value={meta.bankAccount ?? ""}
                    onChange={(e) => setMeta((m) => ({ ...m, bankAccount: e.target.value }))}
                    className="rounded-xl font-mono"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-sm font-medium">Корр. счёт</label>
                  <Input
                    value={meta.corrAccount ?? ""}
                    onChange={(e) => setMeta((m) => ({ ...m, corrAccount: e.target.value }))}
                    className="rounded-xl font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <SectionTitle>Примечание</SectionTitle>
              <Textarea
                value={meta.note ?? ""}
                onChange={(e) => setMeta((m) => ({ ...m, note: e.target.value }))}
                rows={3}
                className="rounded-xl"
                placeholder="Условия поставки, график, особенности…"
              />
            </div>

            <div className="grid gap-3">
              <SectionTitle>Договоры</SectionTitle>
              <SettingsSupplierContractsPanel supplierCode={editing?.code ?? null} />
            </div>

            {editing ? (
              <div className="flex items-center justify-between rounded-xl border px-3 py-2">
                <span className="text-sm">Активен</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button className="rounded-xl" disabled={saving} onClick={() => void submitDialog()}>
              {saving ? "Сохраняю..." : editing ? "Сохранить" : "Сохранить и добавить договоры"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
