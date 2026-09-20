/**
 * Подпись строки через КриптоПро ЭЦП Browser plug-in (расширение браузера).
 * Работает только в браузере при установленном расширении КриптоПро.
 * Для единой аутентификации ГИС МТ (Честный ЗНАК) — присоединённая подпись строки data.
 */

import { humanizeCryptoProError } from "@/lib/crypto-pro-errors"

export type CryptoProCertInfo = {
  thumbprint: string
  name: string
  subjectName: string
  issuerName: string
  validFrom: string
  validTo: string
  isValid: boolean
}

export type CryptoProCertsResult =
  | { ok: true; certificates: CryptoProCertInfo[] }
  | { ok: false; error: string }

export type CryptoProSignResult =
  | { ok: true; signatureBase64: string }
  | { ok: false; error: string }

/**
 * Возвращает список доступных сертификатов для выбора организации.
 */
export async function getCryptoProCertificates(): Promise<CryptoProCertsResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "КриптоПро доступен только в браузере" }
  }
  try {
    const { getUserCertificates } = await import("crypto-pro")
    const certs = await getUserCertificates()
    if (!certs || certs.length === 0) {
      return { ok: false, error: "Не найдены сертификаты. Установите КриптоПро ЭЦП Browser plug-in и сертификат." }
    }
    const list = await Promise.all(
      certs.map(async (c) => {
        let valid = false
        try {
          valid = await c.isValid()
        } catch {
          valid = false
        }
        return {
          thumbprint: c.thumbprint,
          name: c.name,
          subjectName: c.subjectName,
          issuerName: c.issuerName,
          validFrom: c.validFrom,
          validTo: c.validTo,
          isValid: valid,
        }
      })
    )
    return { ok: true, certificates: list }
  } catch (e) {
    return { ok: false, error: humanizeCryptoProError(e) }
  }
}

/**
 * Подписывает строку data через КриптоПро (присоединённая подпись, base64).
 * thumbprint — отпечаток выбранного сертификата (из getCryptoProCertificates).
 */
export async function signDataWithCryptoPro(data: string, thumbprint: string): Promise<CryptoProSignResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "КриптоПро доступен только в браузере" }
  }
  try {
    const { createAttachedSignature } = await import("crypto-pro")
    const signature = await createAttachedSignature(thumbprint, data)
    if (!signature || typeof signature !== "string") {
      return { ok: false, error: "Подпись не получена" }
    }
    return { ok: true, signatureBase64: signature }
  } catch (e) {
    return { ok: false, error: humanizeCryptoProError(e) }
  }
}

/** ГОСТ Р 34.11-2012 (crypto-pro / CADES), см. cades-constants */
const HASH_GOST_2012_256 = 101
const HASH_GOST_2012_512 = 102

function utf8JsonToArrayBuffer(jsonUtf8: string): ArrayBuffer {
  const utf8Bytes = new TextEncoder().encode(jsonUtf8)
  return utf8Bytes.buffer.slice(utf8Bytes.byteOffset, utf8Bytes.byteOffset + utf8Bytes.byteLength)
}

export type WaterBffDetachedHashBits = 256 | 512

/**
 * Серийный номер сертификата в том же виде, что cookie `certSerial` на water.crpt.ru (hex без пробелов).
 * На localhost cookie с ЧЗ недоступна — подставляем из выбранного КЭП при подписании.
 */
export async function getCertificateSerialForCrptCookie(thumbprint: string): Promise<string | null> {
  if (typeof window === "undefined") return null
  try {
    const { getCertificate } = await import("crypto-pro")
    const cert = await getCertificate(thumbprint)
    const raw = await cert.getCadesProp("SerialNumber")
    if (raw == null || raw === undefined) return null
    const compact = String(raw).replace(/\s/g, "").replace(/-/g, "")
    if (!compact) return null
    return /^[0-9a-fA-F]+$/.test(compact) ? compact.toUpperCase() : compact
  } catch {
    return null
  }
}

/** ИНН из subject сертификата (для сверки с participant_inn в документе). */
export async function getCertificateSubjectInn(thumbprint: string): Promise<string | null> {
  if (typeof window === "undefined") return null
  try {
    const { getCertificate } = await import("crypto-pro")
    const cert = await getCertificate(thumbprint)
    const subj = cert.subjectName || ""
    const m =
      subj.match(/ИНН=(\d{10,12})\b/i) ||
      subj.match(/INN=(\d{10,12})\b/i) ||
      subj.match(/TIN=(\d{10,12})\b/i)
    if (m) return m[1]
    const tags = await cert.getOwnerInfo()
    for (const t of tags) {
      if (!/ИНН/i.test(t.title)) continue
      const d = String(t.description ?? "")
      const dM = d.match(/\d{10,12}/)
      if (dM) return dM[0]
    }
    return null
  } catch {
    return null
  }
}

/** По алгоритму ключа сертификата подбирает длину ГОСТ-хеша для откреплённой подписи (иначе проверка на стороне ГИС МТ не сходится). */
export async function inferDetachedHashBitsFromThumbprint(thumbprint: string): Promise<WaterBffDetachedHashBits | null> {
  if (typeof window === "undefined") return null
  try {
    const { getCertificate } = await import("crypto-pro")
    const cert = await getCertificate(thumbprint)
    const algo = await cert.getAlgorithm()
    const name = `${algo?.algorithm ?? ""}`.toLowerCase()
    const oid = `${algo?.oid ?? ""}`.trim().toLowerCase()
    const combined = `${name} ${oid}`
    if (combined.includes("512")) return 512
    if (combined.includes("256")) return 256
    /* Распространённые OID ключей ГОСТ 2012: 256 бит — ветка 1.2.643.7.1.1.*, 512 — 1.2.643.7.1.2.* */
    if (oid.startsWith("1.2.643.7.1.2")) return 512
    if (oid.startsWith("1.2.643.7.1.1")) return 256
    return null
  } catch {
    return null
  }
}

/**
 * Подпись для Water BFF (`water.crpt.ru/bff-elk/v1/documents/create`): откреплённая PKCS#7 по ГОСТ-хешу тел документа.
 * Хеш считается по тем же UTF-8 байтам, что кодируются в поле `content` (base64).
 * Алгоритм хеша должен соответствовать ключевой паре сертификата (ГОСТ 256 или 512); иначе проверка на сервере не проходит.
 */
export async function signWaterBffDocumentDetached(
  jsonUtf8: string,
  thumbprint: string,
  options?: { hashBits?: WaterBffDetachedHashBits }
): Promise<CryptoProSignResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "КриптоПро доступен только в браузере" }
  }
  const bits = options?.hashBits ?? 256
  const hashedAlgorithm = bits === 512 ? HASH_GOST_2012_512 : HASH_GOST_2012_256
  try {
    const { createDetachedSignature, createHash } = await import("crypto-pro")
    const hashInput = utf8JsonToArrayBuffer(jsonUtf8)
    const hash = await createHash(hashInput, { hashedAlgorithm })
    const signature = await createDetachedSignature(thumbprint, hash, { hashedAlgorithm })
    if (!signature || typeof signature !== "string") {
      return { ok: false, error: "Подпись не получена" }
    }
    return { ok: true, signatureBase64: signature }
  } catch (e) {
    return { ok: false, error: humanizeCryptoProError(e) }
  }
}

/**
 * Присоединённая подпись по сырым UTF-8 байтам JSON (дольше альтернатива detached).
 */
export async function signWaterBffDocumentAttachedUtf8(jsonUtf8: string, thumbprint: string): Promise<CryptoProSignResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "КриптоПро доступен только в браузере" }
  }
  try {
    const { createAttachedSignature } = await import("crypto-pro")
    const messageBuf = utf8JsonToArrayBuffer(jsonUtf8)
    const signature = await createAttachedSignature(thumbprint, messageBuf)
    if (!signature || typeof signature !== "string") {
      return { ok: false, error: "Подпись не получена" }
    }
    return { ok: true, signatureBase64: signature }
  } catch (e) {
    return { ok: false, error: humanizeCryptoProError(e) }
  }
}
