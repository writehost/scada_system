"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { BrandLogo } from "./brand"

export type HeaderUser = { name: string; email: string; isOwner: boolean } | null

const NAV = [
  { href: "/#products", label: "Продукты" },
  { href: "/#how", label: "Как это работает" },
  { href: "/#scenarios", label: "Сценарии" },
  { href: "/#faq", label: "Вопросы" },
]

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}

export function SiteHeader({ user, overlay = false }: { user: HeaderUser; overlay?: boolean }) {
  const [scrolled, setScrolled] = useState(!overlay)
  const [menu, setMenu] = useState(false)
  const [account, setAccount] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!overlay) return
    const on = () => setScrolled(window.scrollY > 24)
    on()
    window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [overlay])

  useEffect(() => {
    if (!account) return
    const close = (e: MouseEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccount(false)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAccount(false)
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", esc)
    }
  }, [account])

  const dark = !scrolled && !menu
  const loginHref = "/api/auth/login?next=%2F%23my-apps"

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,border-color] duration-300 ${
        dark ? "border-b border-transparent" : "glass-light border-b border-line/70 shadow-[0_8px_24px_-18px_rgb(11_24_48/0.35)]"
      }`}
    >
      <div className="mx-auto flex h-[var(--header-h)] max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="SCADA SYSTEM — на главную" className="shrink-0">
          <BrandLogo tone={dark ? "light" : "dark"} />
        </Link>

        <nav aria-label="Основная навигация" className="ml-4 hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                dark ? "text-white/75 hover:text-white" : "text-slate-text hover:text-ink"
              }`}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <div className="relative" ref={accountRef}>
              <button
                type="button"
                onClick={() => setAccount((v) => !v)}
                aria-expanded={account}
                aria-haspopup="menu"
                className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-semibold transition-colors ${
                  dark ? "text-white hover:bg-white/10" : "text-ink hover:bg-frost-2"
                }`}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  {initials(user.name || user.email)}
                </span>
                <span className="hidden max-w-[160px] truncate sm:inline">{user.name || user.email}</span>
              </button>
              {account && (
                <div role="menu" className="card absolute right-0 mt-2 w-64 overflow-hidden p-1.5 text-sm">
                  <div className="px-3 py-2">
                    <div className="truncate font-semibold">{user.name}</div>
                    <div className="truncate text-xs text-muted">{user.email}</div>
                  </div>
                  <a role="menuitem" href="/#my-apps" className="block rounded-lg px-3 py-2 hover:bg-frost" onClick={() => setAccount(false)}>
                    Мои приложения
                  </a>
                  <Link role="menuitem" href="/request" className="block rounded-lg px-3 py-2 hover:bg-frost" onClick={() => setAccount(false)}>
                    Запросить модули
                  </Link>
                  {user.isOwner && (
                    <Link role="menuitem" href="/admin/requests" className="block rounded-lg px-3 py-2 hover:bg-frost" onClick={() => setAccount(false)}>
                      Заявки на подключение
                    </Link>
                  )}
                  <form action="/api/auth/logout" method="post">
                    <button role="menuitem" type="submit" className="block w-full rounded-lg px-3 py-2 text-left text-danger hover:bg-frost">
                      Выйти
                    </button>
                  </form>
                </div>
              )}
            </div>
          ) : (
            <a href={loginHref} className={`btn btn-sm hidden sm:inline-flex ${dark ? "btn-ghost-dark" : "btn-secondary"}`}>
              Войти через SCADA ID
            </a>
          )}
          <Link href="/request" className="btn btn-primary btn-sm hidden md:inline-flex">
            Запросить подключение
          </Link>
          <button
            type="button"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-lg lg:hidden ${dark ? "text-white" : "text-ink"}`}
            aria-label={menu ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {menu ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {menu && (
        <div className="border-t border-line bg-white px-4 pb-5 pt-2 lg:hidden">
          <nav aria-label="Мобильная навигация" className="flex flex-col">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setMenu(false)} className="rounded-lg px-2 py-3 text-base font-semibold text-ink">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 grid gap-2">
            <Link href="/request" className="btn btn-primary" onClick={() => setMenu(false)}>
              Запросить подключение
            </Link>
            {!user && (
              <a href={loginHref} className="btn btn-secondary">
                Войти через SCADA ID
              </a>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
