"use client";

import * as React from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { WmsDisposition, WmsStockSnapshot } from "@/lib/wms/types";
import { Breadcrumbs } from "@/components/nav/breadcrumbs";

export function WmsPageShell({
  title,
  description,
  actions,
  children,
  variant = "default",
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Редактор: без лишних отступов, контент на всю высоту области main (3D, панели). */
  variant?: "default" | "editor";
}) {
  if (variant === "editor") {
    return (
      <div className="bg-background flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        <header className="border-border bg-muted/20 flex shrink-0 flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <Breadcrumbs className="mb-1" />
            <h2 className="text-foreground truncate text-lg font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="text-muted-foreground mt-0.5 max-w-3xl text-sm leading-snug">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="bg-muted/15 h-full overflow-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <Breadcrumbs className="mb-1" />
            <h2 className="text-foreground text-xl font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function WmsQuickLink({
  href,
  label,
  description,
  icon,
  ctaLabel = "Открыть",
}: {
  href: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  ctaLabel?: string;
}) {
  return (
    <Card size="sm" className="ring-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          {label}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex justify-end">
          <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {ctaLabel}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function WmsSiteCodeField({
  value,
  onChange,
  id = "wms-site-code",
  inputClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  inputClassName?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-muted-foreground text-[10px] uppercase">
        Площадка
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="DEFAULT"
        className={cn("w-[180px]", inputClassName)}
      />
    </div>
  );
}

export function WmsDispositionBadge({
  disposition,
}: {
  disposition: WmsDisposition;
}) {
  const variant =
    disposition === "applied"
      ? "default"
      : disposition === "duplicate"
        ? "secondary"
        : disposition === "failed"
          ? "destructive"
          : "outline";
  return <Badge variant={variant}>{disposition}</Badge>;
}

export function WmsStockSnapshotCard({
  stock,
}: {
  stock: WmsStockSnapshot | null | undefined;
}) {
  if (!stock) return null;
  const metrics = [
    ["Available", stock.availableQty],
    ["Reserved", stock.reservedQty],
    ["In production", stock.inProductionQty],
    ["Quarantine", stock.quarantineQty],
    ["Rejected", stock.rejectedQty],
  ];
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Снимок остатка</CardTitle>
        <CardDescription>
          {stock.locationCode} · status {stock.locationStatus} · accuracy{" "}
          {stock.accuracyStatus}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, value]) => (
          <div key={label as string} className="rounded-lg border bg-background p-3">
            <div className="text-muted-foreground text-[11px] uppercase">
              {label}
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight">{value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function WmsEmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="border-dashed bg-muted/10">
      <CardHeader className="items-center text-center">
        <div className="bg-muted text-muted-foreground mb-2 flex size-10 items-center justify-center rounded-xl">
          {icon ?? <Inbox className="size-5" aria-hidden />}
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="max-w-md leading-relaxed">{description}</CardDescription>
      </CardHeader>
      {action ? <CardContent className="flex justify-center pt-0">{action}</CardContent> : null}
    </Card>
  );
}

export function WmsTableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2 p-4", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((__, col) => (
            <Skeleton key={col} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ))}
      <p className="sr-only">Загрузка данных…</p>
    </div>
  );
}

export function WmsTableLoadingOverlay({
  label = "Загрузка данных…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-card/80 backdrop-blur-[1px]",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card px-4 py-2.5 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
        {label}
      </div>
    </div>
  );
}

export function WmsLoadingState({
  label = "Данные загружаются…",
  hint = "Подождите, получаем актуальную информацию",
  className,
}: {
  label?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("border-dashed bg-muted/10", className)}>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint ? <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function WmsErrorState({
  title = "Не удалось загрузить данные",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card className={cn("border-destructive/40 bg-destructive/5", className)}>
      <CardHeader>
        <CardTitle className="text-destructive">{title}</CardTitle>
        <CardDescription className="text-destructive/90">{message}</CardDescription>
      </CardHeader>
      {onRetry ? (
        <CardContent className="pt-0">
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Повторить
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function WmsSectionShell({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function WmsConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            {loading ? "…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
