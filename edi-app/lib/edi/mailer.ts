import net from "node:net"
import tls from "node:tls"

/**
 * Отправка письма по SMTP без внешних библиотек: EDI_SMTP_URL=smtps://user:pass@host:465 (TLS)
 * или smtp://user:pass@host:587 (STARTTLS). Отправитель — EDI_MAIL_FROM.
 */
export function mailConfigured(): boolean {
  return Boolean(process.env.EDI_SMTP_URL?.trim() && process.env.EDI_MAIL_FROM?.trim())
}

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64")
}

function encodeHeader(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const url = new URL(process.env.EDI_SMTP_URL || "")
  const from = process.env.EDI_MAIL_FROM || ""
  const implicit = url.protocol === "smtps:"
  const port = Number(url.port || (implicit ? 465 : 587))
  let sock: net.Socket = implicit
    ? tls.connect({ host: url.hostname, port, servername: url.hostname })
    : net.connect({ host: url.hostname, port })
  sock.setTimeout(20_000)
  let buf = ""
  let waiter: ((line: string) => void) | null = null
  const attach = (s: net.Socket) => {
    s.on("data", (d) => {
      buf += d.toString("utf8")
      let idx
      while ((idx = buf.search(/\r\n/)) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        if (/^\d{3} /.test(line) && waiter) {
          const w = waiter
          waiter = null
          w(line)
        }
      }
    })
  }
  attach(sock)
  const read = () =>
    new Promise<string>((resolve, reject) => {
      waiter = resolve
      sock.once("error", reject)
      sock.once("timeout", () => reject(new Error("SMTP timeout")))
    })
  const cmd = async (line: string | null, expect: number) => {
    if (line != null) sock.write(line + "\r\n")
    const resp = await read()
    if (Number(resp.slice(0, 3)) !== expect) throw new Error(`SMTP: ${resp}`)
    return resp
  }
  try {
    await cmd(null, 220)
    await cmd(`EHLO scada-edi`, 250)
    if (!implicit) {
      await cmd("STARTTLS", 220)
      sock.removeAllListeners("data")
      sock = tls.connect({ socket: sock, servername: url.hostname })
      attach(sock)
      await cmd(`EHLO scada-edi`, 250)
    }
    if (url.username) {
      await cmd("AUTH LOGIN", 334)
      await cmd(b64(decodeURIComponent(url.username)), 334)
      await cmd(b64(decodeURIComponent(url.password)), 235)
    }
    await cmd(`MAIL FROM:<${from}>`, 250)
    await cmd(`RCPT TO:<${to}>`, 250)
    await cmd("DATA", 354)
    const body = [
      `From: SCADA EDI <${from}>`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64(text).replace(/.{76}/g, "$&\r\n"),
      ".",
    ].join("\r\n")
    await cmd(body, 250)
    sock.write("QUIT\r\n")
  } finally {
    sock.end()
  }
}
