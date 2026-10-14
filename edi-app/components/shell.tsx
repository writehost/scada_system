"use client"

import {
  Bell,
  Building2,
  FileInput,
  FilePlus2,
  Files,
  GitBranch,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Shield,
  Sun,
  Users,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { api, relTime, useApi, useHotkeys, useLiveEvents } from "./api"
import { Badge, cn, IconButton, Kbd, Modal, Spinner, Toaster } from "./ui"

export type Me = {
  userId: string
  login: string
  fio: string
  siteId: number
  siteCode: string
  orgName: string
  orgs: Array<{ siteId: number; siteCode: string; name: string }>
  roles: Array<{ code: string; name: string }>
  permissions: string[]
  department: string | null
  plan: { code: string; name: string; features: Record<string, boolean>; status: string; validTo: string | null }
}

const MeContext = createContext<Me | null>(null)
export function useMe(): Me {
  const me = useContext(MeContext)
  if (!me) throw new Error("useMe outside shell")
  return me
}
export function can(me: Me, p: string) {
  return me.permissions.includes(p)
}

/** Счётчики папок перечитываются по живым событиям — один источник для меню и журнала. */
const CountsContext = createContext<{ counts: Record<string, number>; reload: () => void }>({ counts: {}, reload: () => undefined })
export function useCounts() {
  return useContext(CountsContext)
}

const NAV = [
  { href: "/", label: "Главная", icon: LayoutDashboard, key: "home" },
  { href: "/documents", label: "Документы", icon: Files, key: "documents", count: "tasks" },
  { href: "/documents/new", label: "Создать", icon: FilePlus2, key: "new", perm: "edi.doc.create" },
  { href: "/import", label: "Загрузка", icon: FileInput, key: "import", perm: "edi.import" },
  { href: "/counterparties", label: "Контрагенты", icon: Building2, key: "cp" },
  { href: "/templates", label: "Шаблоны", icon: LayoutTemplate, key: "tpl" },
  { href: "/routes", label: "Маршруты", icon: GitBranch, key: "routes" },
  { href: "/admin", label: "Администрирование", icon: Shield, key: "admin", perm: "edi.admin" },
]

function isActive(path: string, href: string) {
  if (href === "/") return path === "/"
  if (href === "/documents") return path === "/documents" || (path.startsWith("/documents/") && !path.startsWith("/documents/new"))
  return path === href || path.startsWith(href + "/")
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, error } = useApi<Me>("/api/auth/me")
  const { data: counts, reload: reloadCounts } = useApi<Record<string, number>>(me ? "/api/edi/documents/counts" : null, [Boolean(me)])
  const path = usePathname()
  const router = useRouter()
  const [navOpen, setNavOpen] = useState(false)
  const [help, setHelp] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState("")
  const gPressed = useRef(0)

  const live = useRef<ReturnType<typeof setTimeout> | null>(null)
  useLiveEvents(() => {
    if (live.current) clearTimeout(live.current)
    live.current = setTimeout(() => reloadCounts(), 400)
  })
  useEffect(() => setNavOpen(false), [path])

  useHotkeys({
    "/": () => searchRef.current?.focus(),
    "?": () => setHelp(true),
    n: () => router.push("/documents/new"),
    i: () => router.push("/import"),
    g: () => (gPressed.current = Date.now()),
    h: () => Date.now() - gPressed.current < 800 && router.push("/"),
    d: () => Date.now() - gPressed.current < 800 && router.push("/documents"),
    t: () => Date.now() - gPressed.current < 800 && router.push("/documents?folder=tasks"),
    c: () => Date.now() - gPressed.current < 800 && router.push("/counterparties"),
  })

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm">{error.message}</p>
          <button className="text-sm underline" onClick={() => (window.location.href = "/login")}>
            Войти снова
          </button>
        </div>
      </div>
    )
  }
  if (!me) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    )
  }

  const nav = NAV.filter((n) => !n.perm || me.permissions.includes(n.perm))
  return (
    <MeContext.Provider value={me}>
      <CountsContext.Provider value={{ counts: counts ?? {}, reload: reloadCounts }}>
        <div className="flex h-full min-h-0">
          <aside
            className={cn(
              "no-print fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-border bg-sidebar transition-transform lg:static lg:translate-x-0",
              navOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <div className="flex h-12 items-center gap-2 px-3">
              <img src="/icon.svg" alt="" className="size-7" />
              <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-bold">SCADA EDI</div>
                <div className="truncate text-[11px] text-muted-foreground">{me.orgName}</div>
              </div>
              <IconButton label="Закрыть меню" className="ml-auto lg:hidden" onClick={() => setNavOpen(false)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-auto px-2 py-1">
              {nav.map((n) => {
                const Icon = n.icon
                const c = n.count ? counts?.[n.count] : 0
                return (
                  <Link
                    key={n.key}
                    href={n.href}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px]",
                      isActive(path, n.href) ? "bg-sidebar-accent font-semibold" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                    {n.label}
                    {c ? <Badge tone="primary" className="ml-auto">{c}</Badge> : null}
                  </Link>
                )
              })}
            </nav>
            <div className="border-t border-border p-2 text-[11px] text-muted-foreground">
              <Link href="/settings" className="flex h-8 items-center gap-2 rounded-lg px-2.5 hover:bg-sidebar-accent hover:text-foreground">
                <Settings className="size-4" /> Профиль и уведомления
              </Link>
              <div className="px-2.5 pt-1">
                Тариф: {me.plan.name}
                {me.plan.status !== "active" && <span className="text-destructive"> · неактивен</span>}
              </div>
            </div>
          </aside>
          {navOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setNavOpen(false)} />}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="no-print flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-3">
              <IconButton label="Меню" className="lg:hidden" onClick={() => setNavOpen(true)}>
                <Menu className="size-4" />
              </IconButton>
              <form
                className="relative max-w-xl flex-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  router.push(`/documents?q=${encodeURIComponent(q.trim())}`)
                  searchRef.current?.blur()
                }}
              >
                <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLInputElement).blur()}
                  placeholder="Номер, контрагент, ИНН, товар, текст документа…"
                  aria-label="Поиск документов"
                  className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-10 text-[13px] outline-none focus:border-ring"
                />
                <span className="absolute right-2 top-1.5 hidden sm:block">
                  <Kbd>/</Kbd>
                </span>
              </form>
              <div className="ml-auto flex items-center gap-1">
                <OrgSwitcher me={me} />
                <Notifications />
                <ThemeToggle />
                <UserMenu me={me} onHelp={() => setHelp(true)} />
              </div>
            </header>
            <main className="min-h-0 flex-1 overflow-auto">{children}</main>
          </div>
        </div>
        {help && <HelpModal onClose={() => setHelp(false)} />}
        <Toaster />
      </CountsContext.Provider>
    </MeContext.Provider>
  )
}

function OrgSwitcher({ me }: { me: Me }) {
  const [busy, setBusy] = useState(false)
  if (me.orgs.length < 2) return null
  return (
    <select
      aria-label="Организация"
      className="hidden h-8 max-w-48 rounded-lg border border-border bg-card px-2 text-[13px] sm:block"
      value={me.siteId}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true)
        await api("/api/auth/switch-org", { method: "POST", json: { siteId: Number(e.target.value) } }).catch(() => setBusy(false))
        window.location.href = "/"
      }}
    >
      {me.orgs.map((o) => (
        <option key={o.siteId} value={o.siteId}>
          {o.name}
        </option>
      ))}
    </select>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), [])
  return (
    <IconButton
      label={dark ? "Светлая тема" : "Тёмная тема"}
      onClick={() => {
        const next = !dark
        document.documentElement.classList.toggle("dark", next)
        setDark(next)
        try {
          localStorage.setItem("edi:theme", next ? "dark" : "light")
        } catch {
          /* приватный режим */
        }
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  )
}

type Note = { id: string; event: string; title: string; body: string | null; documentId: string | null; readAt: string | null; createdAt: string }

function Notifications() {
  const [open, setOpen] = useState(false)
  const { data, reload } = useApi<{ notifications: Note[]; unread: number }>("/api/edi/notifications")
  const router = useRouter()
  useLiveEvents((e) => e.kind === "notification" && reload())
  const markAll = useCallback(async () => {
    await api("/api/edi/notifications", { method: "POST", json: { all: true } })
    reload()
  }, [reload])
  return (
    <div className="relative">
      <IconButton label="Уведомления" onClick={() => setOpen((o) => !o)}>
        <Bell className="size-4" />
        {data?.unread ? <span className="absolute right-1 top-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">{data.unread}</span> : null}
      </IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-[min(380px,calc(100vw-16px))] rounded-xl border border-border bg-popover shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[13px] font-semibold">Уведомления</span>
              {data?.unread ? (
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={markAll}>
                  Прочитать все
                </button>
              ) : null}
            </div>
            <div className="max-h-96 overflow-auto">
              {!data?.notifications.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Уведомлений нет</p>}
              {data?.notifications.map((n) => (
                <button
                  key={n.id}
                  className={cn("block w-full border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted", !n.readAt && "bg-[color-mix(in_oklch,var(--primary)_10%,transparent)]")}
                  onClick={async () => {
                    setOpen(false)
                    if (!n.readAt) await api("/api/edi/notifications", { method: "POST", json: { ids: [n.id] } }).catch(() => undefined)
                    reload()
                    if (n.documentId) router.push(`/documents?id=${n.documentId}`)
                  }}
                >
                  <div className="text-[13px] font-medium">{n.title}</div>
                  {n.body && <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{relTime(n.createdAt)}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function UserMenu({ me, onHelp }: { me: Me; onHelp: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="flex h-8 items-center gap-2 rounded-lg px-2 hover:bg-muted" onClick={() => setOpen((o) => !o)} aria-label="Профиль">
        <span className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {me.fio
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0])
            .join("")}
        </span>
        <span className="hidden max-w-36 truncate text-[13px] md:block">{me.fio}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-64 rounded-xl border border-border bg-popover p-1 shadow-xl">
            <div className="px-2.5 py-2">
              <div className="text-[13px] font-semibold">{me.fio}</div>
              <div className="text-xs text-muted-foreground">{me.roles.map((r) => r.name).join(", ")}</div>
            </div>
            <Link href="/settings" className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] hover:bg-muted" onClick={() => setOpen(false)}>
              <Users className="size-4" /> Профиль, замещение
            </Link>
            <button className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] hover:bg-muted" onClick={() => (setOpen(false), onHelp())}>
              <Kbd>?</Kbd> Горячие клавиши
            </button>
            <button
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-destructive hover:bg-muted"
              onClick={async () => {
                await api("/api/auth/logout", { method: "POST" }).catch(() => undefined)
                window.location.href = "/login"
              }}
            >
              <LogOut className="size-4" /> Выйти
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const KEYS: Array<[string, string]> = [
  ["/", "Поиск"],
  ["n", "Новый документ"],
  ["i", "Загрузить документы"],
  ["g h · g d · g t · g c", "Главная · Документы · Мои задачи · Контрагенты"],
  ["j / k, ↓ / ↑", "Следующий / предыдущий документ в журнале"],
  ["Enter", "Открыть карточку на весь экран"],
  ["x", "Отметить документ"],
  ["a", "Согласовать (если есть ваша задача)"],
  ["r", "Вернуть на доработку"],
  ["e", "Редактировать"],
  ["f", "В избранное"],
  ["[ / ]", "Скрыть/показать левую панель / карточку"],
  ["Esc", "Закрыть карточку или окно"],
]

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Горячие клавиши" onClose={onClose}>
      <table className="w-full text-[13px]">
        <tbody>
          {KEYS.map(([k, v]) => (
            <tr key={k} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-4">
                <Kbd>{k}</Kbd>
              </td>
              <td className="py-1.5">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
