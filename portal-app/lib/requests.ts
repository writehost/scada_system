import type { PoolClient } from "pg"
import { enforceRateLimits, requestLimits } from "./antispam"
import { randomToken, sha256 } from "./crypto"
import { withClient, withTx } from "./db"
import { HttpError } from "./errors"
import { enqueueMail, flushOutbox, renderMail, type DeliveryResult } from "./mail"
import { productByKey } from "./products"
import {
  APPLICANT_STATUS_LABEL,
  canTransition,
  isRequestStatus,
  REQUEST_STATUS_LABEL,
  validateApproval,
  type RequestStatus,
} from "./request-status"
import * as scadaId from "./scada-id/provisioning"
import type { PortalSession } from "./session"
import { siteConfig } from "./site"
import { CONSENT_VERSION, type RequestInput } from "./validation"

export type RequestRow = {
  id: number
  publicNo: string
  createdAt: string
  updatedAt: string
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

const SELECT = `
  id::int AS id, public_no AS "publicNo",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt",
  first_name AS "firstName", last_name AS "lastName", email, company, job_title AS "jobTitle",
  phone, comment, requested_modules AS "requestedModules", approved_modules AS "approvedModules",
  status, assignee_subject AS "assigneeSubject", assignee_name AS "assigneeName",
  organization_ref AS "organizationRef", organization_name AS "organizationName",
  decision_note AS "decisionNote", invite_kind AS "inviteKind",
  to_char(invite_sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "inviteSentAt",
  to_char(invite_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "inviteExpiresAt",
  to_char(activated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "activatedAt"
`

type Actor = { kind: "applicant" | "admin" | "system"; subject?: string | null; name?: string | null }

function adminActor(s: PortalSession): Actor {
  return { kind: "admin", subject: s.sub, name: s.name || s.email }
}

export function moduleNames(keys: string[]): string {
  return keys.map((k) => productByKey(k)?.name || k).join(", ")
}

async function logEvent(
  client: PoolClient,
  requestId: number,
  actor: Actor,
  action: string,
  opts: { from?: string | null; to?: string | null; details?: Record<string, unknown> } = {}
) {
  await client.query(
    `INSERT INTO portal_request_events (request_id, actor_kind, actor_subject, actor_name, action, from_status, to_status, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [requestId, actor.kind, actor.subject ?? null, actor.name ?? null, action, opts.from ?? null, opts.to ?? null, JSON.stringify(opts.details || {})]
  )
}

async function loadForUpdate(client: PoolClient, id: number): Promise<RequestRow> {
  const r = await client.query<RequestRow>(`SELECT ${SELECT} FROM portal_access_requests WHERE id = $1 FOR UPDATE`, [id])
  const row = r.rows[0]
  if (!row) throw new HttpError(404, "Заявка не найдена", "not_found")
  return row
}

/* ───────────── Подача заявки ───────────── */

export type CreateResult = {
  request: Pick<RequestRow, "publicNo" | "status" | "requestedModules" | "createdAt">
  replayed: boolean
  mail: DeliveryResult[]
}

export async function createRequest(
  input: RequestInput,
  meta: { ipHash: string; userAgent: string; session: PortalSession | null }
): Promise<CreateResult> {
  const site = siteConfig()
  const tx = await withTx(async (client) => {
    // Повторная отправка той же формы (обрыв связи, двойной клик) возвращает ту же заявку.
    const prev = await client.query<RequestRow>(
      `SELECT ${SELECT} FROM portal_access_requests WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    )
    if (prev.rows[0]) {
      if (prev.rows[0].email !== input.email) throw new HttpError(409, "Ключ отправки уже использован", "idempotency_conflict")
      return { row: prev.rows[0], replayed: true, mailIds: [] as Array<number | null> }
    }

    await enforceRateLimits(client, requestLimits(meta.ipHash, input.email))

    const ins = await client.query<RequestRow>(
      `INSERT INTO portal_access_requests
        (idempotency_key, first_name, last_name, email, company, job_title, phone, comment,
         consent_at, consent_version, requested_modules, submitted_subject, ip_hash, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9, $10, $11, $12, $13)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${SELECT}`,
      [
        input.idempotencyKey,
        input.firstName,
        input.lastName,
        input.email,
        input.company,
        input.jobTitle,
        input.phone,
        input.comment,
        CONSENT_VERSION,
        input.modules,
        meta.session?.sub ?? null,
        meta.ipHash,
        meta.userAgent.slice(0, 300),
      ]
    )
    const row = ins.rows[0]
    if (!row) throw new HttpError(409, "Заявка уже отправляется, обновите страницу", "conflict")

    await logEvent(client, row.id, { kind: "applicant", subject: meta.session?.sub, name: `${row.firstName} ${row.lastName}` }, "submitted", {
      to: "new",
      details: { modules: row.requestedModules, authenticated: Boolean(meta.session) },
    })

    const modules = moduleNames(row.requestedModules)
    const applicantMail = renderMail({
      title: `Заявка ${row.publicNo} принята`,
      paragraphs: [
        `${row.firstName}, спасибо за интерес к SCADA SYSTEM. Ваша заявка на подключение получена и передана администратору экосистемы.`,
        "После рассмотрения вы получите письмо с решением. Если заявку одобрят, придёт приглашение войти через SCADA ID и активировать доступ.",
      ],
      rows: [
        ["Номер заявки", row.publicNo],
        ["Статус", APPLICANT_STATUS_LABEL.new],
        ["Организация", row.company],
        ["Продукты", modules],
      ],
    })
    const mailIds: Array<number | null> = [
      await enqueueMail(client, { requestId: row.id, kind: "applicant_received", recipients: [row.email], subject: `SCADA SYSTEM: заявка ${row.publicNo} принята`, ...applicantMail }),
    ]
    if (site.adminNotifyEmails.length) {
      const adminMail = renderMail({
        title: `Новая заявка ${row.publicNo}`,
        paragraphs: ["Поступила заявка на подключение к продуктам экосистемы."],
        rows: [
          ["Заявитель", `${row.firstName} ${row.lastName}, ${row.jobTitle}`],
          ["Организация", row.company],
          ["Email", row.email],
          ["Продукты", modules],
          ...(row.comment ? ([["Комментарий", row.comment]] as Array<[string, string]>) : []),
        ],
        action: { label: "Открыть заявку", url: `${site.publicUrl}/admin/requests/${row.id}` },
      })
      mailIds.push(
        await enqueueMail(client, { requestId: row.id, kind: "admin_new_request", recipients: site.adminNotifyEmails, subject: `Новая заявка ${row.publicNo}: ${row.company}`, ...adminMail })
      )
    } else {
      await logEvent(client, row.id, { kind: "system" }, "admin_notify_skipped", { details: { reason: "PORTAL_ADMIN_NOTIFY_EMAILS не задан" } })
    }
    return { row, replayed: false, mailIds }
  })

  const mail = await flushOutbox(tx.mailIds)
  return {
    request: {
      publicNo: tx.row.publicNo,
      status: tx.row.status,
      requestedModules: tx.row.requestedModules,
      createdAt: tx.row.createdAt,
    },
    replayed: tx.replayed,
    mail,
  }
}

/* ───────────── Чтение ───────────── */

export async function listRequests(filter: { status?: string; q?: string; mine?: string | null }) {
  return withClient(async (client) => {
    const where: string[] = []
    const args: unknown[] = []
    if (filter.status && isRequestStatus(filter.status)) {
      args.push(filter.status)
      where.push(`status = $${args.length}`)
    }
    if (filter.q) {
      args.push(`%${filter.q.toLowerCase()}%`)
      where.push(`(lower(email) LIKE $${args.length} OR lower(company) LIKE $${args.length} OR lower(first_name || ' ' || last_name) LIKE $${args.length} OR lower(public_no) LIKE $${args.length})`)
    }
    if (filter.mine) {
      args.push(filter.mine)
      where.push(`assignee_subject = $${args.length}`)
    }
    const r = await client.query<RequestRow>(
      `SELECT ${SELECT} FROM portal_access_requests ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC LIMIT 500`,
      args
    )
    const counts = await client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM portal_access_requests GROUP BY status`
    )
    return { items: r.rows, counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])) as Record<string, number> }
  })
}

export async function getRequestDetail(id: number) {
  return withClient(async (client) => {
    const r = await client.query<RequestRow>(`SELECT ${SELECT} FROM portal_access_requests WHERE id = $1`, [id])
    const request = r.rows[0]
    if (!request) throw new HttpError(404, "Заявка не найдена", "not_found")
    const events = await client.query(
      `SELECT id::int, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, actor_kind AS "actorKind",
              actor_name AS "actorName", action, from_status AS "fromStatus", to_status AS "toStatus", details
       FROM portal_request_events WHERE request_id = $1 ORDER BY at, id`,
      [id]
    )
    const grants = await client.query(
      `SELECT product_key AS "productKey", scada_id_app AS "scadaIdApp", organization_ref AS "organizationRef", state, detail
       FROM portal_access_grants WHERE request_id = $1 ORDER BY id`,
      [id]
    )
    const mails = await client.query(
      `SELECT id::int, kind, recipients, subject, status, attempts, last_error AS "lastError",
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
       FROM portal_mail_outbox WHERE request_id = $1 ORDER BY id`,
      [id]
    )
    return { request, events: events.rows, grants: grants.rows, mails: mails.rows }
  })
}

export async function requestsForEmail(email: string) {
  return withClient(async (client) => {
    const r = await client.query<RequestRow>(
      `SELECT ${SELECT} FROM portal_access_requests WHERE lower(email) = lower($1) ORDER BY created_at DESC LIMIT 20`,
      [email]
    )
    return r.rows.map((x) => ({
      publicNo: x.publicNo,
      createdAt: x.createdAt,
      status: x.status,
      statusLabel: APPLICANT_STATUS_LABEL[x.status],
      requestedModules: x.requestedModules,
      approvedModules: x.approvedModules,
    }))
  })
}

/* ───────────── Обработка администратором ───────────── */

export type AdminPatch = {
  status?: string
  assign?: "me" | "none"
  approvedModules?: string[]
  organization?: { ref: string; name: string } | null
  note?: string
  notifyApplicant?: boolean
}

export async function updateRequest(id: number, s: PortalSession, patch: AdminPatch) {
  const actor = adminActor(s)
  const site = siteConfig()
  const mailIds = await withTx(async (client) => {
    const row = await loadForUpdate(client, id)
    const ids: Array<number | null> = []
    const locked = row.status === "invited" || row.status === "access_granted"

    if (patch.assign) {
      const subject = patch.assign === "me" ? s.sub : null
      const name = patch.assign === "me" ? s.name || s.email : null
      await client.query(`UPDATE portal_access_requests SET assignee_subject=$2, assignee_name=$3, updated_at=now() WHERE id=$1`, [id, subject, name])
      await logEvent(client, id, actor, patch.assign === "me" ? "assigned" : "unassigned", { details: { assignee: name } })
      if (row.status === "new" && patch.assign === "me" && !patch.status) {
        await client.query(`UPDATE portal_access_requests SET status='in_review' WHERE id=$1`, [id])
        await logEvent(client, id, actor, "status_changed", { from: "new", to: "in_review" })
        row.status = "in_review"
      }
    }

    if (patch.approvedModules) {
      if (locked) throw new HttpError(409, "Состав модулей нельзя менять после отправки приглашения", "locked")
      const approved = [...new Set(patch.approvedModules.filter((m) => typeof m === "string"))]
      const err = validateApproval(row.requestedModules, approved)
      if (err && approved.length) throw new HttpError(400, err, "bad_modules")
      await client.query(`UPDATE portal_access_requests SET approved_modules=$2, updated_at=now() WHERE id=$1`, [id, approved])
      await logEvent(client, id, actor, "modules_selected", { details: { approved, requested: row.requestedModules } })
      row.approvedModules = approved
    }

    if (patch.organization !== undefined) {
      if (locked) throw new HttpError(409, "Организацию нельзя менять после отправки приглашения", "locked")
      const ref = patch.organization?.ref?.trim() || null
      const name = patch.organization?.name?.trim() || ref
      if (ref && (ref.length > 200 || (name?.length || 0) > 200)) throw new HttpError(400, "Слишком длинное название организации", "bad_org")
      await client.query(`UPDATE portal_access_requests SET organization_ref=$2, organization_name=$3, updated_at=now() WHERE id=$1`, [id, ref, name])
      await logEvent(client, id, actor, "organization_set", { details: { ref, name } })
      row.organizationRef = ref
      row.organizationName = name
    }

    if (typeof patch.note === "string") {
      const note = patch.note.trim().slice(0, 2000) || null
      await client.query(`UPDATE portal_access_requests SET decision_note=$2, updated_at=now() WHERE id=$1`, [id, note])
      await logEvent(client, id, actor, "note_updated")
      row.decisionNote = note
    }

    if (patch.status) {
      if (!isRequestStatus(patch.status)) throw new HttpError(400, "Неизвестный статус", "bad_status")
      const to = patch.status
      if (!canTransition(row.status, to)) {
        throw new HttpError(409, `Нельзя перевести заявку из «${REQUEST_STATUS_LABEL[row.status]}» в «${REQUEST_STATUS_LABEL[to]}»`, "bad_transition")
      }
      if (to === "approved") {
        const err = validateApproval(row.requestedModules, row.approvedModules)
        if (err) throw new HttpError(400, err, "bad_modules")
        if (!row.organizationRef) throw new HttpError(400, "Выберите организацию, к которой выдаётся доступ", "org_required")
      }
      await client.query(`UPDATE portal_access_requests SET status=$2, updated_at=now() WHERE id=$1`, [id, to])
      await logEvent(client, id, actor, "status_changed", { from: row.status, to, details: { note: row.decisionNote } })

      if (to === "rejected" && patch.notifyApplicant !== false) {
        const m = renderMail({
          title: `Заявка ${row.publicNo} отклонена`,
          paragraphs: [
            `${row.firstName}, по вашей заявке на подключение принято решение отказать.`,
            ...(row.decisionNote ? [`Комментарий администратора: ${row.decisionNote}`] : []),
            "Если у вас есть вопросы, ответьте на это письмо или отправьте новую заявку.",
          ],
          rows: [["Номер заявки", row.publicNo]],
        })
        ids.push(await enqueueMail(client, { requestId: id, kind: "applicant_rejected", recipients: [row.email], subject: `SCADA SYSTEM: решение по заявке ${row.publicNo}`, ...m }))
      }
    }
    return ids
  })
  const mail = await flushOutbox(mailIds)
  return { ...(await getRequestDetail(id)), mailResult: mail, site: site.publicUrl }
}

/* ───────────── Приглашение в SCADA ID ───────────── */

function activationUrl(origin: string, token: string) {
  return `${origin}/activate?token=${encodeURIComponent(token)}`
}

export async function inviteRequest(id: number, s: PortalSession, origin: string) {
  const actor = adminActor(s)
  const row = await withClient((c) => c.query<RequestRow>(`SELECT ${SELECT} FROM portal_access_requests WHERE id=$1`, [id])).then((r) => r.rows[0])
  if (!row) throw new HttpError(404, "Заявка не найдена", "not_found")
  if (row.status !== "approved" && row.status !== "invited") {
    throw new HttpError(409, "Приглашение отправляется только по одобренной заявке", "bad_transition")
  }
  if (!row.organizationRef) throw new HttpError(400, "Не выбрана организация", "org_required")
  const err = validateApproval(row.requestedModules, row.approvedModules)
  if (err) throw new HttpError(400, err, "bad_modules")

  const token = randomToken()
  const link = activationUrl(origin, token)

  // Внешние вызовы до записи в БД: если SCADA ID не ответил, статус не меняется.
  let user = await scadaId.findUserByEmail(row.email)
  let kind: "new_user" | "existing_user"
  if (!user) {
    const userId = await scadaId.createUser({
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      attributes: {
        portal_request: String(row.id),
        company: row.company,
        job_title: row.jobTitle,
        ...(row.phone ? { phone: row.phone } : {}),
      },
    })
    user = { id: userId, email: row.email }
    kind = "new_user"
  } else {
    // Пользователь создан этим же приглашением, но регистрацию ещё не завершил.
    kind = user.attributes?.portal_request?.[0] === String(row.id) ? "new_user" : "existing_user"
  }
  if (kind === "new_user") await scadaId.sendRegistrationInvite(user.id, link)

  const products = row.approvedModules.map((k) => productByKey(k)).filter((p): p is NonNullable<typeof p> => Boolean(p))
  const mailIds = await withTx(async (client) => {
    const cur = await loadForUpdate(client, id)
    if (cur.status !== "approved" && cur.status !== "invited") throw new HttpError(409, "Статус заявки изменился", "bad_transition")
    await client.query(
      `UPDATE portal_access_requests SET status='invited', invite_kind=$2, invite_token_hash=$3,
         invite_expires_at = now() + interval '7 days', invite_sent_at=now(), scada_user_id=$4, updated_at=now()
       WHERE id=$1`,
      [id, kind, sha256(token), user!.id]
    )
    await client.query(`DELETE FROM portal_access_grants WHERE request_id=$1 AND state <> 'provisioned'`, [id])
    for (const p of products) {
      await client.query(
        `INSERT INTO portal_access_grants (request_id, product_key, scada_id_app, organization_ref)
         VALUES ($1,$2,$3,$4) ON CONFLICT (request_id, product_key) DO NOTHING`,
        [id, p.key, p.scadaIdApp, cur.organizationRef]
      )
    }
    await logEvent(client, id, actor, cur.status === "invited" ? "invite_resent" : "invite_sent", {
      from: cur.status,
      to: "invited",
      details: { kind, scadaUserId: user!.id, modules: cur.approvedModules, organization: cur.organizationRef },
    })
    const partial = cur.approvedModules.length < cur.requestedModules.length
    const m = renderMail({
      title: "Доступ к SCADA SYSTEM одобрен",
      paragraphs: [
        `${cur.firstName}, ваша заявка ${cur.publicNo} одобрена${partial ? " частично" : ""}.`,
        kind === "new_user"
          ? "Отдельным письмом SCADA ID пришлёт ссылку для завершения регистрации: email уже подтверждён, останется проверить имя и задать пароль. После этого вы вернётесь на портал, и доступ активируется."
          : "У вас уже есть учётная запись SCADA ID. Войдите по кнопке ниже — одобренный доступ активируется после входа.",
        ...(cur.decisionNote ? [`Комментарий администратора: ${cur.decisionNote}`] : []),
        "Ссылка действует 7 дней и работает только для вашей учётной записи.",
      ],
      rows: [
        ["Организация", cur.organizationName || cur.organizationRef || ""],
        ["Одобрено", moduleNames(cur.approvedModules)],
        ...(partial ? ([["Не одобрено", moduleNames(cur.requestedModules.filter((x) => !cur.approvedModules.includes(x)))]] as Array<[string, string]>) : []),
      ],
      action: { label: kind === "new_user" ? "Активировать после регистрации" : "Войти и активировать доступ", url: link },
    })
    return [await enqueueMail(client, { requestId: id, kind: "applicant_invite", recipients: [cur.email], subject: `SCADA SYSTEM: доступ по заявке ${cur.publicNo} одобрен`, ...m })]
  })
  const mail = await flushOutbox(mailIds)
  return { ...(await getRequestDetail(id)), mailResult: mail, inviteKind: kind }
}

/* ───────────── Активация пользователем ───────────── */

export function maskEmail(email: string) {
  const [u, d] = email.split("@")
  return `${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${d}`
}

export async function inspectInvite(token: string) {
  return withClient(async (client) => {
    const r = await client.query<RequestRow & { expired: boolean }>(
      `SELECT ${SELECT}, invite_expires_at < now() AS expired FROM portal_access_requests WHERE invite_token_hash=$1`,
      [sha256(token)]
    )
    const row = r.rows[0]
    if (!row) return null
    return {
      publicNo: row.publicNo,
      status: row.status,
      expired: row.expired,
      emailHint: maskEmail(row.email),
      email: row.email,
      approvedModules: row.approvedModules,
      organizationName: row.organizationName,
    }
  })
}

export async function activateInvite(token: string, s: PortalSession) {
  const site = siteConfig()
  const row = await withClient((c) =>
    c.query<RequestRow & { expired: boolean; scadaUserId: string | null }>(
      `SELECT ${SELECT}, invite_expires_at < now() AS expired, scada_user_id AS "scadaUserId"
       FROM portal_access_requests WHERE invite_token_hash=$1`,
      [sha256(token)]
    )
  ).then((r) => r.rows[0])
  if (!row) throw new HttpError(404, "Ссылка недействительна", "bad_token")
  if (row.email.toLowerCase() !== s.email.toLowerCase()) {
    throw new HttpError(403, `Приглашение выдано для ${maskEmail(row.email)}. Войдите под этой учётной записью SCADA ID.`, "wrong_account")
  }
  if (row.status === "access_granted") return { status: row.status, grants: [], alreadyActive: true }
  if (row.status !== "invited") throw new HttpError(409, "Приглашение отозвано", "bad_transition")
  if (row.expired) throw new HttpError(410, "Срок действия приглашения истёк. Попросите администратора отправить его повторно.", "expired")

  const userId = row.scadaUserId || (await scadaId.findUserByEmail(row.email))?.id
  if (!userId) throw new HttpError(409, "Учётная запись SCADA ID не найдена", "no_user")
  const grants = await withClient((c) =>
    c.query<{ productKey: string; scadaIdApp: string; state: string }>(
      `SELECT product_key AS "productKey", scada_id_app AS "scadaIdApp", state FROM portal_access_grants WHERE request_id=$1`,
      [row.id]
    )
  ).then((r) => r.rows)
  const apps = [...new Set(grants.filter((g) => g.state !== "provisioned").map((g) => g.scadaIdApp))]
  const outcomes = await scadaId.assignAccess(userId, row.organizationRef!, apps)
  const byApp = new Map(outcomes.map((o) => [o.app, o]))

  const result = await withTx(async (client) => {
    const cur = await loadForUpdate(client, row.id)
    for (const g of grants) {
      const o = byApp.get(g.scadaIdApp)
      if (!o) continue
      await client.query(
        `UPDATE portal_access_grants SET state=$3, detail=$4, updated_at=now() WHERE request_id=$1 AND product_key=$2`,
        [row.id, g.productKey, o.state, o.detail]
      )
    }
    const states = await client.query<{ state: string }>(`SELECT state FROM portal_access_grants WHERE request_id=$1`, [row.id])
    const allDone = states.rows.every((x) => x.state === "provisioned")
    await client.query(`UPDATE portal_access_requests SET activated_at=COALESCE(activated_at, now()), updated_at=now() WHERE id=$1`, [row.id])
    const actor: Actor = { kind: "applicant", subject: s.sub, name: s.name || s.email }
    await logEvent(client, row.id, actor, "activated", { details: { outcomes } })
    const ids: Array<number | null> = []
    if (allDone && cur.status === "invited") {
      await client.query(`UPDATE portal_access_requests SET status='access_granted' WHERE id=$1`, [row.id])
      await logEvent(client, row.id, { kind: "system" }, "status_changed", { from: "invited", to: "access_granted" })
    } else if (site.adminNotifyEmails.length) {
      const pending = outcomes.filter((o) => o.state !== "provisioned")
      const m = renderMail({
        title: `Заявка ${cur.publicNo}: нужна ручная выдача доступа`,
        paragraphs: [`${cur.firstName} ${cur.lastName} активировал(а) приглашение, но часть доступа не выдана автоматически.`],
        rows: pending.map((o) => [o.app, o.detail] as [string, string]),
        action: { label: "Открыть заявку", url: `${site.publicUrl}/admin/requests/${cur.id}` },
      })
      ids.push(await enqueueMail(client, { requestId: cur.id, kind: "admin_manual_grant", recipients: site.adminNotifyEmails, subject: `Заявка ${cur.publicNo}: ручная выдача доступа`, ...m }))
    }
    return { allDone, ids }
  })
  await flushOutbox(result.ids)
  return { status: result.allDone ? "access_granted" : "invited", grants: outcomes, alreadyActive: false }
}

/** Админ подтверждает, что оставшийся доступ выдан вручную в консоли SCADA ID. */
export async function confirmManualGrant(id: number, s: PortalSession, note: string) {
  await withTx(async (client) => {
    const row = await loadForUpdate(client, id)
    if (row.status !== "invited") throw new HttpError(409, "Подтвердить выдачу можно только после отправки приглашения", "bad_transition")
    if (!note.trim()) throw new HttpError(400, "Опишите, что и где выдано вручную", "note_required")
    await client.query(`UPDATE portal_access_grants SET state='provisioned', detail=$2, updated_at=now() WHERE request_id=$1 AND state <> 'provisioned'`, [id, `Вручную: ${note.trim().slice(0, 300)}`])
    await client.query(`UPDATE portal_access_requests SET status='access_granted', updated_at=now() WHERE id=$1`, [id])
    await logEvent(client, id, adminActor(s), "manual_grant_confirmed", { from: "invited", to: "access_granted", details: { note: note.trim() } })
  })
  return getRequestDetail(id)
}

export async function retryMail(id: number, mailId: number, s: PortalSession) {
  await withClient(async (client) => {
    const r = await client.query(`SELECT 1 FROM portal_mail_outbox WHERE id=$1 AND request_id=$2 AND status='failed'`, [mailId, id])
    if (!r.rowCount) throw new HttpError(404, "Письмо не найдено или уже отправлено", "not_found")
    await logEvent(client, id, adminActor(s), "mail_retry", { details: { mailId } })
  })
  const res = await flushOutbox([mailId])
  return { ...(await getRequestDetail(id)), mailResult: res }
}
