"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type MovementCellOption = {
  locationCode: string
  /** Вторая строка: склад, зона, профиль ячейки. */
  placement: string
  /** Правый край строки: остаток или иная короткая метка. */
  meta?: string | null
  /** Приглушённая пометка под названием, например «ещё 2 артикула». */
  note?: string | null
  disabled?: boolean
}

/**
 * Одно поле вместо связки «поиск + нативный select»: раньше оператор печатал в
 * одном контроле, а выбирал в другом, и длинные названия ячеек обрезались.
 */
export function MovementCellPicker({
  value,
  options,
  onChange,
  placeholder = "Выберите ячейку",
  searchPlaceholder = "Код ячейки, зона или склад",
  emptyLabel = "Ячейка не найдена",
  disabled,
  id,
}: {
  value: string
  options: MovementCellOption[]
  onChange: (locationCode: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyLabel?: string
  disabled?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = useMemo(
    () => options.find((o) => o.locationCode === value) ?? null,
    [options, value]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto w-full justify-between gap-2 rounded-lg px-3 py-2 text-left font-normal"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            {selected ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm font-semibold text-foreground">
                  {selected.locationCode}
                </span>
                {selected.placement ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {selected.placement}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="truncate text-sm text-muted-foreground">{placeholder}</span>
            )}
          </span>
          {selected?.meta ? (
            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {selected.meta}
            </span>
          ) : null}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(30rem,calc(100vw-2rem))] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command
          filter={(itemValue, search) => {
            if (!search.trim()) return 1
            return itemValue.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.locationCode}
                  value={`${opt.locationCode} ${opt.placement} ${opt.note ?? ""}`}
                  disabled={opt.disabled}
                  onSelect={() => {
                    onChange(opt.locationCode)
                    setOpen(false)
                  }}
                  className="items-start gap-2"
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      opt.locationCode === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm font-medium text-foreground">
                      {opt.locationCode}
                    </span>
                    {opt.placement ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {opt.placement}
                      </span>
                    ) : null}
                    {opt.note ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {opt.note}
                      </span>
                    ) : null}
                  </span>
                  {opt.meta ? (
                    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {opt.meta}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
