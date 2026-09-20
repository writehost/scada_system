"use client"

import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { WmsUserRow } from "@/lib/wms-api"
import { wmsRoleLabelRU } from "@/lib/wms-labels"

export function SettingsDirectoriesUsers(props: {
  users: WmsUserRow[]
  loading?: boolean
  error?: string | null
  onRefresh: () => void | Promise<void>
  onAddUser: () => void
  onChangePassword?: (user: WmsUserRow) => void
  onDeleteUser?: (user: WmsUserRow) => void
  currentUserId?: string | null
  deletingUserId?: string | null
}) {
  const {
    users,
    loading,
    error,
    onRefresh,
    onAddUser,
    onChangePassword,
    onDeleteUser,
    currentUserId,
    deletingUserId,
  } = props

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Учётные записи для входа на сайт и назначения на ТСД. Колонка ID — для привязки терминала.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void onRefresh()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <Button type="button" size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={onAddUser}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить пользователя
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Загрузка списка…</div>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">Пользователей пока нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[920px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[28%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Имя</th>
                <th className="px-4 py-2.5 font-medium">Login</th>
                <th className="px-4 py-2.5 font-medium">ID / ТСД</th>
                <th className="px-4 py-2.5 font-medium">Телефон</th>
                <th className="px-4 py-2.5 font-medium">Роли</th>
                <th className="px-4 py-2.5 text-right font-medium">Статус</th>
                <th className="px-4 py-2.5 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.userId} className="align-top">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <div className="break-words leading-snug">{u.displayName}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    <div className="break-all leading-snug">{u.login}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    <div className="break-all leading-snug">{u.userId}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="break-words leading-snug">{u.phone || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(u.roles || []).length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        u.roles.map((r) => (
                          <Badge key={r} variant="secondary" className="max-w-full whitespace-normal rounded-md text-xs leading-tight">
                            {wmsRoleLabelRU(r)}
                          </Badge>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <span className={u.isActive ? "text-success" : "text-destructive"}>
                      {u.isActive ? "Активен" : "Неактивен"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <div className="inline-flex shrink-0 justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg px-2"
                        onClick={() => onChangePassword?.(u)}
                        disabled={!onChangePassword}
                        title="Сменить пароль"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg px-2 text-destructive hover:text-destructive"
                        onClick={() => onDeleteUser?.(u)}
                        disabled={!onDeleteUser || deletingUserId === u.userId || currentUserId === u.userId}
                        title={currentUserId === u.userId ? "Нельзя удалить текущего пользователя" : "Удалить"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
