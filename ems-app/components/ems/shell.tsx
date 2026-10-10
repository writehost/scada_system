"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Activity, BarChart3, Bell, Building2, Calculator, CalendarDays, ChevronDown, ChevronLeft, ClipboardList, Cpu, Droplet, Factory, FileBarChart, Gauge, GitCompare,
  LayoutDashboard, LogOut, Menu, Plug, Receipt, Settings, ShieldCheck, Sparkles, SquareStack, Thermometer, Users, Wallet, X, Zap, BookOpen, PencilLine, Wrench,
} from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { cn } from "@/lib/client/cn"
import { Badge, Button, ErrorBox, Skeleton, ToastProvider } from "@/components/ui"

export type Me = {
  user: { userId: string; name: string; email: string | null; isPlatformAdmin: boolean }
  org: { orgId: string; name: string; kind: "personal" | "corporate"; segment: "home" | "industrial"; role: string; isDemo: boolean; onboardingDone: boolean } | null
  orgs: Array<{ orgId: string; name: string; kind: string; segment: string; role: string; isDemo: boolean }>
  permissions: string[]
  subscription: { planName: string; status: string; trialEndsAt: string | null; segment: string; features: string[]; limits: Record<string, number | null> } | null
}

export type SiteRow = { site_id: string; name: string; kind: string; timezone: string; meters: number; open_events: number; shifts: Array<{ name: string; from: string; to: string }>; address: string | null }

type Ctx = {
  me: Me
  sites: SiteRow[]
  siteId: string | null
  site: SiteRow | null
  setSiteId: (id: string) => void
  reloadSites: () => void
  reloadMe: () => void
  can: (perm: string) => boolean
  industrial: boolean
  hasFeature: (f: string) => boolean
}

const AppCtx = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error("useApp outside shell")
  return c
}

type NavItem = { title: string; href: string; icon: React.ComponentType<{ className?: string }>; industrialOnly?: boolean; perm?: string }
type NavGroup = { title: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { title: "Обзор", items: [{ title: "Главная", href: "/", icon: LayoutDashboard }, { title: "Сводка расходов", href: "/costs", icon: Wallet }] },
  {
    title: "Ресурсы",
    items: [
      { title: "Электричество", href: "/resources/electricity", icon: Zap },
      { title: "Холодная вода", href: "/resources/cold_water", icon: Droplet },
      { title: "Горячая вода", href: "/resources/hot_water", icon: Thermometer },
      { title: "Прочие услуги", href: "/resources/other", icon: SquareStack },
    ],
  },
  {
    title: "Аналитика",
    items: [
      { title: "Потребление", href: "/analytics", icon: BarChart3 },
      { title: "Сравнения", href: "/analytics/compare", icon: GitCompare },
      { title: "Отчёты", href: "/analytics/reports", icon: FileBarChart },
    ],
  },
  {
    title: "Учёт",
    items: [
      { title: "Счётчики", href: "/meters", icon: Gauge },
      { title: "Контроллеры", href: "/gateways", icon: Cpu, industrialOnly: true },
      { title: "Показания", href: "/readings", icon: PencilLine },
      { title: "Тарифы", href: "/tariffs", icon: Receipt },
    ],
  },
  {
    title: "Финансы",
    items: [
      { title: "Калькуляторы", href: "/finance/calculator", icon: Calculator },
      { title: "Платежи", href: "/finance/payments", icon: ClipboardList },
      { title: "Календарь", href: "/finance/calendar", icon: CalendarDays },
    ],
  },
  {
    title: "Мониторинг",
    items: [
      { title: "События", href: "/monitoring/events", icon: Activity },
      { title: "Оповещения", href: "/monitoring/rules", icon: Bell },
      { title: "Оборудование", href: "/monitoring/health", icon: Wrench, industrialOnly: true },
    ],
  },
  {
    title: "Управление",
    items: [
      { title: "Объекты", href: "/settings/sites", icon: Building2 },
      { title: "Пользователи", href: "/settings/users", icon: Users },
      { title: "Интеграции", href: "/settings/integrations", icon: Plug, industrialOnly: true },
      { title: "Каталог приборов", href: "/catalog", icon: BookOpen },
      { title: "Настройки", href: "/settings", icon: Settings },
    ],
  },
]

const SITE_KEY = "ems:site"

export function AppShell({ children }: { children: ReactNode }) {
  const meQ = useApi<Me>("/api/auth/me")
  const sitesQ = useApi<{ sites: SiteRow[] }>(meQ.data?.org ? `/api/v1/sites?org=${meQ.data.org.orgId}` : null)
  const [siteId, setSiteIdState] = useState<string | null>(null)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const sites = sitesQ.data?.sites
    if (!sites) return
    let saved: string | null = null
    try {
      saved = localStorage.getItem(`${SITE_KEY}:${meQ.data?.org?.orgId}`)
    } catch {
      /* приватный режим */
    }
    const pick = sites.find((s) => s.site_id === saved)?.site_id ?? sites[0]?.site_id ?? null
    setSiteIdState(pick)
  }, [sitesQ.data, meQ.data?.org?.orgId])

  const setSiteId = useCallback(
    (id: string) => {
      setSiteIdState(id)
      try {
        localStorage.setItem(`${SITE_KEY}:${meQ.data?.org?.orgId}`, id)
      } catch {
        /* ignore */
      }
    },
    [meQ.data?.org?.orgId],
  )

  // Первый запуск: без объектов — мастер.
  useEffect(() => {
    if (meQ.data?.org && sitesQ.data && sitesQ.data.sites.length === 0 && !meQ.data.org.onboardingDone && pathname === "/") router.replace("/onboarding")
  }, [meQ.data, sitesQ.data, pathname, router])

  const value = useMemo<Ctx | null>(() => {
    if (!meQ.data) return null
    const me = meQ.data
    const sites = sitesQ.data?.sites ?? []
    return {
      me,
      sites,
      siteId,
      site: sites.find((s) => s.site_id === siteId) ?? null,
      setSiteId,
      reloadSites: sitesQ.reload,
      reloadMe: meQ.reload,
      can: (p: string) => me.permissions.includes(p),
      industrial: me.org?.segment === "industrial",
      hasFeature: (f: string) => Boolean(me.subscription?.features.includes(f)),
    }
  }, [meQ.data, sitesQ.data, siteId, setSiteId, sitesQ.reload, meQ.reload])

  if (meQ.error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorBox error={meQ.error} onRetry={meQ.reload} />
      </div>
    )
  }
  if (!value || (value.me.org && !sitesQ.data && !sitesQ.error)) return <ShellSkeleton />

  return (
    <AppCtx.Provider value={value}>
      <ToastProvider>
        <Frame>{children}</Frame>
      </ToastProvider>
    </AppCtx.Provider>
  )
}

function ShellSkeleton() {
  return (
    <div className="flex h-dvh">
      <div className="hidden w-60 border-r border-border bg-sidebar p-3 lg:block">
        <Skeleton className="mb-6 h-8 w-32" />
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="mb-2 h-6 w-40" />
        ))}
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    </div>
  )
}

function Frame({ children }: { children: ReactNode }) {
  const { me, industrial, sites, siteId, setSiteId } = useApp()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => setMobileOpen(false), [pathname])

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => industrial || !i.industrialOnly) })).filter((g) => g.items.length)
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href))
  const active = (href: string) => {
    if (href === "/") return pathname === "/"
    if (pathname === href) return true
    if (!pathname.startsWith(`${href}/`)) return false
    return !allHrefs.some((o) => o !== href && o.startsWith(`${href}/`) && (pathname === o || pathname.startsWith(`${o}/`)))
  }

  const nav = (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Разделы">
      {groups.map((g) => (
        <div key={g.title} className="mb-3">
          {!collapsed ? <h2 className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{g.title}</h2> : null}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const on = active(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    aria-current={on ? "page" : undefined}
                    title={collapsed ? item.title : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                      on ? "bg-sidebar-accent text-sidebar-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                      collapsed && "justify-center px-2",
                    )}
                  >
                    {on ? <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary" /> : null}
                    <item.icon className={cn("size-4 shrink-0", on && "text-[oklch(0.55_0.15_118)]")} />
                    {!collapsed ? <span className="truncate">{item.title}</span> : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {me.user.isPlatformAdmin ? (
        <Link href="/admin" prefetch={false} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-sidebar-accent", pathname.startsWith("/admin") && "bg-sidebar-accent text-foreground", collapsed && "justify-center px-2")}>
          <ShieldCheck className="size-4" />
          {!collapsed ? "Платформа" : null}
        </Link>
      ) : null}
    </nav>
  )

  const brand = (
    <div className="flex h-14 shrink-0 items-center gap-2.5 px-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Zap className="size-4" />
      </span>
      {!collapsed ? (
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">SCADA SYSTEM</p>
          <p className="text-[11px] text-muted-foreground">EMS · {industrial ? "Industrial" : "Home"}</p>
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="min-h-dvh">
      <aside className={cn("fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border/80 bg-sidebar transition-[width] duration-200 lg:flex", collapsed ? "w-16" : "w-60")}>
        {brand}
        {nav}
        <div className="border-t border-sidebar-border/60 p-2">
          <button type="button" onClick={() => setCollapsed(!collapsed)} className="flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent" aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}>
            <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
            {!collapsed ? "Свернуть" : null}
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/35" aria-label="Закрыть меню" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl">
            <div className="flex items-center justify-between pr-2">
              {brand}
              <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню">
                <X />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-60")}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/70 bg-background/90 px-3 backdrop-blur sm:px-4">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Меню">
            <Menu />
          </Button>
          <OrgSwitcher />
          {sites.length > 1 ? (
            <select
              aria-label="Объект"
              value={siteId ?? ""}
              onChange={(e) => setSiteId(e.target.value)}
              className="h-8 min-w-0 max-w-[40vw] truncate rounded-md border border-border bg-card px-2 text-[13px] font-medium sm:max-w-xs"
            >
              {sites.map((s) => (
                <option key={s.site_id} value={s.site_id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : sites[0] ? (
            <span className="hidden min-w-0 truncate text-[13px] font-medium text-muted-foreground sm:inline">{sites[0].name}</span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Link href="/readings" prefetch={false} className="hidden h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium hover:bg-muted sm:inline-flex">
              <PencilLine className="size-4" />
              Внести показания
            </Link>
            <UserMenu />
          </div>
        </header>
        <Banners />
        <main className="mx-auto w-full max-w-[1500px] min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5">{children}</main>
      </div>
    </div>
  )
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut()
    }
    const k = (e: KeyboardEvent) => e.key === "Escape" && onOut()
    document.addEventListener("mousedown", h)
    document.addEventListener("keydown", k)
    return () => {
      document.removeEventListener("mousedown", h)
      document.removeEventListener("keydown", k)
    }
  }, [ref, onOut])
}

function OrgSwitcher() {
  const { me } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false))
  const switchTo = async (orgId: string) => {
    setBusy(true)
    await api("/api/auth/switch-org", { body: { orgId } }).catch(() => undefined)
    window.location.href = "/"
  }
  const demo = async (segment: "home" | "industrial") => {
    setBusy(true)
    try {
      await api("/api/v1/demo", { body: { segment } })
      window.location.href = "/"
    } catch (e) {
      alert((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-8 min-w-0 max-w-[46vw] items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold hover:bg-muted sm:max-w-xs">
        {me.org?.segment === "industrial" ? <Factory className="size-4 shrink-0" /> : <Building2 className="size-4 shrink-0" />}
        <span className="truncate">{me.org?.name ?? "Нет организации"}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute left-0 top-9 z-50 w-72 rounded-xl border border-border bg-card p-1 shadow-lg">
          <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Организации</p>
          {me.orgs.map((o) => (
            <button key={o.orgId} type="button" disabled={busy} onClick={() => switchTo(o.orgId)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted", o.orgId === me.org?.orgId && "bg-muted")}>
              {o.segment === "industrial" ? <Factory className="size-4 shrink-0" /> : <Building2 className="size-4 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.isDemo ? <Badge tone="warning">демо</Badge> : <span className="text-[11px] text-muted-foreground">{o.kind === "personal" ? "личная" : "компания"}</span>}
            </button>
          ))}
          <div className="my-1 border-t border-border/60" />
          <button type="button" disabled={busy} onClick={() => demo("home")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted">
            <Sparkles className="size-4" /> Открыть демо: квартира
          </button>
          <button type="button" disabled={busy} onClick={() => demo("industrial")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted">
            <Sparkles className="size-4" /> Открыть демо: завод
          </button>
        </div>
      ) : null}
    </div>
  )
}

function UserMenu() {
  const { me } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, () => setOpen(false))
  const initials = me.user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="Профиль" aria-expanded={open} className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold hover:ring-2 hover:ring-ring/40">
        {initials || "?"}
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-border bg-card p-1 shadow-lg">
          <div className="px-2 py-2">
            <p className="truncate text-sm font-semibold">{me.user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">Вход через SCADA ID</p>
          </div>
          <Link href="/settings" prefetch={false} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted">
            <Settings className="size-4" /> Настройки и сессии
          </Link>
          <button
            type="button"
            onClick={async () => {
              await api("/api/auth/logout", { body: {} }).catch(() => undefined)
              window.location.href = "/login"
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-destructive hover:bg-muted"
          >
            <LogOut className="size-4" /> Выйти
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Banners() {
  const { me } = useApp()
  const sub = me.subscription
  return (
    <>
      {me.org?.isDemo ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center text-[13px] text-amber-900 dark:text-amber-200">
          Демо-режим: данные и тарифы синтетические, только для знакомства с SCADA EMS. Ваши организации не затронуты.
        </div>
      ) : null}
      {sub && (sub.status === "expired" || sub.status === "past_due" || sub.status === "cancelled") ? (
        <div className="border-b border-destructive/30 bg-destructive/[0.06] px-4 py-1.5 text-center text-[13px] text-destructive">
          {sub.status === "past_due" ? "Подписка SCADA EMS ожидает оплаты. Данные продолжают приниматься в течение льготного периода." : "Подписка SCADA EMS не активна: история доступна для просмотра, изменения приостановлены."}{" "}
          <Link href="/settings/subscription" className="underline">
            Подписка
          </Link>
        </div>
      ) : sub?.status === "trial" && sub.trialEndsAt ? (
        <div className="border-b border-border/60 bg-muted/40 px-4 py-1 text-center text-xs text-muted-foreground">
          Пробный период «{sub.planName}» до {new Date(sub.trialEndsAt).toLocaleDateString("ru-RU")}.{" "}
          <Link href="/settings/subscription" className="underline">
            Выбрать тариф
          </Link>
        </div>
      ) : null}
    </>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** Страница требует выбранного объекта: если объектов нет — предлагаем создать. */
export function NeedSite({ children }: { children: (siteId: string, site: SiteRow) => ReactNode }) {
  const { siteId, site, can } = useApp()
  if (!siteId || !site) {
    return (
      <div className="ems-panel mx-auto max-w-lg p-6 text-center">
        <Building2 className="mx-auto mb-2 size-8 text-muted-foreground" />
        <p className="font-semibold">Нет объектов</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Добавьте квартиру, дом или площадку — с этого начинается учёт.</p>
        {can("sites.write") ? (
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/onboarding" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Мастер первого запуска
            </Link>
            <Link href="/settings/sites" className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium">
              Добавить объект
            </Link>
          </div>
        ) : null}
      </div>
    )
  }
  return <>{children(siteId, site)}</>
}
