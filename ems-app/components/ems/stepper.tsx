import { Check } from "lucide-react"
import { cn } from "@/lib/client/cn"

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-5 flex gap-1 overflow-x-auto pb-1" aria-label="Шаги">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined} className={cn("flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", i === current ? "border-primary bg-primary/15 font-semibold" : i < current ? "border-border bg-card text-muted-foreground" : "border-dashed border-border text-muted-foreground")}>
          <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px]", i < current ? "bg-emerald-600 text-white" : i === current ? "bg-primary text-primary-foreground" : "bg-muted")}>{i < current ? <Check className="size-3" /> : i + 1}</span>
          <span className="whitespace-nowrap">{s}</span>
        </li>
      ))}
    </ol>
  )
}
