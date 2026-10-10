"use client"

import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { dateRu } from "@/lib/client/format"
import { Badge, Button, ConfirmDialog, Dialog, ErrorBox, Field, Input, Panel, Select, Skeleton, useToast } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"

const ROLE: Record<string, string> = { owner: "Владелец", admin: "Администратор", engineer: "Инженер", accountant: "Бухгалтер", viewer: "Наблюдатель" }
const ROLE_HINT: Record<string, string> = { admin: "всё, кроме подписки", engineer: "приборы, шлюзы, показания, правила", accountant: "тарифы, платежи, показания", viewer: "только просмотр" }

export default function UsersPage() {
  const { can, me } = useApp()
  const toast = useToast()
  const q = useApi<{ members: Array<{ user_id: string; display_name: string; email: string | null; role: string; source: string; created_at: string }>; invitations: Array<{ invitation_id: string; email: string; role: string; expires_at: string }>; me: string }>("/api/v1/org/members")
  const [invite, setInvite] = useState(false)
  const [remove, setRemove] = useState<{ user_id: string; display_name: string } | null>(null)
  const [error, setError] = useState<{ message: string } | null>(null)
  const manage = can("users.manage")
  return (
    <div className="space-y-4">
      <PageHeader title="Пользователи" subtitle={me.org?.kind === "corporate" ? "Сотрудники из SCADA ID получают роль по гранту приложения; дополнительно можно пригласить по email." : "Члены семьи и помощники: вход через свой SCADA ID."} actions={manage ? <Button onClick={() => setInvite(true)}><Plus /> Пригласить</Button> : null} />
      <ErrorBox error={q.error ?? error} onRetry={q.reload} />
      <Panel bodyClassName="p-0">
        {!q.data ? (
          <Skeleton className="m-4 h-24" />
        ) : (
          <table className="ems-table">
            <thead><tr><th>Пользователь</th><th>Роль</th><th className="hidden sm:table-cell">Источник</th><th /></tr></thead>
            <tbody>
              {q.data.members.map((m) => (
                <tr key={m.user_id}>
                  <td><p className="font-medium">{m.display_name}</p><p className="text-xs text-muted-foreground">{m.email}</p></td>
                  <td>
                    {manage && m.source !== "scada_id" && m.user_id !== q.data!.me ? (
                      <select aria-label="Роль" className="ems-input h-8 w-auto text-[13px]" value={m.role} onChange={async (e) => {
                        setError(null)
                        try { await api(`/api/v1/org/members/${m.user_id}`, { method: "PATCH", body: { role: e.target.value } }); q.reload(); toast("Роль изменена") } catch (x) { setError(x as Error) }
                      }}>
                        {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    ) : (
                      <Badge>{ROLE[m.role]}</Badge>
                    )}
                  </td>
                  <td className="hidden text-xs text-muted-foreground sm:table-cell">{m.source === "scada_id" ? "SCADA ID" : m.source === "invite" ? "приглашение" : "создатель"} · с {dateRu(m.created_at)}</td>
                  <td className="text-right">{manage && m.user_id !== q.data!.me ? <Button variant="ghost" size="icon-sm" aria-label="Удалить из организации" onClick={() => setRemove(m)}><Trash2 /></Button> : null}</td>
                </tr>
              ))}
              {q.data.invitations.map((i) => (
                <tr key={i.invitation_id} className="text-muted-foreground">
                  <td>{i.email}<p className="text-xs">ожидает входа до {dateRu(i.expires_at)}</p></td>
                  <td><Badge tone="info">{ROLE[i.role]}</Badge></td>
                  <td className="hidden text-xs sm:table-cell">приглашение</td>
                  <td className="text-right">{manage ? <Button variant="ghost" size="sm" onClick={async () => { await api(`/api/v1/org/invitations/${i.invitation_id}`, { method: "DELETE" }); q.reload() }}>Отозвать</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {invite ? <InviteDialog onClose={() => setInvite(false)} onDone={() => { q.reload(); toast("Приглашение отправлено") }} /> : null}
      <ConfirmDialog open={Boolean(remove)} onClose={() => setRemove(null)} title="Удалить пользователя из организации?" text={`${remove?.display_name} потеряет доступ к данным организации.`} confirmLabel="Удалить" onConfirm={async () => { await api(`/api/v1/org/members/${remove!.user_id}`, { method: "DELETE" }); q.reload() }} />
    </div>
  )
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("viewer")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog open onClose={onClose} title="Пригласить пользователя" description="Пользователь входит через SCADA ID с этим email — доступ откроется автоматически."
      footer={<><Button variant="outline" onClick={onClose}>Отмена</Button><Button loading={busy} disabled={!email} onClick={async () => { setBusy(true); setError(null); try { await api("/api/v1/org/invitations", { body: { email, role } }); onDone(); onClose() } catch (e) { setError(e as Error) } finally { setBusy(false) } }}>Пригласить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Роль" hint={ROLE_HINT[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {["admin", "engineer", "accountant", "viewer"].map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}
