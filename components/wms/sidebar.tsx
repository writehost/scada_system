"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import logoWmsScada from "../../logowmsscada.png"
import { getNavCounters } from "@/lib/wms-api"
import {
  LayoutDashboard,
  Package,
  Boxes,
  ArrowRightLeft,
  Search,
  ClipboardList,
  FileText,
  Database,
  Settings,
  ChevronLeft,
  Truck,
  RotateCcw,
  ClipboardCheck,
  Terminal,
  Tag,
  LayoutGrid,
  CalendarDays,
  Factory,
  Printer,
  ScanLine,
  HeartPulse,
  Bell,
  Route,
  MapPin,
  Shield,
} from "lucide-react"

const BADGE_CACHE_KEY = "wms_nav_counters"

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const navigation: NavGroup[] = [
  {
    title: "Главное",
    items: [
      { title: "Дашборд", href: "/", icon: LayoutDashboard },
      { title: "APS", href: "/production-calendar", icon: CalendarDays },
      { title: "Поиск", href: "/search", icon: Search },
    ],
  },
  {
    title: "Операции",
    items: [
      { title: "Приёмка", href: "/receiving", icon: Truck },
      { title: "Территория", href: "/yms", icon: MapPin },
      { title: "КПП", href: "/yms/gate", icon: Shield },
      { title: "Перемещение", href: "/movement", icon: ArrowRightLeft },
      { title: "Возврат", href: "/return", icon: RotateCcw },
      { title: "Ревизия", href: "/revision", icon: ClipboardCheck },
    ],
  },
  {
    title: "Склад",
    items: [
      { title: "Склад материалов", href: "/warehouse-stock/materials", icon: Boxes },
      { title: "Методы склада", href: "/warehouse-stock/ops", icon: Route },
      { title: "Цех", href: "/warehouse-stock/workshop", icon: Factory },
      { title: "Склад ГП", href: "/warehouse-stock/finished-goods", icon: Package },
      { title: "Заполненность", href: "/occupancy", icon: LayoutGrid },
      { title: "Ячейки", href: "/cells", icon: Database },
    ],
  },
  {
    title: "Контроль",
    items: [
      { title: "Очередь заданий", href: "/tasks", icon: ClipboardList },
      { title: "AprilTag", href: "/warehouse-stock/finished-goods/apriltags", icon: ScanLine },
      { title: "Документы", href: "/documents", icon: FileText },
      { title: "Терминалы", href: "/terminals", icon: Terminal },
      { title: "Уведомления", href: "/admin/notifications", icon: Bell },
      { title: "Здоровье БД", href: "/db-health", icon: HeartPulse },
    ],
  },
  {
    title: "Маркировка",
    items: [
      { title: "Заказы кодов", href: "/marking/label-orders", icon: Printer },
    ],
  },
  {
    title: "Данные",
    items: [{ title: "Номенклатура", href: "/nomenclature", icon: Tag }],
  },
]

export function Sidebar({
  collapsed,
  onCollapsedChange,
}: {
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}) {
  const pathname = usePathname()
  const [localCollapsed, setLocalCollapsed] = useState(false)
  const isCollapsed = collapsed ?? localCollapsed
  const [badgeByHref, setBadgeByHref] = useState<Record<string, number>>({})

  useEffect(() => {
    let ignore = false

    /* Счётчики от прошлой загрузки рисуем сразу, чтобы меню не мигало. */
    try {
      const saved = sessionStorage.getItem(BADGE_CACHE_KEY)
      if (saved) setBadgeByHref(JSON.parse(saved) as Record<string, number>)
    } catch {
      /* повреждённый кэш не мешает работе */
    }

    async function loadBadges() {
      try {
        const counters = await getNavCounters()
        if (ignore) return
        const next = {
          "/receiving": counters.receiving ?? 0,
          "/movement": counters.movement ?? 0,
          "/tasks": counters.tasks ?? 0,
        }
        setBadgeByHref(next)
        try {
          sessionStorage.setItem(BADGE_CACHE_KEY, JSON.stringify(next))
        } catch {
          /* приватный режим без хранилища — не критично */
        }
      } catch {
        if (!ignore) setBadgeByHref({})
      }
    }

    loadBadges()
    return () => {
      ignore = true
    }
  }, [])

  const setCollapsed = (value: boolean) => {
    setLocalCollapsed(value)
    onCollapsedChange?.(value)
  }

  const navGroups = useMemo(() => navigation, [])
  const allNavHrefs = useMemo(
    () => navigation.flatMap((group) => group.items.map((item) => item.href)),
    [],
  )

  function isNavItemActive(href: string) {
    if (href === "/") return pathname === "/"
    if (pathname === href) return true
    if (!pathname.startsWith(`${href}/`)) return false
    // Не подсвечивать родителя, если есть более точный пункт меню.
    return !allNavHrefs.some(
      (other) =>
        other !== href &&
        other.startsWith(`${href}/`) &&
        (pathname === other || pathname.startsWith(`${other}/`)),
    )
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen border-r border-sidebar-border/80 bg-sidebar transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex h-16 shrink-0 items-center justify-between px-3">
          {!isCollapsed && (
            <div className="flex min-w-0 items-center gap-2.5">
              <Image
                src={logoWmsScada}
                alt="WMS SCADA"
                className="h-8 w-8 rounded-md object-contain"
                priority
              />
              <div className="min-w-0">
                <h1 className="text-[13px] font-semibold leading-tight text-sidebar-foreground">SCADA SYSTEM</h1>
                <p className="text-[11px] text-muted-foreground">WMS</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!isCollapsed)}
            className={cn(
              "flex items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors",
              isCollapsed ? "relative mx-auto h-10 w-10" : "h-7 w-7 shrink-0"
            )}
            title={isCollapsed ? "Развернуть меню" : "Свернуть меню"}
          >
            {isCollapsed ? (
              <>
                <Image
                  src={logoWmsScada}
                  alt="WMS SCADA"
                  className="h-8 w-8 rounded-md object-contain"
                  priority
                />
                <ChevronLeft className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rotate-180 text-muted-foreground" />
              </>
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-4">
              {!isCollapsed && (
                <h2 className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </h2>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const badge = badgeByHref[item.href] ?? item.badge
                  const active = isNavItemActive(item.href)
                  return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      /* Иначе Next тянет данные всех тридцати разделов сразу
                         при каждой загрузке страницы; при наведении подгрузка
                         остаётся. */
                      prefetch={false}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                        isCollapsed && "relative justify-center px-2"
                      )}
                      title={isCollapsed ? item.title : undefined}
                    >
                      {active ? (
                        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
                      ) : null}
                      <item.icon className={cn("h-4 w-4 flex-shrink-0", active && "text-primary")} />
                      {!isCollapsed && (
                        <>
                          <span className="flex-1">{item.title}</span>
                          {badge ? (
                            <span className="flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] font-medium bg-muted text-foreground">
                              {badge}
                            </span>
                          ) : null}
                        </>
                      )}
                      {isCollapsed && badge ? (
                        <span className="absolute right-0 top-0 flex h-4 min-w-4 translate-x-1 -translate-y-1 items-center justify-center rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                          {badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                )})}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3">
          <Link
            href="/settings"
            prefetch={false}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              isCollapsed && "justify-center px-2"
            )}
            title={isCollapsed ? "Настройки" : undefined}
          >
            <Settings className="h-5 w-5" />
            {!isCollapsed && <span>Настройки</span>}
          </Link>
        </div>
      </div>
    </aside>
  )
}
