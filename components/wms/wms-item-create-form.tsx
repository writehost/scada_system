"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { extractItemImageUrl } from "@/lib/wms/item-image";
import { listDirectoryItemGroups, type ItemGroupDirectoryRow } from "@/lib/wms-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type WmsPackagingProfileCode = "water" | "stickers" | "custom";

export type WmsItemUpsertValues = {
  itemCode: string;
  name: string;
  barcode?: string | null;
  groupCode?: string | null;
  subgroup?: string | null;
  formatName?: string | null;
  packagingProfile?: WmsPackagingProfileCode | string | null;
  packagingNote?: string | null;
  resourceHint?: string | null;
  isPerishable?: boolean;
  shelfLifeDays?: number | string | null;
  expiryWarningDays?: number | string | null;
  rotationPolicy?: string | null;
  uomCode?: string | null;
  itemAttrs?: Record<string, unknown> | null;
};

async function postImport(siteCode: string, kind: string, rows: unknown[]) {
  const res = await fetch("/api/wms/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteCode, kind, rows }),
  });
  const data = (await res.json()) as { error?: string; inserted?: number; updated?: number };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function WmsItemCreateForm({
  siteCode,
  initialItemCode = "",
  submitLabel = "Создать номенклатуру",
  initialValues,
  lockItemCode = false,
  resetAfterSave = true,
  successMessage,
  onCreated,
  onSaved,
  variant = "full",
  formId,
  hideSubmitButton = false,
}: {
  siteCode: string;
  initialItemCode?: string;
  submitLabel?: string;
  initialValues?: WmsItemUpsertValues | null;
  lockItemCode?: boolean;
  resetAfterSave?: boolean;
  successMessage?: string;
  onCreated?: (itemCode: string) => void | Promise<void>;
  onSaved?: (itemCode: string) => void | Promise<void>;
  /** quick — компактная форма для модалки (основное + «доп. поля») */
  variant?: "full" | "quick";
  formId?: string;
  hideSubmitButton?: boolean;
}) {
  const [itemCode, setItemCode] = React.useState(initialValues?.itemCode ?? initialItemCode);
  const [name, setName] = React.useState(initialValues?.name ?? "");
  const [barcode, setBarcode] = React.useState(initialValues?.barcode ?? "");
  const [groupCode, setGroupCode] = React.useState(initialValues?.groupCode ?? "");
  const [subgroup, setSubgroup] = React.useState(initialValues?.subgroup ?? "");
  const [formatName, setFormatName] = React.useState(initialValues?.formatName ?? "");
  const [packagingProfile, setPackagingProfile] =
    React.useState<WmsPackagingProfileCode>(
      initialValues?.packagingProfile === "water" || initialValues?.packagingProfile === "stickers"
        ? initialValues.packagingProfile
        : "custom"
    );
  const [packagingNote, setPackagingNote] = React.useState(initialValues?.packagingNote ?? "");
  const [resourceHint, setResourceHint] = React.useState(initialValues?.resourceHint ?? "");
  const [mergeLots, setMergeLots] = React.useState(
    (initialValues?.itemAttrs && typeof (initialValues.itemAttrs as Record<string, unknown>).mergeLots === "boolean"
      ? Boolean((initialValues.itemAttrs as Record<string, unknown>).mergeLots)
      : true) as boolean
  );
  const [isPerishable, setIsPerishable] = React.useState(Boolean(initialValues?.isPerishable));
  const [shelfLifeDays, setShelfLifeDays] = React.useState(
    initialValues?.shelfLifeDays == null ? "" : String(initialValues.shelfLifeDays)
  );
  const [expiryWarningDays, setExpiryWarningDays] = React.useState(
    initialValues?.expiryWarningDays == null ? "" : String(initialValues.expiryWarningDays)
  );
  const [unitVolumeL, setUnitVolumeL] = React.useState(() => {
    const a = initialValues?.itemAttrs as Record<string, unknown> | undefined;
    const v = a?.unitVolumeL;
    return v != null && v !== "" ? String(v) : "";
  });
  const [dimL, setDimL] = React.useState("");
  const [dimW, setDimW] = React.useState("");
  const [dimH, setDimH] = React.useState("");
  const [itemImageUrl, setItemImageUrl] = React.useState("");
  const [itemImageUploading, setItemImageUploading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [itemGroups, setItemGroups] = React.useState<ItemGroupDirectoryRow[]>([]);
  const [groupsLoading, setGroupsLoading] = React.useState(false);
  const [extendedOpen, setExtendedOpen] = React.useState(variant === "full");
  const isQuick = variant === "quick";

  React.useEffect(() => {
    let cancelled = false;
    setGroupsLoading(true);
    void listDirectoryItemGroups()
      .then((res) => {
        if (!cancelled) {
          setItemGroups((res.groups ?? []).filter((g) => g.isActive));
        }
      })
      .catch(() => {
        if (!cancelled) setItemGroups([]);
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    setItemCode(initialValues?.itemCode ?? initialItemCode);
    setName(initialValues?.name ?? "");
    setBarcode(initialValues?.barcode ?? "");
    setGroupCode(initialValues?.groupCode ?? "");
    setSubgroup(initialValues?.subgroup ?? "");
    setFormatName(initialValues?.formatName ?? "");
    setPackagingProfile(
      initialValues?.packagingProfile === "water" || initialValues?.packagingProfile === "stickers"
        ? initialValues.packagingProfile
        : "custom"
    );
    setPackagingNote(initialValues?.packagingNote ?? "");
    setResourceHint(initialValues?.resourceHint ?? "");
    setMergeLots(
      initialValues?.itemAttrs && typeof (initialValues.itemAttrs as Record<string, unknown>).mergeLots === "boolean"
        ? Boolean((initialValues.itemAttrs as Record<string, unknown>).mergeLots)
        : true
    );
    setIsPerishable(Boolean(initialValues?.isPerishable));
    setShelfLifeDays(initialValues?.shelfLifeDays == null ? "" : String(initialValues.shelfLifeDays));
    setExpiryWarningDays(
      initialValues?.expiryWarningDays == null ? "" : String(initialValues.expiryWarningDays)
    );
    const ia = initialValues?.itemAttrs as Record<string, unknown> | undefined;
    const uv = ia?.unitVolumeL;
    setUnitVolumeL(uv != null && uv !== "" ? String(uv) : "");
    const d = ia?.dimsMm as { l?: unknown; w?: unknown; h?: unknown } | undefined;
    if (d && typeof d === "object") {
      setDimL(d.l != null ? String(d.l) : "");
      setDimW(d.w != null ? String(d.w) : "");
      setDimH(d.h != null ? String(d.h) : "");
    } else {
      setDimL("");
      setDimW("");
      setDimH("");
    }
    setItemImageUrl(extractItemImageUrl(initialValues?.itemAttrs as Record<string, unknown> | undefined) ?? "");
  }, [initialItemCode, initialValues]);

  async function handlePickItemImage(file: File) {
    if (!itemCode.trim()) {
      toast.error("Сначала укажите код номенклатуры");
      return;
    }
    setItemImageUploading(true);
    try {
      const fd = new FormData();
      fd.set("siteCode", siteCode);
      fd.set("itemCode", itemCode.trim());
      fd.set("file", file);
      const res = await fetch("/api/wms/items/upload-image", { method: "POST", body: fd });
      const data = (await res.json()) as { imageUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.imageUrl) setItemImageUrl(data.imageUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить фото");
    } finally {
      setItemImageUploading(false);
    }
  }

  async function submit() {
    if (!itemCode.trim() || !name.trim()) {
      toast.error("Заполните код и название");
      return;
    }
    const baseUomCode =
      packagingProfile === "water"
        ? "bottle"
        : packagingProfile === "stickers"
          ? "roll"
          : initialValues?.uomCode?.trim() || "pcs";
    const mergedAttrs = { ...(initialValues?.itemAttrs ?? {}) };
    if (packagingNote.trim()) mergedAttrs.packagingNote = packagingNote.trim();
    else delete mergedAttrs.packagingNote;
    if (resourceHint.trim()) mergedAttrs.resourceHint = resourceHint.trim();
    else delete mergedAttrs.resourceHint;
    mergedAttrs.mergeLots = mergeLots;
    if (unitVolumeL.trim()) {
      const n = Number(unitVolumeL.trim().replace(",", "."));
      if (Number.isFinite(n) && n > 0) mergedAttrs.unitVolumeL = n;
      else delete mergedAttrs.unitVolumeL;
    } else {
      delete mergedAttrs.unitVolumeL;
    }
    if (dimL.trim() && dimW.trim() && dimH.trim()) {
      const l = Number(dimL.trim().replace(",", "."));
      const w = Number(dimW.trim().replace(",", "."));
      const h = Number(dimH.trim().replace(",", "."));
      if (Number.isFinite(l) && Number.isFinite(w) && Number.isFinite(h) && l > 0 && w > 0 && h > 0) {
        mergedAttrs.dimsMm = { l, w, h };
      } else {
        delete mergedAttrs.dimsMm;
      }
    } else {
      delete mergedAttrs.dimsMm;
    }
    if (itemImageUrl.trim()) mergedAttrs.imageUrl = itemImageUrl.trim();
    else delete mergedAttrs.imageUrl;
    const rotationPolicy = isPerishable
      ? "fefo"
      : initialValues?.rotationPolicy?.trim() === "manual"
        ? "manual"
        : "fifo";

    setBusy(true);
    try {
      await postImport(siteCode, "items", [
        {
          itemCode: itemCode.trim(),
          name: name.trim(),
          ...(groupCode.trim() ? { itemGroupCode: groupCode.trim() } : {}),
          ...(subgroup.trim() ? { itemClassCode: subgroup.trim() } : {}),
          ...(formatName.trim() ? { packagingFormat: formatName.trim(), nomenclature: formatName.trim() } : {}),
          packagingProfile,
          itemSubgroup: subgroup.trim() || undefined,
          itemAttrs: Object.keys(mergedAttrs).length > 0 ? mergedAttrs : undefined,
          uomCode: baseUomCode,
          materialType: subgroup.trim() || null,
          productGroup: groupCode.trim() || null,
          ...(barcode.trim() ? { primaryBarcode: barcode.trim() } : {}),
          isPerishable,
          rotationPolicy,
          ...(shelfLifeDays.trim() ? { shelfLifeDays: Number(shelfLifeDays) } : {}),
          ...(expiryWarningDays.trim()
            ? { expiryWarningDays: Number(expiryWarningDays) }
            : {}),
        },
      ]);

      if (packagingProfile !== "custom") {
        const uoms =
          packagingProfile === "water"
            ? [
                {
                  itemCode: itemCode.trim(),
                  uomCode: "bottle",
                  uomName: "Бутылка",
                  qtyInBase: 1,
                  levelNo: 10,
                  isBase: true,
                  isShipping: true,
                },
                {
                  itemCode: itemCode.trim(),
                  uomCode: "block",
                  uomName: "Блок",
                  qtyInBase: 6,
                  levelNo: 20,
                  isShipping: true,
                },
                {
                  itemCode: itemCode.trim(),
                  uomCode: "pallet",
                  uomName: "Палета",
                  qtyInBase: 630,
                  levelNo: 30,
                  isShipping: true,
                  maxPerLoadUnit: 1,
                },
              ]
            : [
                {
                  itemCode: itemCode.trim(),
                  uomCode: "roll",
                  uomName: "Рулон / смотка",
                  qtyInBase: 1,
                  levelNo: 10,
                  isBase: true,
                  isShipping: true,
                },
                {
                  itemCode: itemCode.trim(),
                  uomCode: "box",
                  uomName: "Коробка",
                  qtyInBase: 12,
                  levelNo: 20,
                  isShipping: true,
                },
                {
                  itemCode: itemCode.trim(),
                  uomCode: "pallet",
                  uomName: "Палета",
                  qtyInBase: 480,
                  levelNo: 30,
                  isShipping: true,
                  maxPerLoadUnit: 1,
                },
              ];
        await postImport(siteCode, "item_uoms", uoms);
      }

      toast.success(successMessage ?? (initialValues ? "Номенклатура сохранена" : "Номенклатура создана"));
      await onSaved?.(itemCode.trim());
      await onCreated?.(itemCode.trim());
      if (resetAfterSave) {
        setItemCode("");
        setName("");
        setBarcode("");
        setGroupCode("");
        setSubgroup("");
        setFormatName("");
        setPackagingProfile("custom");
        setPackagingNote("");
        setResourceHint("");
        setMergeLots(true);
        setIsPerishable(false);
        setShelfLifeDays("");
        setExpiryWarningDays("");
        setUnitVolumeL("");
        setDimL("");
        setDimW("");
        setDimH("");
        setItemImageUrl("");
      }
    } catch (e) {
      toast.error(wmsDbErrorToUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const fieldLabel = "text-muted-foreground mb-1 block text-[10px] font-medium uppercase tracking-wide";

  const extendedFields = (
    <>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/15 px-3 py-3">
        <div className={cn(fieldLabel, "w-full")}>Фото</div>
        {itemImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={itemImageUrl}
            alt=""
            className="border-border h-16 w-16 shrink-0 rounded-md border object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="cursor-pointer text-xs"
            disabled={busy || itemImageUploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handlePickItemImage(f);
            }}
          />
          <Input
            value={itemImageUrl}
            onChange={(e) => setItemImageUrl(e.target.value)}
            placeholder="или вставьте URL"
            className="font-mono text-xs"
          />
        </div>
        {itemImageUrl ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setItemImageUrl("")}>
            Убрать
          </Button>
        ) : null}
      </div>
      <div className="rounded-xl border border-dashed bg-muted/10 px-3 py-3">
        <div className="text-sm font-medium">Размещение (ВГХ) для рекомендаций адреса</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <div className={fieldLabel}>Объём 1 ед., л</div>
            <Input
              value={unitVolumeL}
              onChange={(e) => setUnitVolumeL(e.target.value)}
              inputMode="decimal"
              placeholder="0.04"
              className="font-mono text-xs"
            />
          </div>
          <div className="min-w-0">
            <div className={fieldLabel}>Длина мм</div>
            <Input value={dimL} onChange={(e) => setDimL(e.target.value)} inputMode="numeric" className="font-mono text-xs" />
          </div>
          <div className="min-w-0">
            <div className={fieldLabel}>Ширина мм</div>
            <Input value={dimW} onChange={(e) => setDimW(e.target.value)} inputMode="numeric" className="font-mono text-xs" />
          </div>
          <div className="min-w-0">
            <div className={fieldLabel}>Высота мм</div>
            <Input value={dimH} onChange={(e) => setDimH(e.target.value)} inputMode="numeric" className="font-mono text-xs" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className={fieldLabel}>Комментарий по упаковке / размерам</div>
          <Textarea
            value={packagingNote}
            onChange={(e) => setPackagingNote(e.target.value)}
            placeholder="Например: блок 6 бутылок, палета 105 блоков."
            className="min-h-24"
          />
        </div>
        <div className="min-w-0">
          <div className={fieldLabel}>Какие ресурсы / расходники связаны</div>
          <Textarea
            value={resourceHint}
            onChange={(e) => setResourceHint(e.target.value)}
            placeholder="Крышка, этикетка, бутылка, стикер, коробка."
            className="min-h-24"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border p-3">
          <div className="text-sm font-medium">Сроки и FEFO</div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPerishable}
              onChange={(e) => setIsPerishable(e.target.checked)}
            />
            Скоропорт / нужен FEFO
          </label>
        </div>
        <div className="min-w-0">
          <div className={fieldLabel}>Срок хранения, дней</div>
          <Input
            value={shelfLifeDays}
            onChange={(e) => setShelfLifeDays(e.target.value)}
            inputMode="numeric"
            placeholder="365"
          />
        </div>
        <div className="min-w-0">
          <div className={fieldLabel}>Предупреждать за, дней</div>
          <Input
            value={expiryWarningDays}
            onChange={(e) => setExpiryWarningDays(e.target.value)}
            inputMode="numeric"
            placeholder="30"
          />
        </div>
      </div>
    </>
  );

  return (
    <form
      id={formId}
      className={cn("space-y-4", !isQuick && "md:grid md:grid-cols-6 md:gap-4 md:space-y-0")}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={cn(isQuick ? "grid gap-4 sm:grid-cols-2" : "contents")}>
        <div className={cn("min-w-0", !isQuick && "md:col-span-2")}>
          <label className={fieldLabel}>Код</label>
          <Input
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value)}
            className="h-10 font-mono text-sm"
            placeholder="WATER-15L-001"
            disabled={lockItemCode || busy}
          />
        </div>
        <div className={cn("min-w-0", !isQuick && "md:col-span-4", isQuick && "sm:col-span-1")}>
          <label className={fieldLabel}>Название</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10"
            placeholder="Славда Курортная 1.5 л"
          />
        </div>
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2.5",
          !isQuick && "md:col-span-6"
        )}
      >
        <Checkbox checked={mergeLots} onCheckedChange={(v) => setMergeLots(Boolean(v))} />
        <span className="text-sm font-medium">Объединять партии в номенклатуре</span>
      </div>

      <div className={cn(isQuick ? "grid gap-4 sm:grid-cols-3" : "contents")}>
        <div className={cn("min-w-0", !isQuick && "md:col-span-2")}>
          <label className={fieldLabel}>Группа товаров</label>
          {itemGroups.length > 0 ? (
            <Select
              value={groupCode || "__none__"}
              onValueChange={(v) => setGroupCode(v === "__none__" ? "" : v)}
              disabled={busy || groupsLoading}
            >
              <SelectTrigger className="h-10 w-full rounded-xl">
                <SelectValue placeholder={groupsLoading ? "Загрузка…" : "Группа"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— без группы —</SelectItem>
                {itemGroups.map((g) => (
                  <SelectItem key={g.code} value={g.code}>
                    {g.name} ({g.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              placeholder="probs"
              className="h-10 font-mono text-xs"
              disabled={busy}
            />
          )}
          {!isQuick ? (
            <p className="text-muted-foreground mt-1 text-[10px]">Настройки → Группы товаров и ЕИ</p>
          ) : null}
        </div>
        <div className={cn("min-w-0", !isQuick && "md:col-span-2")}>
          <label className={fieldLabel}>Подгруппа</label>
          <Input
            value={subgroup}
            onChange={(e) => setSubgroup(e.target.value)}
            className="h-10"
            placeholder="Напитки / этикетка"
          />
        </div>
        <div className={cn("min-w-0", !isQuick && "md:col-span-2")}>
          <label className={fieldLabel}>Тара / формат</label>
          <Input
            value={formatName}
            onChange={(e) => setFormatName(e.target.value)}
            className="h-10"
            placeholder="1.5 л / 0.5 л"
          />
        </div>
      </div>

      <div className={cn(isQuick ? "grid gap-4 sm:grid-cols-2" : "contents")}>
        <div className={cn("min-w-0", !isQuick && "md:col-span-2")}>
          <label className={fieldLabel}>Штрихкод</label>
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="h-10 font-mono text-xs"
            placeholder="4600000000000"
          />
        </div>
        <div className={cn("min-w-0", !isQuick && "md:col-span-4", isQuick && "sm:col-span-1")}>
          <label className={fieldLabel}>Профиль упаковки</label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              size="sm"
              className="h-9 justify-start rounded-lg text-left"
              variant={packagingProfile === "water" ? "default" : "outline"}
              onClick={() => setPackagingProfile("water")}
            >
              Вода: палета / блок / бутылка
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 justify-start rounded-lg text-left"
              variant={packagingProfile === "stickers" ? "default" : "outline"}
              onClick={() => setPackagingProfile("stickers")}
            >
              Стикеры: палета / коробка / рулон
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 justify-start rounded-lg text-left"
              variant={packagingProfile === "custom" ? "default" : "outline"}
              onClick={() => setPackagingProfile("custom")}
            >
              Заполню потом
            </Button>
          </div>
        </div>
      </div>

      {isQuick ? (
        <Collapsible open={extendedOpen} onOpenChange={setExtendedOpen} className="space-y-3">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" className="w-full justify-between rounded-xl">
              Дополнительные поля (фото, ВГХ, сроки)
              <ChevronDown className={cn("h-4 w-4 transition-transform", extendedOpen && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-1">{extendedFields}</CollapsibleContent>
        </Collapsible>
      ) : (
        extendedFields
      )}

      {!hideSubmitButton ? (
        <div className={cn("flex flex-wrap gap-2 pt-1", !isQuick && "md:col-span-6")}>
          <Button type="submit" disabled={busy}>
            {busy ? "Сохраняем..." : submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
