import { integrationFetch } from "../outbound.ts"
import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { getDocument, lockVersion, touch } from "./documents.ts"
import { readFileChecked, saveFile } from "./files.ts"
import { resolveIntegration } from "./integrations/config.ts"
import { notifyUsers } from "./notify.ts"

/**
 * Электронные подписи. Здесь НЕТ «подписи кнопкой» и картинок факсимиле:
 *  - подпись создаётся внешним криптографическим ПО (КриптоПро ЭЦП Browser plug-in, как в WMS для ГИС МТ)
 *    или приходит от оператора ЭДО/контрагента — откреплённая CMS (CAdES);
 *  - EDI хранит подпись рядом с конкретной версией файла и не меняет подписанный оригинал;
 *  - локально разбирается структура CMS: сертификат подписанта, срок действия, время подписания;
 *  - криптографическая проверка (ГОСТ Р 34.10/34.11-2012, цепочка доверия, отзыв) — во внешнем
 *    сервисе проверки (интеграция kind=signature). Без него статус честно «не проверена».
 */

/* ---------- минимальный DER-разбор ---------- */

type Tlv = { tag: number; start: number; hdr: number; len: number; end: number; constructed: boolean }

function readTlv(b: Uint8Array, pos: number): Tlv {
  if (pos + 2 > b.length) throw new Error("DER: конец данных")
  const tag = b[pos]
  let len = b[pos + 1]
  let hdr = 2
  if (len === 0x80) throw new Error("DER: неопределённая длина не поддерживается")
  if (len & 0x80) {
    const n = len & 0x7f
    if (n > 4) throw new Error("DER: длина слишком велика")
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + b[pos + 2 + i]
    hdr += n
  }
  const end = pos + hdr + len
  if (end > b.length) throw new Error("DER: выход за границы")
  return { tag, start: pos, hdr, len, end, constructed: (tag & 0x20) !== 0 }
}

function kids(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = []
  let p = t.start + t.hdr
  while (p < t.end) {
    const c = readTlv(b, p)
    out.push(c)
    p = c.end
  }
  return out
}

function oid(b: Uint8Array, t: Tlv): string {
  const v = b.subarray(t.start + t.hdr, t.end)
  const parts = [Math.floor(v[0] / 40), v[0] % 40]
  let acc = 0
  for (let i = 1; i < v.length; i++) {
    acc = acc * 128 + (v[i] & 0x7f)
    if (!(v[i] & 0x80)) {
      parts.push(acc)
      acc = 0
    }
  }
  return parts.join(".")
}

function str(b: Uint8Array, t: Tlv): string {
  const v = b.subarray(t.start + t.hdr, t.end)
  if (t.tag === 0x1e) {
    let s = ""
    for (let i = 0; i + 1 < v.length; i += 2) s += String.fromCharCode((v[i] << 8) | v[i + 1])
    return s
  }
  return new TextDecoder(t.tag === 0x0c ? "utf-8" : "latin1").decode(v)
}

function time(b: Uint8Array, t: Tlv): string | null {
  const s = str(b, t)
  const m = t.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
  if (!m) return null
  const year = t.tag === 0x17 ? (Number(m[1]) >= 50 ? 1900 : 2000) + Number(m[1]) : Number(m[1])
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))).toISOString()
}

const NAME_OIDS: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SN",
  "2.5.4.42": "G",
  "2.5.4.10": "O",
  "2.5.4.12": "T",
  "1.2.643.3.131.1.1": "INN",
  "1.2.643.100.4": "INNLE",
  "1.2.643.100.1": "OGRN",
  "1.2.643.100.3": "SNILS",
}

function name(b: Uint8Array, t: Tlv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const set of kids(b, t)) {
    for (const atv of kids(b, set)) {
      const [o, v] = kids(b, atv)
      const key = NAME_OIDS[oid(b, o)]
      if (key) out[key] = str(b, v).trim()
    }
  }
  return out
}

export type CmsInfo = {
  signerName: string | null
  signerInn: string | null
  organization: string | null
  title: string | null
  certSerial: string | null
  certIssuer: string | null
  certValidFrom: string | null
  certValidTo: string | null
  signedAt: string | null
  detached: boolean
  digestOid: string | null
}

/** Разбор CMS SignedData (DER или base64/PEM): сведения о сертификате и времени подписания. */
export function parseCms(input: Uint8Array): CmsInfo {
  let der = input
  const asText = new TextDecoder("latin1").decode(input.subarray(0, 64))
  if (!(input[0] === 0x30) || /^[A-Za-z0-9+/=\s-]+$/.test(asText)) {
    const b64 = new TextDecoder("latin1").decode(input).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
    der = new Uint8Array(Buffer.from(b64, "base64"))
  }
  const root = readTlv(der, 0)
  const [ctOid, ctBody] = kids(der, root)
  if (!ctOid || oid(der, ctOid) !== "1.2.840.113549.1.7.2") throw new Error("Это не подпись CMS (SignedData)")
  const sd = kids(der, kids(der, ctBody)[0])
  // SignedData: version, digestAlgorithms, encapContentInfo, [0] certificates?, [1] crls?, signerInfos
  const encap = sd[2]
  const detached = kids(der, encap).length < 2
  const certSet = sd.find((x) => x.tag === 0xa0)
  const signerInfos = sd[sd.length - 1]
  const info: CmsInfo = { signerName: null, signerInn: null, organization: null, title: null, certSerial: null, certIssuer: null, certValidFrom: null, certValidTo: null, signedAt: null, detached, digestOid: null }
  const si = kids(der, signerInfos)[0]
  let sid: { serial?: string } = {}
  if (si) {
    const parts = kids(der, si)
    const issuerSerial = parts[1]
    if (issuerSerial?.tag === 0x30) {
      const serialTlv = kids(der, issuerSerial)[1]
      sid.serial = Buffer.from(der.subarray(serialTlv.start + serialTlv.hdr, serialTlv.end)).toString("hex").toUpperCase()
    }
    const digestAlg = parts[2]
    if (digestAlg) info.digestOid = oid(der, kids(der, digestAlg)[0])
    const signedAttrs = parts.find((p) => p.tag === 0xa0)
    if (signedAttrs) {
      for (const attr of kids(der, signedAttrs)) {
        const [o, set] = kids(der, attr)
        if (oid(der, o) === "1.2.840.113549.1.9.5") info.signedAt = time(der, kids(der, set)[0])
      }
    }
  }
  if (certSet) {
    const certs = kids(der, certSet)
    for (const c of certs) {
      const tbs = kids(der, kids(der, c)[0])
      const off = tbs[0].tag === 0xa0 ? 1 : 0
      const serial = Buffer.from(der.subarray(tbs[off].start + tbs[off].hdr, tbs[off].end)).toString("hex").toUpperCase()
      if (sid.serial && serial !== sid.serial && certs.length > 1) continue
      const issuer = name(der, tbs[off + 2])
      const validity = kids(der, tbs[off + 3])
      const subject = name(der, tbs[off + 4])
      info.certSerial = serial
      info.certIssuer = issuer.CN || issuer.O || null
      info.certValidFrom = time(der, validity[0])
      info.certValidTo = time(der, validity[1])
      info.signerName = [subject.SN, subject.G].filter(Boolean).join(" ") || subject.CN || null
      info.organization = subject.O || null
      info.title = subject.T || null
      info.signerInn = subject.INNLE || subject.INN || null
      break
    }
  }
  return info
}

/* ---------- операции ---------- */

export async function addOwnSignature(
  client: PoolClient,
  actor: Actor,
  documentId: string,
  input: { fileId: string; signatureBytes: Uint8Array; fileName?: string; poaNumber?: string | null }
) {
  requirePermission(actor, "edi.doc.sign")
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  const f = await client.query<{ version_no: number | null; kind: string }>(
    `SELECT version_no, kind FROM edi_files WHERE file_id = $1::bigint AND document_id = $2::bigint`,
    [input.fileId, documentId]
  )
  if (!f.rows[0]) throw new HttpError(400, "Подписываемый файл не принадлежит документу", "bad_file")
  if (f.rows[0].kind === "signature") throw new HttpError(400, "Нельзя подписать файл подписи", "bad_file")
  let info: CmsInfo
  try {
    info = parseCms(input.signatureBytes)
  } catch (e) {
    throw new HttpError(400, `Файл не является подписью CMS: ${e instanceof Error ? e.message : e}`, "bad_signature")
  }
  const sigFile = await saveFile(client, {
    siteId: actor.siteId,
    documentId,
    versionNo: doc.currentVersion,
    kind: "signature",
    fileName: input.fileName || `signature-${documentId}-v${doc.currentVersion}.sig`,
    bytes: input.signatureBytes,
    mime: "application/pkcs7-signature",
    uploadedBy: actor.userId,
  })
  const r = await client.query<{ signature_id: string }>(
    `INSERT INTO edi_signatures (site_id, document_id, version_no, signed_file_id, signature_file_id, kind, source, side, signer_name, signer_inn,
       signer_title, cert_serial, cert_issuer, cert_valid_from, cert_valid_to, poa_number, signed_at, created_by)
     VALUES ($1, $2::bigint, $3, $4::bigint, $5::bigint, $6, 'upload', 'own', $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15::timestamptz, now()), $16::bigint)
     RETURNING signature_id::text`,
    [
      actor.siteId, documentId, doc.currentVersion, input.fileId, sigFile.fileId, info.detached ? "cades_detached" : "cades_attached",
      info.signerName, info.signerInn, info.title, info.certSerial, info.certIssuer, info.certValidFrom, info.certValidTo,
      input.poaNumber?.trim() || null, info.signedAt, actor.userId,
    ]
  )
  await lockVersion(client, documentId, doc.currentVersion, "Подписано электронной подписью")
  const running = await client.query(`SELECT 1 FROM edi_workflow_instances WHERE document_id = $1::bigint AND status = 'running'`, [documentId])
  if (!running.rows[0] && ["approved", "signing"].includes(doc.status)) {
    // без маршрута: подпись согласованного документа переводит его в «Подписан»
    await touch(client, documentId, "signature.added", { status: "signed", signed_version: doc.currentVersion })
  } else {
    await touch(client, documentId, "signature.added")
  }
  await recordEvent(client, actorEvent(actor, "signature.added", documentId, { signer: info.signerName, serial: info.certSerial, version: doc.currentVersion }))
  const check = await verifySignature(client, actor.siteId, r.rows[0].signature_id)
  return { signatureId: r.rows[0].signature_id, info, check }
}

export type VerifyResult = { status: "valid" | "invalid" | "not_verified" | "error"; verifier: string; details: Record<string, unknown> }

/** Проверка: локальные структурные проверки + внешний сервис проверки, если он подключён. */
export async function verifySignature(client: PoolClient, siteId: number, signatureId: string): Promise<VerifyResult> {
  const s = await client.query<{ document_id: string; signed_file_id: string; signature_file_id: string; cert_valid_from: string | null; cert_valid_to: string | null; signed_at: string | null; signer_inn: string | null; author: string | null }>(
    `SELECT s.document_id::text, s.signed_file_id::text, s.signature_file_id::text, s.cert_valid_from::text, s.cert_valid_to::text, s.signed_at::text, s.signer_inn,
            d.author_user_id::text AS author
     FROM edi_signatures s JOIN edi_documents d ON d.document_id = s.document_id WHERE s.signature_id = $1::bigint AND s.site_id = $2`,
    [signatureId, siteId]
  )
  const sig = s.rows[0]
  if (!sig) throw new HttpError(404, "Подпись не найдена", "not_found")
  const local: Record<string, unknown> = {}
  const at = sig.signed_at ? Date.parse(sig.signed_at) : Date.now()
  local.certValidAtSigning = sig.cert_valid_from && sig.cert_valid_to ? at >= Date.parse(sig.cert_valid_from) && at <= Date.parse(sig.cert_valid_to) : null
  let result: VerifyResult
  if (local.certValidAtSigning === false) {
    result = { status: "invalid", verifier: "local", details: { ...local, message: "Сертификат не действовал на момент подписания" } }
  } else {
    const svc = await resolveIntegration(client, siteId, "signature")
    if (!svc || !svc.enabled || !svc.config.verifyUrl) {
      result = { status: "not_verified", verifier: "local", details: { ...local, message: "Структура подписи разобрана. Криптографическая проверка ГОСТ не выполнена: сервис проверки подписи не подключён." } }
    } else {
      try {
        const [doc, sigFile] = await Promise.all([readFileChecked(client, siteId, sig.signed_file_id), readFileChecked(client, siteId, sig.signature_file_id)])
        const res = await integrationFetch(String(svc.config.verifyUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(svc.secret ? { Authorization: `Bearer ${svc.secret}` } : {}) },
          body: JSON.stringify({ signature: Buffer.from(sigFile.bytes).toString("base64"), content: Buffer.from(doc.bytes).toString("base64"), detached: true }),
          signal: AbortSignal.timeout(20_000),
        })
        const body = (await res.json().catch(() => ({}))) as { valid?: boolean; message?: string; [k: string]: unknown }
        if (!res.ok || typeof body.valid !== "boolean") {
          result = { status: "error", verifier: svc.provider, details: { ...local, httpStatus: res.status, message: body.message ?? "Сервис проверки вернул неожиданный ответ" } }
        } else {
          result = { status: body.valid ? "valid" : "invalid", verifier: svc.provider, details: { ...local, ...body } }
        }
      } catch (e) {
        result = { status: "error", verifier: svc.provider, details: { ...local, message: e instanceof Error ? e.message : String(e) } }
      }
    }
  }
  await client.query(`INSERT INTO edi_signature_checks (signature_id, verifier, status, details) VALUES ($1::bigint, $2, $3, $4::jsonb)`, [
    signatureId,
    result.verifier,
    result.status,
    JSON.stringify(result.details),
  ])
  await client.query(`UPDATE edi_signatures SET verification_status = $2 WHERE signature_id = $1::bigint`, [signatureId, result.status])
  await recordEvent(client, { siteId, documentId: sig.document_id, actorName: "SCADA EDI", action: "signature.checked", details: { signatureId, status: result.status } })
  if (result.status === "invalid" && sig.author) {
    await notifyUsers(client, {
      siteId,
      userIds: [sig.author],
      event: "signature.invalid",
      title: "Подпись не прошла проверку",
      body: String(result.details.message ?? ""),
      documentId: sig.document_id,
      dedupeKey: `sig_invalid:${signatureId}`,
    })
  }
  return result
}

export async function listSignatures(client: PoolClient, documentId: string) {
  const r = await client.query(
    `SELECT s.signature_id::text AS "signatureId", s.version_no AS "versionNo", s.kind, s.source, s.side, s.signer_name AS "signerName",
            s.signer_inn AS "signerInn", s.signer_title AS "signerTitle", s.cert_serial AS "certSerial", s.cert_issuer AS "certIssuer",
            s.cert_valid_from AS "certValidFrom", s.cert_valid_to AS "certValidTo", s.poa_number AS "poaNumber", s.signed_at AS "signedAt",
            s.verification_status AS "verificationStatus", s.signed_file_id::text AS "signedFileId", s.signature_file_id::text AS "signatureFileId",
            (SELECT jsonb_build_object('verifier', c.verifier, 'status', c.status, 'details', c.details, 'checkedAt', c.checked_at)
               FROM edi_signature_checks c WHERE c.signature_id = s.signature_id ORDER BY c.check_id DESC LIMIT 1) AS "lastCheck"
     FROM edi_signatures s WHERE s.document_id = $1::bigint ORDER BY s.signature_id`,
    [documentId]
  )
  return r.rows
}

/** Для подписей контрагента, пришедших в архиве с документом: разобрать сертификат. */
export async function enrichImportedSignatures(client: PoolClient, siteId: number, documentId: string) {
  const r = await client.query<{ signature_id: string; signature_file_id: string }>(
    `SELECT signature_id::text, signature_file_id::text FROM edi_signatures WHERE document_id = $1::bigint AND cert_serial IS NULL`,
    [documentId]
  )
  for (const row of r.rows) {
    try {
      const f = await readFileChecked(client, siteId, row.signature_file_id)
      const info = parseCms(f.bytes)
      await client.query(
        `UPDATE edi_signatures SET signer_name = $2, signer_inn = $3, signer_title = $4, cert_serial = $5, cert_issuer = $6,
           cert_valid_from = $7, cert_valid_to = $8, signed_at = $9 WHERE signature_id = $1::bigint`,
        [row.signature_id, info.signerName, info.signerInn, info.title, info.certSerial, info.certIssuer, info.certValidFrom, info.certValidTo, info.signedAt]
      )
      await verifySignature(client, siteId, row.signature_id)
    } catch (e) {
      await client.query(`INSERT INTO edi_signature_checks (signature_id, verifier, status, details) VALUES ($1::bigint, 'local', 'error', $2::jsonb)`, [
        row.signature_id,
        JSON.stringify({ message: e instanceof Error ? e.message : String(e) }),
      ])
      await client.query(`UPDATE edi_signatures SET verification_status = 'error' WHERE signature_id = $1::bigint`, [row.signature_id])
    }
  }
}
