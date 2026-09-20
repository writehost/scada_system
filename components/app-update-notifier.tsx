"use client"

import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useWmsUpdateContext } from "@/components/wms-update-provider"

/**
 * Модалка только на время установки. Проверка и запуск — в Настройки → Обновления.
 * Больше не всплывает поверх всех страниц.
 */
export function AppUpdateNotifier() {
  const { isAdmin, release, applying, statusText, error, applyUpdate } = useWmsUpdateContext()

  if (!isAdmin || !applying) return null

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Установка обновления WMS</DialogTitle>
          <DialogDescription>
            {release ? (
              <>
                Версия <span className="font-medium text-foreground">{release.version}</span>
                {" · "}
                сборка <span className="font-mono text-xs">{release.buildId}</span>
              </>
            ) : (
              "Не закрывайте вкладку, пока сервер ставит сборку."
            )}
          </DialogDescription>
        </DialogHeader>
        {statusText ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {statusText}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {error ? (
            <Button type="button" onClick={() => void applyUpdate()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Повторить
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
