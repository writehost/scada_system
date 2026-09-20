"use client";

import * as React from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getDefaultWmsSiteCode } from "@/lib/wms/client";
import { Button } from "@/components/ui/button";
import { FocusModal } from "@/components/ui/focus-modal";
import { WmsItemCreateForm } from "@/components/wms/wms-item-create-form";
import { toast } from "sonner";

function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

export function WmsQtyField({
  label = "Количество",
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-[10px] uppercase">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="Например: 12.5"
      />
    </div>
  );
}

export function WmsTextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-[10px] uppercase">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

type ItemSuggestion = {
  itemCode: string;
  name: string;
  uomCode?: string | null;
  availableQty?: number | null;
};

async function quickImport(siteCode: string, kind: string, rows: unknown[]) {
  const res = await fetch("/api/wms/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteCode, kind, rows }),
  });
  const data = (await res.json()) as { error?: string; inserted?: number; updated?: number };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Кнопка + модалка полной формы номенклатуры (для шапок экранов и пикеров). */
export function WmsCreateNomenclatureButton({
  siteCode,
  initialItemCode = "",
  onCreated,
  size = "sm",
  variant = "outline",
}: {
  siteCode: string;
  initialItemCode?: string;
  onCreated: (itemCode: string) => void;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const [open, setOpen] = React.useState(false);
  const formId = React.useId();

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        Создать номенклатуру
      </Button>
      <FocusModal
        open={open}
        onOpenChange={setOpen}
        title="Новая номенклатура"
        description="Код и название обязательны. Остальное можно заполнить позже."
        widthClassName="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" form={formId}>
              Создать
            </Button>
          </div>
        }
      >
        <WmsItemCreateForm
          siteCode={siteCode}
          initialItemCode={initialItemCode}
          variant="quick"
          formId={formId}
          hideSubmitButton
          submitLabel="Создать"
          onCreated={(createdCode) => {
            onCreated(createdCode);
            setOpen(false);
          }}
        />
      </FocusModal>
    </>
  );
}

function InlineCreateItem({
  siteCode,
  initialItemCode,
  onCreated,
}: {
  siteCode: string;
  initialItemCode: string;
  onCreated: (itemCode: string) => void;
}) {
  return (
    <div className="mt-1">
      <WmsCreateNomenclatureButton siteCode={siteCode} initialItemCode={initialItemCode} onCreated={onCreated} />
    </div>
  );
}

function InlineCreateLocation({
  siteCode,
  initialLocationCode,
  onCreated,
}: {
  siteCode: string;
  initialLocationCode: string;
  onCreated: (locationCode: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [warehouseName, setWarehouseName] = React.useState("");
  const [storageType, setStorageType] = React.useState("");
  const [rack, setRack] = React.useState("");
  const [shelf, setShelf] = React.useState("");
  const [section, setSection] = React.useState("");
  const [locationCode, setLocationCode] = React.useState(initialLocationCode);
  const [displayName, setDisplayName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLocationCode(initialLocationCode);
  }, [initialLocationCode, open]);

  function slugify(value: string, fallback: string) {
    const normalized = value
      .trim()
      .toUpperCase()
      .replace(/[^A-ZА-Я0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || fallback;
  }

  const warehouseCode = React.useMemo(
    () => slugify(warehouseName, "WH"),
    [warehouseName]
  );
  const zoneCode = React.useMemo(
    () => [storageType, rack].map((part) => slugify(part, "")).filter(Boolean).join("-") || "ZONE",
    [storageType, rack]
  );
  const suggestedLocationCode = React.useMemo(() => {
    const parts = [
      slugify(warehouseName, "WH"),
      slugify(storageType, "STORAGE"),
      slugify(rack, "RACK"),
      slugify(shelf, "SHELF"),
      slugify(section, "SECTION"),
      slugify(locationCode, "CELL"),
    ].filter(Boolean);
    return parts.join("-");
  }, [warehouseName, storageType, rack, shelf, section, locationCode]);

  const suggestedDisplayName = React.useMemo(() => {
    const parts = [
      warehouseName.trim(),
      storageType.trim(),
      rack.trim(),
      shelf.trim(),
      section.trim(),
      locationCode.trim(),
    ].filter(Boolean);
    return parts.join(" / ");
  }, [warehouseName, storageType, rack, shelf, section, locationCode]);

  async function submit() {
    if (
      !warehouseName.trim() ||
      !storageType.trim() ||
      !rack.trim() ||
      !shelf.trim() ||
      !locationCode.trim()
    ) {
      toast.error("Заполните склад, тип места хранения, стеллаж, полку и ячейку");
      return;
    }
    setBusy(true);
    try {
      await quickImport(siteCode, "locations", [
        {
          warehouseCode,
          warehouseName: warehouseName.trim(),
          zoneCode,
          zoneName: [storageType.trim(), rack.trim()].filter(Boolean).join(" / "),
          locationCode: suggestedLocationCode,
          displayName: displayName.trim() || suggestedDisplayName || suggestedLocationCode,
          locationStatusCode: "active",
          accuracyStatusCode: "unknown",
        },
      ]);
      toast.success("Ячейка создана");
      onCreated(suggestedLocationCode);
      setOpen(false);
      setWarehouseName("");
      setStorageType("");
      setRack("");
      setShelf("");
      setSection("");
      setLocationCode(initialLocationCode);
      setDisplayName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка создания");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Создать ячейку
      </Button>
      <FocusModal
        open={open}
        onOpenChange={setOpen}
        title="Новая ячейка"
        description="Создание адреса вынесено в отдельное окно, чтобы не раздвигать таблицы и формы заданий."
      >
        <div className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <div className="text-muted-foreground text-[10px] uppercase">Склад</div>
            <Input
              value={warehouseName}
              onChange={(e) => setWarehouseName(e.target.value)}
              placeholder="Склад готовой продукции"
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-muted-foreground text-[10px] uppercase">Тип места хранения</div>
            <Input
              value={storageType}
              onChange={(e) => setStorageType(e.target.value)}
              placeholder="Стеллаж / напольное хранение / холодильник"
            />
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] uppercase">Стеллаж / место</div>
            <Input
              value={rack}
              onChange={(e) => setRack(e.target.value)}
              placeholder="Стеллаж 1"
            />
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] uppercase">Полка / ярус</div>
            <Input
              value={shelf}
              onChange={(e) => setShelf(e.target.value)}
              placeholder="Полка 4"
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-muted-foreground text-[10px] uppercase">Секция</div>
            <Input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="ZIP для аппликатора"
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-muted-foreground text-[10px] uppercase">Ячейка / тара</div>
            <Input
              value={locationCode}
              onChange={(e) => setLocationCode(e.target.value)}
              placeholder="Короб 0.33 л / Бочка 200 л"
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-muted-foreground text-[10px] uppercase">Название (если нужно)</div>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Склад готовой продукции / Стеллаж 1 / Полка 4 / ZIP / Короб 0.33 л"
            />
          </div>
          <div className="md:col-span-6 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="font-medium">Будет создано</div>
            <div className="mt-1">Склад: {warehouseName.trim() || "—"} ({warehouseCode})</div>
            <div>
              Зона: {[storageType.trim(), rack.trim()].filter(Boolean).join(" / ") || "—"} ({zoneCode})
            </div>
            <div>Адрес: {suggestedDisplayName || "—"}</div>
            <div className="font-mono text-xs">Код: {suggestedLocationCode}</div>
          </div>
          <div className="md:col-span-6 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void submit()} disabled={busy}>
              {busy ? "Создаём..." : "Создать"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </Button>
          </div>
        </div>
      </FocusModal>
    </div>
  );
}

export function WmsItemCodeInput({
  siteCode,
  value,
  onChange,
  placeholder = "Код товара…",
  onCreated,
}: {
  siteCode?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onCreated: (itemCode: string) => void;
}) {
  const sc = (siteCode?.trim() || getDefaultWmsSiteCode()).trim();
  const [suggestions, setSuggestions] = React.useState<ItemSuggestion[]>([]);
  const q = useDebounced(value.trim(), 250);

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      if (q.length < 1) {
        setSuggestions([]);
        return;
      }
      try {
        const qp = new URLSearchParams();
        qp.set("siteCode", sc);
        qp.set("query", q);
        qp.set("limit", "20");
        const res = await fetch(`/api/wms/items?${qp.toString()}`, { cache: "no-store" });
        const data = (await res.json()) as {
          items?: Array<{
            itemCode: string;
            name: string;
            uomCode?: string | null;
            availableQty?: number | null;
          }>;
        };
        if (cancelled) return;
        setSuggestions(
          (data.items ?? []).map((it) => ({
            itemCode: it.itemCode,
            name: it.name,
            uomCode: it.uomCode ?? null,
            availableQty: it.availableQty ?? null,
          }))
        );
      } catch {
        if (cancelled) return;
        setSuggestions([]);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [q, sc]);

  const datalistId = React.useId();
  const match = React.useMemo(() => {
    const code = value.trim().toLowerCase();
    if (!code) return null;
    return (
      suggestions.find((s) => s.itemCode.toLowerCase() === code) ??
      suggestions.find((s) => s.itemCode.toLowerCase().startsWith(code)) ??
      null
    );
  }, [suggestions, value]);

  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={datalistId}
        className="font-mono text-xs"
      />
      <datalist id={datalistId}>
        {suggestions.map((s) => (
          <option key={s.itemCode} value={s.itemCode}>
            {s.itemCode} · {s.name}
            {s.availableQty != null ? ` · доступно ${s.availableQty}` : ""}
            {s.uomCode ? ` ${s.uomCode}` : ""}
          </option>
        ))}
      </datalist>
      {match ? (
        <div className="text-muted-foreground mt-1 text-xs">
          {match.name}
          {match.availableQty != null ? ` · доступно ${match.availableQty}` : ""}
          {match.uomCode ? ` ${match.uomCode}` : ""}
        </div>
      ) : value.trim().length > 0 && suggestions.length === 0 ? (
        <div className="text-muted-foreground mt-1 text-xs">
          Не найдено.
          <InlineCreateItem
            siteCode={sc}
            initialItemCode={value.trim()}
            onCreated={onCreated}
          />
        </div>
      ) : null}
    </>
  );
}

export function WmsItemPicker({
  siteCode,
  label = "Товар/ресурс",
  value,
  onChange,
}: {
  siteCode?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-[10px] uppercase">{label}</Label>
      <WmsItemCodeInput
        siteCode={siteCode}
        value={value}
        onChange={onChange}
        placeholder="Начните вводить код или название…"
        onCreated={onChange}
      />
    </div>
  );
}

type LocationSuggestion = {
  locationCode: string;
  displayName: string;
  warehouseCode: string;
  zoneCode: string;
  locationStatus?: string | null;
  availableQty?: number | null;
  skuCount?: number | null;
};

export function WmsLocationPicker({
  siteCode,
  label,
  value,
  onChange,
}: {
  siteCode?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const sc = (siteCode?.trim() || getDefaultWmsSiteCode()).trim();
  const [suggestions, setSuggestions] = React.useState<LocationSuggestion[]>([]);
  const q = useDebounced(value.trim(), 250);

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      if (q.length < 1) {
        setSuggestions([]);
        return;
      }
      try {
        const qp = new URLSearchParams();
        qp.set("siteCode", sc);
        qp.set("query", q);
        const res = await fetch(`/api/wms/locations?${qp.toString()}`, { cache: "no-store" });
        const data = (await res.json()) as {
          locations?: Array<{
            locationCode: string;
            displayName: string;
            warehouseCode: string;
            zoneCode: string;
            locationStatus?: string;
            availableQty?: number;
            skuCount?: number;
          }>;
        };
        if (cancelled) return;
        setSuggestions(
          (data.locations ?? []).slice(0, 30).map((l) => ({
            locationCode: l.locationCode,
            displayName: l.displayName,
            warehouseCode: l.warehouseCode,
            zoneCode: l.zoneCode,
            locationStatus: l.locationStatus ?? null,
            availableQty: l.availableQty ?? null,
            skuCount: l.skuCount ?? null,
          }))
        );
      } catch {
        if (cancelled) return;
        setSuggestions([]);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [q, sc]);

  const datalistId = React.useId();
  const match = React.useMemo(() => {
    const code = value.trim().toLowerCase();
    if (!code) return null;
    return (
      suggestions.find((s) => s.locationCode.toLowerCase() === code) ??
      suggestions.find((s) => s.locationCode.toLowerCase().startsWith(code)) ??
      null
    );
  }, [suggestions, value]);
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-[10px] uppercase">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Начните вводить адрес…"
        list={datalistId}
      />
      <datalist id={datalistId}>
        {suggestions.map((s) => (
          <option key={s.locationCode} value={s.locationCode}>
            {s.locationCode} · {s.warehouseCode}/{s.zoneCode} · {s.displayName}
            {s.locationStatus ? ` · ${s.locationStatus}` : ""}
            {s.availableQty != null ? ` · доступно ${s.availableQty}` : ""}
            {s.skuCount != null ? ` · SKU ${s.skuCount}` : ""}
          </option>
        ))}
      </datalist>
      {match ? (
        <div className="text-muted-foreground text-xs">
          {match.warehouseCode}/{match.zoneCode} · {match.displayName}
          {match.locationStatus ? ` · ${match.locationStatus}` : ""}
          {match.availableQty != null ? ` · доступно ${match.availableQty}` : ""}
          {match.skuCount != null ? ` · SKU ${match.skuCount}` : ""}
        </div>
      ) : value.trim().length > 0 && suggestions.length === 0 ? (
        <div className="text-muted-foreground text-xs">
          Не найдено.
          <InlineCreateLocation
            siteCode={sc}
            initialLocationCode={value.trim()}
            onCreated={onChange}
          />
        </div>
      ) : null}
    </div>
  );
}

