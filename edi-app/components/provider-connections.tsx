"use client"

import { useState } from "react"
import { api, fmtDateTime, useApi } from "./api"
import { Button, ErrorLine, Field, Input, Select, Spinner } from "./ui"

type Provider = { code: string; name: string; available: boolean; reason: string }
type Connection = { connectionId: string; provider: string; name: string; externalOrgId: string | null; participantId: string | null; status: string; lastSyncAt: string | null; lastError: string | null }

export function ProviderConnections() {
  const { data, error, reload } = useApi<{ catalog: Provider[]; connections: Connection[] }>("/api/edi/providers")
  const [provider, setProvider] = useState("diadoc")
  const [name, setName] = useState("")
  const [org, setOrg] = useState("")
  const [participant, setParticipant] = useState("")
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState(false)
  if (error) return <ErrorLine error={error} />
  if (!data) return <Spinner />
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">Организация может иметь несколько учётных записей одного или разных операторов. Черновик сохраняет реквизиты; обмен станет доступен после испытаний адаптера.</p>
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-left text-xs"><thead><tr><th className="p-3">Подключение</th><th className="p-3">Участник ЭДО</th><th className="p-3">Статус</th><th className="p-3">Синхронизация</th><th className="p-3">Действия</th></tr></thead>
        <tbody>{data.connections.map((c) => <tr key={c.connectionId} className="border-t border-border">
          <td className="p-3">{c.name}<div className="text-muted-foreground">{data.catalog.find((p) => p.code === c.provider)?.name} · {c.externalOrgId || "Организация не указана"}</div></td>
          <td className="p-3">{c.participantId || "—"}</td><td className="p-3">{c.status === "disabled" ? "Отключён" : c.status === "unconfigured" ? "Черновик" : c.status}<div className="text-destructive">{c.lastError}</div></td>
          <td className="p-3">{c.lastSyncAt ? fmtDateTime(c.lastSyncAt) : "Не выполнялась"}</td>
          <td className="p-3"><Button size="sm" disabled={busy || c.status === "disabled"} onClick={async () => { setBusy(true); setFailure(""); try { await api("/api/edi/providers", { method: "POST", json: { action: "disable", connectionId: c.connectionId } }); reload() } catch (e) { setFailure((e as Error).message) } finally { setBusy(false) } }}>Отключить</Button></td>
        </tr>)}{!data.connections.length && <tr><td colSpan={5} className="p-4 text-muted-foreground">Подключений пока нет</td></tr>}</tbody>
      </table>
    </div>
    <form className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setFailure("")
      try { await api("/api/edi/providers", { method: "POST", json: { action: "draft", provider, name, externalOrgId: org, participantId: participant } }); setName(""); setOrg(""); setParticipant(""); reload() }
      catch (e) { setFailure((e as Error).message) } finally { setBusy(false) }
    }}>
      <Field label="Оператор"><Select value={provider} onChange={(e) => setProvider(e.target.value)}>{data.catalog.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></Field>
      <Field label="Название подключения"><Input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Организация у оператора"><Input maxLength={200} value={org} onChange={(e) => setOrg(e.target.value)} /></Field>
      <Field label="Идентификатор участника ЭДО"><Input maxLength={200} value={participant} onChange={(e) => setParticipant(e.target.value)} /></Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">{data.catalog.find((p) => p.code === provider)?.reason}</p>
      <ErrorLine error={failure} /><Button type="submit" variant="primary" busy={busy}>Сохранить черновик</Button>
    </form>
  </div>
}
