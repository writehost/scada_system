"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Crumb = { href: string; label: string; isCurrent?: boolean };

function decodeSeg(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function buildCrumbs(pathname: string): Crumb[] {
  const p = pathname || "/";
  if (p === "/") return [{ href: "/", label: "Реестр кодов", isCurrent: true }];
  if (p === "/universal")
    return [{ href: "/universal", label: "Универсальный реестр", isCurrent: true }];

  if (p === "/marking") return [{ href: "/marking", label: "Маркировка", isCurrent: true }];

  if (p.startsWith("/wms")) {
    const segs = p.split("/").filter(Boolean);
    const crumbs: Crumb[] = [{ href: "/wms", label: "WMS" }];

    if (segs.length === 1) return [{ href: "/wms", label: "WMS", isCurrent: true }];

    const section = segs[1] ?? "";
    const rest = segs.slice(2);
    const add = (href: string, label: string) => crumbs.push({ href, label });

    switch (section) {
      case "lookup":
        add("/wms/lookup", "Поиск");
        break;
      case "data":
        add("/wms/data", "Данные");
        break;
      case "receiving":
        add("/wms/receiving", "Приёмка");
        break;
      case "transfer":
        add("/wms/transfer", "Перемещение");
        break;
      case "return":
        add("/wms/return", "Возврат");
        break;
      case "revision":
        add("/wms/revision", "Ревизия");
        break;
      case "tasks":
        add("/wms/tasks", "Задания");
        if (rest[0]) add(`/wms/tasks/${rest[0]}`, decodeSeg(rest[0]));
        break;
      case "devices":
        add("/wms/devices", "Терминалы");
        break;
      case "virtual":
        add("/wms/virtual", "Виртуальный склад");
        if (rest[0] === "editor") add("/wms/virtual/editor", "Редактор");
        break;
      case "documents":
        add("/wms/documents", "Документы");
        if (rest[0]) add(`/wms/documents/${rest[0]}`, decodeSeg(rest[0]));
        break;
      case "items":
        add("/wms/items", "Номенклатура");
        if (rest[0]) add(`/wms/items/${rest[0]}`, decodeSeg(rest[0]));
        break;
      case "locations":
        // /wms/locations/[code]
        if (rest[0]) {
          add(`/wms/locations/${rest[0]}`, `Ячейка ${decodeSeg(rest[0])}`);
        } else {
          add("/wms/lookup", "Ячейки");
        }
        break;
      default:
        add(p, decodeSeg(section));
    }

    // mark last as current
    const last = crumbs[crumbs.length - 1];
    last.isCurrent = true;
    return crumbs;
  }

  return [{ href: p, label: p, isCurrent: true }];
}

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/";
  const crumbs = React.useMemo(() => buildCrumbs(pathname), [pathname]);

  if (crumbs.length <= 1) return null;

  return (
    <nav className={cn("text-muted-foreground flex flex-wrap items-center gap-1 text-xs", className)}>
      {crumbs.map((c, idx) => {
        const isLast = idx === crumbs.length - 1;
        return (
          <React.Fragment key={`${c.href}-${idx}`}>
            {idx > 0 ? <span className="opacity-60">/</span> : null}
            {isLast || c.isCurrent ? (
              <span className="text-foreground font-medium">{c.label}</span>
            ) : (
              <Link href={c.href} className="hover:text-foreground hover:underline underline-offset-4">
                {c.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

