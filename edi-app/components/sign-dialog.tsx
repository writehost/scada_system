"use client"

import { KeyRound, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { api, fmtDate } from "./api"
import type { Detail } from "./document-card"
import { Badge, Button, cn, ErrorLine, Field, Input, Modal, Select, Spinner, toast } from "./ui"

type Cert = { thumbprint: string; name: string; issuerName: string; validTo: string; isValid: boolean }

/** ГОСТ Р 34.11-2012: 101 — 256 бит, 102 — 512 бит (константы CAdESCOM, как в lib/crypto-pro-sign.ts WMS). */
const HASH_256 = 101
const HASH_512 = 102

export function SignDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: () => void }) {
  const d = detail.document
  const initial = detail.files.filter((f) => f.kind !== "signature" && (f.versionNo == null || f.versionNo === d.currentVersion || f.kind === "original"))
  const [files, setFiles] = useState(initial.map((f) => ({ fileId: f.fileId, fileName: f.fileName, kind: f.kind })))
  const [fileId, setFileId] = useState(initial.find((f) => f.kind === "original")?.fileId ?? initial[0]?.fileId ?? "")
  const [mode, setMode] = useState<"plugin" | "file">("plugin")
  const [certs, setCerts] = useState<Cert[] | null>(null)
  const [thumb, setThumb] = useState("")
  const [poa, setPoa] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const sigInput = useRef<HTMLInputElement>(null)

  const freeze = async () => {
    setBusy(true)
    try {
      const r = await api<{ fileId: string }>(`/api/edi/documents/${d.documentId}/action`, { method: "POST", json: { action: "freeze_version" } })
      const name = `document-${d.documentId}-v${d.currentVersion}.json`
      setFiles((f) => (f.some((x) => x.fileId === r.fileId) ? f : [...f, { fileId: r.fileId, fileName: name, kind: "version" }]))
      setFileId(r.fileId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const loadCerts = async () => {
    setError("")
    setBusy(true)
    try {
      const { getUserCertificates } = await import("crypto-pro")
      const list = await getUserCertificates()
      const out: Cert[] = []
      for (const c of list) {
        let valid = false
        try {
          valid = await c.isValid()
        } catch {
          valid = false
        }
        out.push({ thumbprint: c.thumbprint, name: c.name, issuerName: c.issuerName, validTo: c.validTo, isValid: valid })
      }
      setCerts(out)
      setThumb(out.find((c) => c.isValid)?.thumbprint ?? "")
      if (!out.length) setError("Сертификаты не найдены. Подключите носитель ключа.")
    } catch (e) {
      setError(`КриптоПро ЭЦП Browser plug-in недоступен: ${e instanceof Error ? e.message : String(e)}. Установите плагин или загрузите файл подписи, созданный другой программой.`)
    } finally {
      setBusy(false)
    }
  }

  const signWithPlugin = async () => {
    setError("")
    setBusy(true)
    try {
      const { createDetachedSignature, createHash, getCertificate } = await import("crypto-pro")
      const cert = await getCertificate(thumb)
      const algo = await cert.getAlgorithm()
      const oid = String(algo?.oid ?? "")
      const hashedAlgorithm = oid.startsWith("1.2.643.7.1.1.1.2") || /512/.test(String(algo?.algorithm ?? "")) ? HASH_512 : HASH_256
      const bytes = await (await fetch(`/api/edi/files/${fileId}`)).arrayBuffer()
      const hash = await createHash(bytes, { hashedAlgorithm })
      const signatureBase64 = await createDetachedSignature(thumb, hash, { hashedAlgorithm })
      await api(`/api/edi/documents/${d.documentId}/signatures`, { method: "POST", json: { fileId, signatureBase64, poaNumber: poa || undefined } })
      toast("Подпись добавлена")
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const uploadSig = async (f: File) => {
    setError("")
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("signature", f)
      fd.append("fileId", fileId)
      if (poa) fd.append("poaNumber", poa)
      await api(`/api/edi/documents/${d.documentId}/signatures`, { method: "POST", body: fd })
      toast("Подпись добавлена")
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Подписать электронной подписью" onClose={onClose} wide>
      <div className="space-y-3">
        <Field label="Что подписываем" hint="Подпись ставится на конкретный файл; печатная форма — отдельное представление и не подписывается вместо оригинала.">
          {files.length ? (
            <Select value={fileId} onChange={(e) => setFileId(e.target.value)}>
              {files.map((f) => (
                <option key={f.fileId} value={f.fileId}>{f.kind === "original" ? "Оригинал" : f.kind === "version" ? "Файл версии" : "Вложение"}: {f.fileName}</option>
              ))}
            </Select>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Документ создан в системе и не имеет файла.
              <Button size="sm" busy={busy} onClick={freeze}>Сформировать файл версии {d.currentVersion}</Button>
            </div>
          )}
        </Field>
        {files.length > 0 && !files.some((f) => f.kind === "version") && d.source !== "import" && (
          <button className="text-xs text-muted-foreground underline" onClick={freeze}>Сформировать файл текущей версии (JSON реквизитов)</button>
        )}
        <Field label="Номер МЧД (если подписывает представитель)">
          <Input value={poa} onChange={(e) => setPoa(e.target.value)} placeholder="необязательно" />
        </Field>
        <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-[13px]">
          {(["plugin", "file"] as const).map((m) => (
            <button key={m} className={cn("h-7 flex-1 rounded-md", mode === m && "bg-card font-semibold shadow-sm")} onClick={() => setMode(m)}>
              {m === "plugin" ? "КриптоПро ЭЦП Browser plug-in" : "Файл подписи (.sig, .p7s)"}
            </button>
          ))}
        </div>
        {mode === "plugin" ? (
          <div className="space-y-2">
            {!certs && <Button busy={busy} icon={<KeyRound className="size-4" />} onClick={loadCerts} disabled={!fileId}>Выбрать сертификат</Button>}
            {certs && (
              <div className="max-h-56 space-y-1 overflow-auto">
                {certs.map((c) => (
                  <label key={c.thumbprint} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs", thumb === c.thumbprint ? "border-ring" : "border-border", !c.isValid && "opacity-60")}>
                    <input type="radio" name="cert" checked={thumb === c.thumbprint} onChange={() => setThumb(c.thumbprint)} disabled={!c.isValid} />
                    <span className="min-w-0">
                      <span className="block font-medium">{c.name}</span>
                      <span className="block truncate text-muted-foreground">{c.issuerName}</span>
                      <span className="text-muted-foreground">до {fmtDate(c.validTo)}</span> {!c.isValid && <Badge tone="danger">недействителен</Badge>}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {certs && certs.length > 0 && <Button variant="primary" busy={busy} disabled={!thumb || !fileId} onClick={signWithPlugin}>Подписать</Button>}
          </div>
        ) : (
          <div>
            <input ref={sigInput} type="file" hidden accept=".sig,.p7s,.sgn" onChange={(e) => e.target.files?.[0] && void uploadSig(e.target.files[0])} />
            <Button busy={busy} disabled={!fileId} icon={<Upload className="size-4" />} onClick={() => sigInput.current?.click()}>Загрузить откреплённую подпись</Button>
            <p className="mt-1 text-xs text-muted-foreground">Подпись должна быть создана для выбранного файла (CAdES, откреплённая). После загрузки сведения о сертификате проверяются автоматически.</p>
          </div>
        )}
        {busy && !certs && mode === "plugin" && <Spinner />}
        <ErrorLine error={error} />
      </div>
    </Modal>
  )
}
