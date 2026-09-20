"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { TnvedNode } from "@/lib/tnved/catalog"

type Props = {
  value: string
  onChange: (code: string) => void
  disabled?: boolean
  className?: string
}

export function TnvedPicker({ value, onChange, disabled, className }: Props) {
  const [query, setQuery] = useState("")
  const [nodes, setNodes] = useState<TnvedNode[]>([])
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [openChapter, setOpenChapter] = useState<string | null>(null)
  const [sectionChapters, setSectionChapters] = useState<Record<string, TnvedNode[]>>({})
  const [chapterPositions, setChapterPositions] = useState<Record<string, TnvedNode[]>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (query.trim().length >= 2) {
      setLoading(true)
      fetch(`/api/wms/directories/tnved?query=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data: { nodes?: TnvedNode[] }) => setNodes(data.nodes ?? []))
        .catch(() => setNodes([]))
        .finally(() => setLoading(false))
      return
    }
    setLoading(true)
    fetch("/api/wms/directories/tnved")
      .then((r) => r.json())
      .then((data: { nodes?: TnvedNode[] }) => setNodes(data.nodes ?? []))
      .catch(() => setNodes([]))
      .finally(() => setLoading(false))
  }, [query])

  const isSearch = query.trim().length >= 2

  async function loadChildren(parent: string, cacheKey: "section" | "chapter") {
    const r = await fetch(`/api/wms/directories/tnved?parent=${encodeURIComponent(parent)}`)
    const data = (await r.json()) as { nodes?: TnvedNode[] }
    const list = data.nodes ?? []
    if (cacheKey === "section") {
      setSectionChapters((prev) => ({ ...prev, [parent]: list }))
    } else {
      setChapterPositions((prev) => ({ ...prev, [parent]: list }))
    }
    return list
  }

  async function toggleSection(sectionCode: string) {
    if (openSection === sectionCode) {
      setOpenSection(null)
      setOpenChapter(null)
      return
    }
    setOpenSection(sectionCode)
    setOpenChapter(null)
    if (!sectionChapters[sectionCode]) {
      await loadChildren(sectionCode, "section")
    }
  }

  async function toggleChapter(chapterCode: string) {
    if (openChapter === chapterCode) {
      setOpenChapter(null)
      return
    }
    setOpenChapter(chapterCode)
    if (!chapterPositions[chapterCode]) {
      await loadChildren(chapterCode, "chapter")
    }
  }

  const selectedLabel = useMemo(() => {
    if (!value.trim()) return null
    const hit = nodes.find((n) => value === n.code || value.startsWith(n.code))
    return hit ? `${value} · ${hit.name}` : value
  }, [value, nodes])

  function pickNode(n: TnvedNode) {
    if (n.level === "section") {
      onChange(n.codeFrom ?? n.code)
      return
    }
    onChange(n.code)
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Поиск: преформа, пробка, вода, 3923…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          className="h-9 rounded-lg pl-8 text-sm"
        />
      </div>
      <Input
        placeholder="Код ТН ВЭД (например 3923290000)"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        disabled={disabled}
        className="h-9 rounded-lg font-mono text-sm"
      />
      {selectedLabel ? (
        <p className="text-xs text-muted-foreground">Выбрано: {selectedLabel}</p>
      ) : null}
      <div className="max-h-48 overflow-y-auto rounded-lg border p-1 text-sm">
        {loading ? (
          <p className="p-2 text-xs text-muted-foreground">Загрузка…</p>
        ) : isSearch ? (
          nodes.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">Ничего не найдено — введите код вручную</p>
          ) : (
            nodes.map((n) => (
              <button
                key={`${n.level}-${n.code}-${n.parentCode ?? ""}`}
                type="button"
                disabled={disabled}
                className={cn(
                  "flex w-full rounded-md px-2 py-1.5 text-left hover:bg-secondary/60",
                  (value === n.code || value.startsWith(n.code)) && "bg-primary/10"
                )}
                onClick={() => pickNode(n)}
              >
                <span className="font-mono text-xs text-muted-foreground">{n.code}</span>
                <span className="ml-2 min-w-0 flex-1 leading-snug">{n.name}</span>
              </button>
            ))
          )
        ) : (
          nodes.map((section) => (
            <div key={section.code}>
              <button
                type="button"
                disabled={disabled}
                className="flex w-full items-start gap-1 rounded-md px-2 py-1.5 text-left hover:bg-secondary/60"
                onClick={() => void toggleSection(section.code)}
              >
                {openSection === section.code ? (
                  <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Раздел {section.code}</span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({section.codeFrom}
                    {section.codeTo && section.codeTo !== section.codeFrom ? `–${section.codeTo}` : ""})
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{section.name}</span>
                </span>
              </button>
              {openSection === section.code ? (
                <div className="ml-5 border-l border-border/60 pb-1 pl-2">
                  {(sectionChapters[section.code] ?? []).map((ch) => (
                    <div key={ch.code}>
                      <div className="flex items-start gap-0.5">
                        <button
                          type="button"
                          className="mt-1 rounded p-0.5 hover:bg-secondary/40"
                          onClick={() => void toggleChapter(ch.code)}
                          aria-label={`Раскрыть позиции главы ${ch.code}`}
                        >
                          {openChapter === ch.code ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "min-w-0 flex-1 rounded-md px-1 py-1 text-left text-xs hover:bg-secondary/40",
                            value.startsWith(ch.code) && "bg-primary/10"
                          )}
                          onClick={() => onChange(ch.code)}
                        >
                          <span className="font-mono">{ch.code}</span>
                          <span className="ml-2">{ch.name}</span>
                        </button>
                      </div>
                      {openChapter === ch.code ? (
                        <div className="ml-5 border-l border-border/40 pb-1 pl-2">
                          {(chapterPositions[ch.code] ?? []).length === 0 ? (
                            <p className="px-2 py-1 text-[10px] text-muted-foreground">
                              Позиции 4 знака не загружены — используйте главу {ch.code} или введите 10 цифр
                            </p>
                          ) : (
                            chapterPositions[ch.code].map((pos) => (
                              <button
                                key={pos.code}
                                type="button"
                                className={cn(
                                  "flex w-full rounded-md px-2 py-1 text-left text-[11px] hover:bg-secondary/40",
                                  value.startsWith(pos.code) && "bg-primary/10"
                                )}
                                onClick={() => onChange(pos.code)}
                              >
                                <span className="font-mono">{pos.code}</span>
                                <span className="ml-2 leading-snug">{pos.name}</span>
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
