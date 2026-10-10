"use client"

import Link from "next/link"
import { Bell, Building2, CreditCard, LogOut, MonitorSmartphone, Plug, Users } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { dateTimeRu, relative } from "@/lib/client/format"
import { Badge, Button, Panel, Skeleton } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"

export default function SettingsPage() {
  const { me, industrial } = useApp()
  const sessions = useApi<{ sessions: Array<{ session_id: string; kind: string; created_at: string; last_seen_at: string; user_agent: string | null; ip: string | null; current: boolean }> }>("/api/auth/sessions")
  const links = [
    { href: "/settings/sites", icon: Building2, title: "Объекты", text: industrial ? "Площадки, цеха, линии, смены" : "Квартиры, дома, гаражи" },
    { href: "/settings/users", icon: Users, title: "Пользователи", text: "Участники, роли, приглашения" },
    { href: "/settings/notifications", icon: Bell, title: "Уведомления", text: "Адреса, типы, расписание, журнал писем" },
    { href: "/settings/integrations", icon: Plug, title: "Интеграции", text: "API-токены, выпуск продукции, мобильный API" },
    { href: "/settings/subscription", icon: CreditCard, title: "Подписка SCADA EMS", text: "Тариф, лимиты, история" },
  ]
  return (
    <div className="space-y-4">
      <PageHeader title="Настройки" subtitle={`${me.org?.name} · роль: ${me.org?.role}`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="ems-panel flex items-start gap-3 p-4 hover:border-primary/50">
            <l.icon className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">{l.title}</p>
              <p className="text-xs text-muted-foreground">{l.text}</p>
            </div>
          </Link>
        ))}
      </div>
      <Panel title="Учётная запись" subtitle="Пароль и двухфакторная защита управляются в SCADA ID">
        <p className="text-[13px]">
          {me.user.name} · {me.user.email}
        </p>
      </Panel>
      <Panel title="Активные сессии" subtitle="Веб и мобильный клиент. Завершение действует сразу." bodyClassName="p-0">
        {!sessions.data ? (
          <Skeleton className="m-4 h-16" />
        ) : (
          <ul className="divide-y divide-border/60">
            {sessions.data.sessions.map((s) => (
              <li key={s.session_id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                <MonitorSmartphone className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {s.kind === "mobile" ? "Мобильное приложение" : "Браузер"} {s.current ? <Badge tone="success">эта сессия</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.user_agent ?? "—"} · {s.ip ?? ""} · вход {dateTimeRu(s.created_at)} · активность {relative(s.last_seen_at)}
                  </p>
                </div>
                {!s.current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={async () => {
                      await api(`/api/auth/sessions/${s.session_id}`, { method: "DELETE" })
                      sessions.reload()
                    }}
                  >
                    <LogOut /> Завершить
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
