"use client"

/**
 * Календарь занимает весь экран под шапкой: своя высота вместо потока страницы,
 * отступы уже дашбордных, чтобы под сетку оставалось максимум места.
 */
export default function ProductionCalendarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-6 flex h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] flex-col overflow-hidden px-3 pb-2 pt-2 sm:px-4">
      {children}
    </div>
  )
}
