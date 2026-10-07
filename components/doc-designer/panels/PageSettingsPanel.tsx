"use client"

import { RectangleHorizontal, RectangleVertical } from "lucide-react"
import { FONT_FAMILIES, PAGE_FORMATS, normalizePage, pageSizeMm, type PageFormat, type PageSettings } from "@/lib/doc-templates/page"
import { Field, NativeSelect, NumberInput, Section, Segmented } from "./fields"

/** Параметры листа: формат, ориентация, поля, шрифт по умолчанию, фон. Хранятся в мм. */
export function PageSettingsPanel({ page, onChange, designPages }: { page: PageSettings; onChange: (p: PageSettings) => void; designPages: number }) {
  const set = (patch: Partial<PageSettings>) => onChange(normalizePage({ ...page, ...patch }))
  const size = pageSizeMm(page)
  return (
    <>
      <Section title="Лист">
        <Field label="Формат">
          <NativeSelect<PageFormat>
            value={page.format}
            onChange={(format) => set({ format })}
            options={[
              ...Object.entries(PAGE_FORMATS).map(([id, f]) => ({ value: id as PageFormat, label: f.label })),
              { value: "Custom", label: "Свой размер" },
            ]}
          />
        </Field>
        {page.format === "Custom" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ширина">
              <NumberInput value={page.widthMm} min={30} max={1200} suffix="мм" onCommit={(widthMm) => set({ widthMm })} />
            </Field>
            <Field label="Высота">
              <NumberInput value={page.heightMm} min={30} max={1200} suffix="мм" onCommit={(heightMm) => set({ heightMm })} />
            </Field>
          </div>
        )}
        <Field label="Ориентация">
          <Segmented
            value={page.orientation}
            onChange={(orientation) => set({ orientation })}
            options={[
              { value: "portrait", label: <span className="flex items-center gap-1"><RectangleVertical className="size-3.5" /> Книжная</span> },
              { value: "landscape", label: <span className="flex items-center gap-1"><RectangleHorizontal className="size-3.5" /> Альбомная</span> },
            ]}
          />
        </Field>
        <div className="text-[10.5px] text-slate-400">
          {Math.round(size.width * 10) / 10} × {Math.round(size.height * 10) / 10} мм · страниц дизайна: {designPages}. Длинные таблицы при печати
          продолжатся на новых листах PDF.
        </div>
      </Section>
      <Section title="Поля страницы">
        <div className="grid grid-cols-2 gap-2">
          {(["top", "bottom", "left", "right"] as const).map((k) => (
            <Field key={k} label={{ top: "Сверху", bottom: "Снизу", left: "Слева", right: "Справа" }[k]}>
              <NumberInput value={page.margins[k]} min={0} max={100} step={1} suffix="мм" onCommit={(v) => set({ margins: { ...page.margins, [k]: v } })} />
            </Field>
          ))}
        </div>
      </Section>
      <Section title="Шрифт по умолчанию">
        <Field label="Гарнитура">
          <NativeSelect value={page.font.family} onChange={(family) => set({ font: { ...page.font, family } })} options={FONT_FAMILIES.map((f) => ({ value: f.id, label: f.label }))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Размер">
            <NumberInput value={page.font.sizePt} min={5} max={36} step={0.5} suffix="pt" onCommit={(sizePt) => set({ font: { ...page.font, sizePt } })} />
          </Field>
          <Field label="Межстрочный">
            <NumberInput value={page.font.lineHeight} min={0.8} max={3} step={0.05} onCommit={(lineHeight) => set({ font: { ...page.font, lineHeight } })} />
          </Field>
          <Field label="Цвет текста">
            <input type="color" className="h-8 w-full cursor-pointer rounded-md border border-slate-200 bg-white p-0.5" value={page.font.color} onChange={(e) => set({ font: { ...page.font, color: e.target.value } })} />
          </Field>
          <Field label="Фон листа">
            <input type="color" className="h-8 w-full cursor-pointer rounded-md border border-slate-200 bg-white p-0.5" value={page.background} onChange={(e) => set({ background: e.target.value })} />
          </Field>
        </div>
      </Section>
    </>
  )
}
