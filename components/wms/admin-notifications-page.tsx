"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { createNotification, listUsers, type WmsUserRow } from "@/lib/wms-api"
import { wmsRoleLabelRU } from "@/lib/wms-labels"
import { plural } from "@/lib/wms/dashboard-data"

const SEVERITIES = [
  { value: "info", label: "Info", accent: "text-sky-700 dark:text-sky-400", bar: "bg-sky-600" },
  { value: "success", label: "Success", accent: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-600" },
  { value: "warning", label: "Warning", accent: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500" },
  { value: "critical", label: "Critical", accent: "text-red-700 dark:text-red-400", bar: "bg-red-600" },
] as const

const ROLE_FILTERS = [
  { value: "", label: "Все роли" },
  { value: "admin", label: "admin" },
  { value: "warehouse_manager", label: "warehouse_manager" },
  { value: "warehouse_operator", label: "warehouse_operator" },
  { value: "auditor", label: "auditor" },
  { value: "line_operator", label: "line_operator" },
] as const

function userHaystack(user: WmsUserRow): string {
  return [user.displayName, user.login, user.roles.join(" "), user.position ?? ""]
    .join(" ")
    .toLowerCase()
}

function roleLine(roles: string[]): string {
  if (roles.length === 0) return ""
  return roles.map((role) => wmsRoleLabelRU(role)).join(" · ")
}

export function AdminNotificationsPage() {
  const [users, setUsers] = useState<WmsUserRow[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [target, setTarget] = useState<"all" | "users">("all")
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [severity, setSeverity] = useState("info")
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let ignore = false
    async function loadUsers() {
      setUsersLoading(true)
      try {
        const data = await listUsers()
        if (!ignore) {
          setUsers(data.users || [])
          setLoadError(null)
        }
      } catch (e) {
        if (!ignore) setLoadError(e instanceof Error ? e.message : "Не удалось загрузить пользователей")
      } finally {
        if (!ignore) setUsersLoading(false)
      }
    }
    void loadUsers()
    return () => {
      ignore = true
    }
  }, [])

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((user) => {
      if (roleFilter && !user.roles.some((role) => role.toLowerCase() === roleFilter)) return false
      if (q && !userHaystack(user).includes(q)) return false
      return true
    })
  }, [query, roleFilter, users])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const recipientCount = target === "all" ? users.length : selected.length
  const canSend = !sending && title.trim().length > 0 && body.trim().length > 0 && recipientCount > 0

  function toggleUser(userId: string) {
    setTarget("users")
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    )
  }

  function selectVisible() {
    setTarget("users")
    setSelected((current) => {
      const next = new Set(current)
      for (const user of visibleUsers) next.add(user.userId)
      return [...next]
    })
  }

  function clearVisible() {
    const visibleIds = new Set(visibleUsers.map((user) => user.userId))
    setSelected((current) => current.filter((id) => !visibleIds.has(id)))
  }

  async function send() {
    if (sending) return
    if (!title.trim() || !body.trim() || recipientCount === 0) return
    setSending(true)
    setError(null)
    setStatus(null)
    try {
      const result = await createNotification({
        title,
        body,
        severity,
        target,
        userIds: target === "users" ? selected : undefined,
      })
      setStatus(`Уведомление отправлено ${result.recipientCount} ${plural(result.recipientCount, "пользователю", "пользователям", "пользователям")}`)
      setTitle("")
      setBody("")
      setSelected([])
      setTarget("all")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить уведомление")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="space-y-0.5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Уведомления</h1>
        <p className="text-[13px] text-muted-foreground">Отправка сообщений пользователям WMS</p>
      </header>

      <div className="grid items-start gap-0 lg:grid-cols-2 lg:gap-8">
        <section className="space-y-3 pb-4 lg:pb-0">
          <h2 className="text-sm font-semibold text-foreground">Сообщение</h2>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Заголовок</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Кратко, о чём речь"
              className="h-8 rounded-md text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Текст</span>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Что должен увидеть пользователь"
              rows={3}
              className="min-h-[72px] resize-y rounded-md text-sm"
            />
          </label>

          <fieldset className="space-y-1.5">
            <legend className="text-xs text-muted-foreground">Тип уведомления</legend>
            <div className="flex flex-wrap rounded-md border border-border p-0.5">
              {SEVERITIES.map((item) => {
                const active = severity === item.value
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSeverity(item.value)}
                    className={cn(
                      "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", item.bar)} />
                    <span className={active ? item.accent : undefined}>{item.label}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        </section>

        <section className="space-y-3 border-t border-border pt-4 lg:border-t-0 lg:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Получатели</h2>
            <div className="flex rounded-md border border-border p-0.5">
              {(
                [
                  { id: "all" as const, label: "Все" },
                  { id: "users" as const, label: "Выбранные" },
                ]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTarget(item.id)}
                  className={cn(
                    "h-8 rounded px-2.5 text-xs font-medium transition-colors",
                    target === item.id
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {target === "all" ? (
            <p className="text-xs text-muted-foreground">
              Уйдёт всем {users.length} {plural(users.length, "пользователю", "пользователям", "пользователям")}.
              Фильтр ниже только для просмотра.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={selectVisible}>
                Выбрать всех
              </button>
              <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={clearVisible}>
                Снять всех
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени, логину или роли"
              className="h-8 rounded-md text-sm"
            />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label="Фильтр по роли"
              className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs text-foreground sm:w-[200px]"
            >
              {ROLE_FILTERS.map((role) => (
                <option key={role.value || "all"} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>

          <div className="max-h-[360px] overflow-auto border-y border-border">
            {usersLoading ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">Загрузка пользователей…</p>
            ) : loadError ? (
              <p className="px-1 py-6 text-center text-sm text-destructive">{loadError}</p>
            ) : users.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">Пользователи не найдены</p>
            ) : visibleUsers.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">Нет совпадений</p>
            ) : (
              <ul>
                {visibleUsers.map((user) => {
                  const checked = selectedSet.has(user.userId)
                  const roles = roleLine(user.roles)
                  return (
                    <li key={user.userId} className="border-b border-border/60 last:border-b-0">
                      {target === "users" ? (
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2 px-1 py-1.5 hover:bg-muted/50",
                            checked && "bg-muted/40"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUser(user.userId)}
                            className="mt-1 size-3.5 shrink-0 accent-primary"
                          />
                          <UserLine user={user} roles={roles} />
                        </label>
                      ) : (
                        <div className="px-1 py-1.5">
                          <UserLine user={user} roles={roles} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted-foreground">
          {target === "all"
            ? `Получат все: ${users.length}`
            : `Выбрано: ${selected.length}`}
        </p>
        <Button className="h-9 px-4" disabled={!canSend} onClick={() => void send()}>
          {sending ? "Отправляем…" : "Отправить уведомление"}
        </Button>
      </div>

      {status ? (
        <p className="text-[13px] text-emerald-700 dark:text-emerald-400">✓ {status}</p>
      ) : null}

      {error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <p className="text-destructive">
            Ошибка отправки уведомления
            {error ? <span className="text-muted-foreground"> — {error}</span> : null}
          </p>
          <button
            type="button"
            className="font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
            disabled={sending}
            onClick={() => void send()}
          >
            Повторить
          </button>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Почта о просрочке — в{" "}
        <Link href="/settings" className="underline-offset-2 hover:underline">
          Настройках
        </Link>
        .
      </p>
    </div>
  )
}

function UserLine({ user, roles }: { user: WmsUserRow; roles: string }) {
  return (
    <span className="min-w-0 leading-tight">
      <span className="block truncate text-[13px] font-medium text-foreground">
        {user.displayName || user.login}
      </span>
      <span className="block truncate text-xs text-muted-foreground">
        {user.login}
        {roles ? ` · ${roles}` : ""}
      </span>
    </span>
  )
}
