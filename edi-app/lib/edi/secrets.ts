import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

/**
 * Секреты внешних провайдеров (токены WMS, ключи операторов ЭДО, секреты вебхуков) хранятся
 * в БД только зашифрованными AES-256-GCM. Ключ — EDI_SECRET_KEY (в БД не попадает).
 */
function key(): Buffer {
  const raw = (process.env.EDI_SECRET_KEY || "").trim()
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("EDI_SECRET_KEY is not set")
    return createHash("sha256").update("dev-edi-secret-key").digest()
  }
  return createHash("sha256").update(raw).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return ""
  const [v, iv, tag, data] = value.split(".")
  if (v !== "v1" || !iv || !tag || !data) throw new Error("bad secret format")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}

export function maskSecret(value: string): string {
  return value ? `${value.slice(0, 5)}…${value.slice(-2)}` : ""
}
