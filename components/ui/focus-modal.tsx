"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export function FocusModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  widthClassName = "max-w-3xl",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  widthClassName?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-modal-title"
        className={`bg-background border-border flex max-h-[min(92vh,900px)] w-full ${widthClassName} flex-col overflow-hidden rounded-xl border shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-border flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id="focus-modal-title" className="text-base font-semibold leading-tight">
              {title}
            </h2>
            {description ? (
              <p className="text-muted-foreground mt-1 text-sm">{description}</p>
            ) : null}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? (
          <div className="border-border bg-background/95 shrink-0 border-t px-5 py-4 backdrop-blur-sm">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
