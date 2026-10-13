"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { REQUEST_STATUS_LABEL, type RequestStatus } from "@/lib/request-status"
import { ProductIcon } from "../brand"
import { api, fmtDate, RequestStatusBadge, type AdminProduct } from "./ui"

type Req = {
  id: number
  publicNo: string
  createdAt: string
  firstName: string
  lastName: string
  email: string
  company: string
  jobTitle: string
  phone: string | null
  comment: string | null
  requestedModules: string[]
  approvedModules: string[]
  status: RequestStatus
  assigneeSubject: string | null
  assigneeName: string | null
  organizationRef: string | null
  organizationName: string | null
  decisionNote: string | null
  inviteKind: "new_user" | "existing_user" | null
  inviteSentAt: string | null
  inviteExpiresAt: string | null
  activatedAt: string | null
}
type Event = { id: number; at: string; actorKind: string; actorName: string | null; action: string; fromStatus: string | null; toStatus: string | null; details: Record<string, unknown> }
type Grant = { productKey: string; scadaIdApp: string; organizationRef: string; state: string; detail: string | null }
type Mail = { id: number; kind: string; recipients: string[]; subject: string; status: string; attempts: number; lastError: string | null; createdAt: string }
type Detail = { request: Req; events: Event[]; grants: Grant[]; mails: Mail[] }
type Org = { ref: string; name: string }

const ACTION: Record<string, string> = {
  submitted: "Заявка отправлена",
  assigned: "Назначен ответственный",
  unassigned: "Ответственный снят",
  status_changed: "Статус изменён",
  modules_selected: "Выбраны модули для одобрения",
  organization_set: "Указана организация",
  note_updated: "Обновлён комментарий",
  invite_sent: "Отправлено приглашение SCADA ID",
  invite_resent: "Приглашение отправлено повторно",
  activated: "Заявитель активировал доступ",
  manual_grant_confirmed: "Подтверждена ручная выдача доступа",
  mail_retry: "Повторная отправка письма",
  admin_notify_skipped: "Уведомление администратору не отправлено",
}
const MAIL: Record<string, string> = {
  applicant_received: "Подтверждение заявителю",
  admin_new_request: "Уведомление администратору",
  applicant_rejected: "Отказ заявителю",
  applicant_invite: "Приглашение заявителю",
  admin_manual_grant: "Нужна ручная выдача",
}
const GRANT: Record<string, string> = { pending: "Ожидает активации", provisioned: "Выдан", manual: "Выдать вручную", failed: "Ошибка" }

export function RequestDetail({ id, products, provisioning, me }: { id: string; products: AdminProduct[]; provisioning: boolean; me: string }) {
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; text: string } | null>(null)
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [approved, setApproved] = useState<string[]>([])
  const [orgRef, setOrgRef] = useState("")
  const [orgName, setOrgName] = useState("")
  const [note, setNote] = useState("")
  const [notify, setNotify] = useState(true)
  const [manualNote, setManualNote] = useState("")

  const hydrate = useCallback((d: Detail) => {
    setData(d)
    const r = d.request
    setApproved(r.approvedModules.length ? r.approvedModules : r.requestedModules)
    setOrgRef(r.organizationRef || "")
    setOrgName(r.organizationName || "")
    setNote(r.decisionNote || "")
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      hydrate(await api<Detail>(`/api/admin/requests/${id}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [id, hydrate])

  useEffect(() => {
    void load()
    api<{ organizations: Org[] | null }>("/api/admin/organizations")
      .then((r) => setOrgs(r.organizations))
      .catch(() => setOrgs(null))
  }, [load])

  async function run(label: string, fn: () => Promise<Detail & { mailResult?: { status: string; kind: string; error?: string }[] }>, ok: string) {
    setBusy(label)
    setFlash(null)
    try {
      const d = await fn()
      hydrate(d)
      const failed = d.mailResult?.filter((m) => m.status === "failed") || []
      setFlash(failed.length ? { tone: "err", text: `${ok}. Но письмо не отправлено: ${failed[0].error}` } : { tone: "ok", text: ok })
    } catch (e) {
      setFlash({ tone: "err", text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const patch = (body: Record<string, unknown>) => api<Detail>(`/api/admin/requests/${id}`, { method: "PATCH", body: JSON.stringify(body) })
  const decision = () => ({
    approvedModules: approved,
    organization: orgRef.trim() ? { ref: orgRef.trim(), name: orgName.trim() || orgRef.trim() } : null,
    note,
  })

  if (error) {
    return (
      <div role="alert" className="card p-10 text-center">
        <p className="font-semibold text-danger">{error}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href="/admin/requests" className="btn btn-secondary btn-sm">К списку</Link>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>Повторить</button>
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Загрузка заявки">
        <div className="skeleton h-10 w-72" />
        <div className="skeleton h-64" />
      </div>
    )
  }

  const r = data.request
  const locked = r.status === "invited" || r.status === "access_granted"
  const editable = !locked && r.status !== "rejected"
  const byKey = new Map(products.map((p) => [p.key as string, p]))
  const partial = approved.length > 0 && approved.length < r.requestedModules.length

  return (
    <div>
      <Link href="/admin/requests" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-text hover:text-ink">
        <span aria-hidden="true">←</span> Все заявки
      </Link>
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-3xl font-extrabold tracking-tight">{r.publicNo}</h1>
          <RequestStatusBadge status={r.status} />
          <span className="text-sm text-muted">от {fmtDate(r.createdAt)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-text">Ответственный: <b className="text-ink">{r.assigneeName || "не назначен"}</b></span>
          {r.assigneeName ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => run("unassign", () => patch({ assign: "none" }), "Ответственный снят")}>Снять</button>
          ) : null}
          {r.assigneeSubject !== me && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => run("assign", () => patch({ assign: "me" }), "Вы назначены ответственным")} data-testid="assign-me">
              Взять себе
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div role={flash.tone === "err" ? "alert" : "status"} className={`mt-5 rounded-xl px-4 py-3 text-sm font-semibold ${flash.tone === "ok" ? "bg-[#e6f6ef] text-ok" : "bg-[#fdecea] text-danger"}`} data-testid="flash">
          {flash.text}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <section className="card p-6" aria-labelledby="ap-h">
            <h2 id="ap-h" className="text-xs font-bold uppercase tracking-wider text-muted">Заявитель</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item k="Имя">{r.firstName} {r.lastName}</Item>
              <Item k="Должность">{r.jobTitle}</Item>
              <Item k="Организация">{r.company}</Item>
              <Item k="Email"><a href={`mailto:${r.email}`} className="text-brand-700 hover:underline">{r.email}</a></Item>
              <Item k="Телефон">{r.phone || "—"}</Item>
            </dl>
            <div className="mt-4 rounded-xl bg-frost p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Цели использования</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{r.comment || <span className="text-muted">Комментарий не указан</span>}</p>
            </div>
          </section>

          <section className="card p-6" aria-labelledby="dc-h">
            <h2 id="dc-h" className="text-xs font-bold uppercase tracking-wider text-muted">Решение</h2>

            <fieldset className="mt-4" disabled={!editable || !!busy}>
              <legend className="text-sm font-bold">Одобряемые модули</legend>
              <p className="text-xs text-muted">Можно одобрить часть запрошенного.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {r.requestedModules.map((k) => {
                  const p = byKey.get(k)
                  const on = approved.includes(k)
                  return (
                    <label key={k} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${on ? "border-brand-400 bg-brand-50/50" : "border-line"} ${!editable ? "cursor-default opacity-80" : ""}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        checked={on}
                        onChange={() => setApproved((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))}
                        data-testid={`approve-${k}`}
                      />
                      {p && <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={28} />}
                      <span className="text-sm font-semibold">{p?.name || k}</span>
                      {p?.partOf && <span className="ml-auto text-xs text-muted">в составе {byKey.get(p.partOf)?.short}</span>}
                    </label>
                  )
                })}
              </div>
              {partial && <p className="mt-2 text-xs font-semibold text-warn">Частичное одобрение: заявитель увидит, какие модули не подключены.</p>}
            </fieldset>

            <fieldset className="mt-6" disabled={!editable || !!busy}>
              <legend className="text-sm font-bold">Организация в SCADA ID</legend>
              <p className="text-xs text-muted">Доступ выдаётся только к этой организации.</p>
              {orgs && orgs.length > 0 ? (
                <select
                  className="field mt-2"
                  value={orgRef}
                  onChange={(e) => {
                    setOrgRef(e.target.value)
                    setOrgName(orgs.find((o) => o.ref === e.target.value)?.name || "")
                  }}
                  aria-label="Организация"
                  data-testid="org-select"
                >
                  <option value="">— выберите организацию —</option>
                  {orgs.map((o) => <option key={o.ref} value={o.ref}>{o.name}</option>)}
                </select>
              ) : (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <input className="field" value={orgRef} onChange={(e) => setOrgRef(e.target.value)} placeholder="Код организации в SCADA ID" aria-label="Код организации" data-testid="org-ref" />
                  <input className="field" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder={r.company} aria-label="Название организации" data-testid="org-name" />
                </div>
              )}
            </fieldset>

            <div className="mt-6">
              <label htmlFor="note" className="text-sm font-bold">Комментарий администратора</label>
              <textarea id="note" className="field mt-2 min-h-20" value={note} onChange={(e) => setNote(e.target.value)} disabled={locked || !!busy} placeholder="Будет показан заявителю в письме с решением" maxLength={2000} />
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
              {editable && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => run("save", () => patch(decision()), "Сохранено")}>
                  Сохранить
                </button>
              )}
              {r.status === "new" && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => run("review", () => patch({ status: "in_review" }), "Заявка взята на рассмотрение")} data-testid="to-review">
                  На рассмотрение
                </button>
              )}
              {r.status === "in_review" && (
                <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || approved.length === 0} onClick={() => run("approve", () => patch({ ...decision(), status: "approved" }), "Заявка одобрена")} data-testid="approve">
                  {busy === "approve" ? <span className="spinner" aria-hidden="true" /> : null}
                  Одобрить {partial ? "частично" : ""}
                </button>
              )}
              {(r.status === "approved" || r.status === "rejected") && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => run("reopen", () => patch({ status: "in_review" }), "Заявка возвращена на рассмотрение")}>
                  Вернуть на рассмотрение
                </button>
              )}
              {["new", "in_review", "approved"].includes(r.status) && (
                <span className="ml-auto flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-text">
                    <input type="checkbox" className="accent-brand-600" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                    Уведомить заявителя
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm border border-danger/30 bg-white text-danger hover:bg-[#fdecea]"
                    disabled={!!busy}
                    data-testid="reject"
                    onClick={() => {
                      if (window.confirm(`Отклонить заявку ${r.publicNo}?`)) void run("reject", () => patch({ note, status: "rejected", notifyApplicant: notify }), "Заявка отклонена")
                    }}
                  >
                    Отклонить
                  </button>
                </span>
              )}
            </div>
          </section>

          {(r.status === "approved" || r.status === "invited" || r.status === "access_granted") && (
            <section className="card p-6" aria-labelledby="inv-h">
              <h2 id="inv-h" className="text-xs font-bold uppercase tracking-wider text-muted">Доступ в SCADA ID</h2>
              {!provisioning && (
                <p className="mt-3 rounded-xl bg-[#fff4e5] px-4 py-3 text-sm text-warn">
                  Выдача доступа в SCADA ID не настроена на сервере (PORTAL_SCADA_ID_ADMIN_CLIENT_ID / SECRET). Приглашение отправить нельзя.
                </p>
              )}
              {r.status === "approved" && (
                <div className="mt-4">
                  <p className="text-sm text-slate-text">
                    Портал найдёт пользователя в SCADA ID по {r.email}. Если учётной записи нет — создаст её с подтверждённым email, и SCADA ID отправит письмо для завершения регистрации. Права выдаются после того, как заявитель войдёт и активирует приглашение.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary mt-4"
                    disabled={!!busy || !provisioning}
                    onClick={() => run("invite", () => api(`/api/admin/requests/${id}/invite`, { method: "POST", body: "{}" }), "Приглашение отправлено")}
                    data-testid="invite"
                  >
                    {busy === "invite" ? <span className="spinner" aria-hidden="true" /> : null}
                    Отправить приглашение
                  </button>
                </div>
              )}
              {r.inviteSentAt && (
                <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <Item k="Тип приглашения">{r.inviteKind === "new_user" ? "Новый пользователь — регистрация" : "Существующая учётная запись"}</Item>
                  <Item k="Отправлено">{fmtDate(r.inviteSentAt)}</Item>
                  <Item k="Действует до">{fmtDate(r.inviteExpiresAt)}</Item>
                  <Item k="Активировано">{fmtDate(r.activatedAt)}</Item>
                  <Item k="Организация">{r.organizationName || r.organizationRef}</Item>
                </dl>
              )}
              {data.grants.length > 0 && (
                <ul className="mt-5 divide-y divide-line rounded-xl border border-line text-sm" data-testid="grants">
                  {data.grants.map((g) => {
                    const p = byKey.get(g.productKey)
                    return (
                      <li key={g.productKey} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        {p && <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={26} />}
                        <span className="font-semibold">{p?.name || g.productKey}</span>
                        <span className="font-mono text-xs text-muted">{g.scadaIdApp}</span>
                        <span className={`chip ml-auto ${g.state === "provisioned" ? "bg-[#e6f6ef] text-ok" : g.state === "failed" ? "bg-[#fdecea] text-danger" : "bg-[#fff4e5] text-warn"}`}>{GRANT[g.state] || g.state}</span>
                        {g.detail && <span className="w-full text-xs text-muted">{g.detail}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
              {r.status === "invited" && (
                <div className="mt-5 space-y-4 border-t border-line pt-5">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!!busy || !provisioning}
                    onClick={() => run("reinvite", () => api(`/api/admin/requests/${id}/invite`, { method: "POST", body: "{}" }), "Приглашение отправлено повторно")}
                  >
                    Отправить приглашение повторно
                  </button>
                  <div>
                    <label htmlFor="manual" className="text-sm font-bold">Подтвердить ручную выдачу</label>
                    <p className="text-xs text-muted">Если доступ к части приложений вы выдали в консоли SCADA ID вручную — опишите это, и заявка будет закрыта.</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input id="manual" className="field" value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="Например: роль operator в scada-yms выдана вручную" />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!!busy || !manualNote.trim()}
                        onClick={() => run("manual", () => api(`/api/admin/requests/${id}/confirm-grant`, { method: "POST", body: JSON.stringify({ note: manualNote }) }), "Доступ отмечен выданным")}
                      >
                        Подтвердить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="card p-6" aria-labelledby="ml-h">
            <h2 id="ml-h" className="text-xs font-bold uppercase tracking-wider text-muted">Письма</h2>
            {data.mails.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Писем по заявке нет.</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm">
                {data.mails.map((m) => (
                  <li key={m.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{MAIL[m.kind] || m.kind}</span>
                      <span className={`chip ${m.status === "sent" ? "bg-[#e6f6ef] text-ok" : m.status === "failed" ? "bg-[#fdecea] text-danger" : "bg-frost-2"}`}>
                        {m.status === "sent" ? "Отправлено" : m.status === "failed" ? "Ошибка" : "В очереди"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">{m.recipients.join(", ")}</p>
                    {m.lastError && <p className="mt-1 text-xs text-danger">{m.lastError}</p>}
                    {m.status === "failed" && (
                      <button
                        type="button"
                        className="mt-2 text-xs font-semibold text-brand-700 hover:underline"
                        disabled={!!busy}
                        onClick={() => run("mail", () => api(`/api/admin/requests/${id}/mail`, { method: "POST", body: JSON.stringify({ mailId: m.id }) }), "Письмо отправлено повторно")}
                      >
                        Отправить повторно ({m.attempts})
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-6" aria-labelledby="ev-h">
            <h2 id="ev-h" className="text-xs font-bold uppercase tracking-wider text-muted">Журнал действий</h2>
            <ol className="relative mt-4 space-y-4 border-l border-line pl-5" data-testid="events">
              {data.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${e.actorKind === "admin" ? "bg-brand-600" : e.actorKind === "applicant" ? "bg-ok" : "bg-muted"}`} aria-hidden="true" />
                  <p className="font-semibold">
                    {ACTION[e.action] || e.action}
                    {e.toStatus && e.action === "status_changed" && `: ${REQUEST_STATUS_LABEL[e.toStatus as RequestStatus] || e.toStatus}`}
                  </p>
                  {typeof e.details?.reason === "string" && <p className="text-xs text-slate-text">{e.details.reason}</p>}
                  {typeof e.details?.note === "string" && e.details.note && <p className="text-xs text-slate-text">«{e.details.note}»</p>}
                  <p className="text-xs text-muted">
                    {fmtDate(e.at)} · {e.actorName || (e.actorKind === "system" ? "система" : e.actorKind)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="mt-0.5 font-semibold">{children}</dd>
    </div>
  )
}
