"use client"

import { useCallback, useState } from "react"
import { AlertCircle, ClipboardCopy, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type WmsStickyAlertProps = {
  message: string
  title?: string
  onDismiss?: () => void
  className?: string
}

export function WmsStickyAlert({
  message,
  title = "Ошибка",
  onDismiss,
  className,
}: WmsStickyAlertProps) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }, [message])

  if (!message.trim()) return null

  return (
    <Alert
      variant="destructive"
      className={cn(
        "sticky top-[4.25rem] z-20 rounded-xl border-destructive/40 bg-destructive/10 shadow-md",
        className
      )}
    >
      <AlertCircle />
      <AlertTitle className="flex items-center justify-between gap-2 pr-1">
        <span>{title}</span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-lg px-2 text-xs text-destructive hover:bg-destructive/15 hover:text-destructive"
            onClick={() => void copy()}
          >
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" />
            {copied ? "Скопировано" : "Копировать"}
          </Button>
          {onDismiss ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-destructive hover:bg-destructive/15 hover:text-destructive"
              aria-label="Закрыть"
              onClick={onDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </span>
      </AlertTitle>
      <AlertDescription className="whitespace-pre-wrap break-words text-destructive/95">
        {message}
      </AlertDescription>
    </Alert>
  )
}
