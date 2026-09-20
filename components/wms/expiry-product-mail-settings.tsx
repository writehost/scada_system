"use client"

import { useEffect, useState } from "react"
import { Loader2, Mail, Save, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  EXPIRY_MAIL_TIME_ZONES,
  DEFAULT_EXPIRY_MAIL_SEND_HOUR,
  DEFAULT_EXPIRY_MAIL_TIME_ZONE,
  expiryMailTimeZoneShort,
  formatDateTimeInTimeZone,
  formatSendHour,
} from "@/lib/wms/expiry-mail-schedule"
import {
  getExpiryProductMailSettings,
  saveExpiryProductMailSettings,
  sendExpiryProductMail,
  type WmsExpiryProductMailSettings,
  type WmsExpiryStickerAlert,
} from "@/lib/wms-api"

const EMPTY_MAIL: WmsExpiryProductMailSettings = {
  enabled: true,
  recipients: [],
  includeWarning: false,
  includeCritical: true,
  includeExpired: true,
  timeZone: DEFAULT_EXPIRY_MAIL_TIME_ZONE,
  sendHour: DEFAULT_EXPIRY_MAIL_SEND_HOUR,
  lastSentAt: null,
  lastSentCount: 0,
  lastError: null,
  lastSkipReason: null,
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

function formatLastSent(iso: string | null, timeZone: string): string {
  if (!iso) return "ещё не отправляли"
  const formatted = formatDateTimeInTimeZone(iso, timeZone)
  if (!formatted) return iso
  return `${formatted} (${expiryMailTimeZoneShort(timeZone)})`
}

function skipReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  if (reason === "no_alerts") return "Письмо не ушло: просроченных партий нет — после списания рассылка останавливается."
  if (reason === "no_recipients") return "Нет адресов в пуле — укажите получателей."
  if (reason === "disabled") return "Рассылка выключена."
  if (reason === "already_sent_today") return "Сегодня письмо уже отправляли."
  if (reason === "too_early") return "Ещё рано для ежедневной рассылки."
  if (reason === "send_failed") return "Последняя отправка не прошла."
  return reason
}

export function ExpiryProductMailSettings() {
  const [mail, setMail] = useState<WmsExpiryProductMailSettings>(EMPTY_MAIL)
  const [recipientsText, setRecipientsText] = useState("")
  const [previewCount, setPreviewCount] = useState(0)
  const [previewAlerts, setPreviewAlerts] = useState<WmsExpiryStickerAlert[]>([])
  const [mailLoading, setMailLoading] = useState(true)
  const [mailSaving, setMailSaving] = useState(false)
  const [mailSending, setMailSending] = useState(false)
  const [mailStatus, setMailStatus] = useState<string | null>(null)
  const [mailError, setMailError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    async function loadMail() {
      setMailLoading(true)
      try {
        const data = await getExpiryProductMailSettings()
        if (ignore) return
        setMail(data.settings)
        setRecipientsText((data.settings.recipients || []).join("\n"))
        setPreviewCount(data.previewCount)
        setPreviewAlerts(data.previewAlerts || [])
        setMailError(null)
      } catch (e) {
        if (!ignore) setMailError(e instanceof Error ? e.message : "Не удалось загрузить настройки рассылки")
      } finally {
        if (!ignore) setMailLoading(false)
      }
    }
    loadMail()
    return () => {
      ignore = true
    }
  }, [])

  function applyMail(next: WmsExpiryProductMailSettings, count?: number, alerts?: WmsExpiryStickerAlert[]) {
    setMail(next)
    setRecipientsText((next.recipients || []).join("\n"))
    if (typeof count === "number") setPreviewCount(count)
    if (alerts) setPreviewAlerts(alerts)
  }

  function schedulePayload() {
    return {
      enabled: mail.enabled,
      includeWarning: mail.includeWarning,
      includeCritical: mail.includeCritical,
      includeExpired: mail.includeExpired,
      timeZone: mail.timeZone || DEFAULT_EXPIRY_MAIL_TIME_ZONE,
      sendHour: mail.sendHour ?? DEFAULT_EXPIRY_MAIL_SEND_HOUR,
      recipientsText,
    }
  }

  async function saveMail() {
    setMailSaving(true)
    setMailError(null)
    setMailStatus(null)
    try {
      const result = await saveExpiryProductMailSettings(schedulePayload())
      applyMail(result.settings)
      const preview = await getExpiryProductMailSettings()
      applyMail(preview.settings, preview.previewCount, preview.previewAlerts)
      setMailStatus(
        preview.previewCount > 0
          ? `Сохранено. Сейчас в письмо попадёт ${preview.previewCount} позиц.`
          : "Сохранено. Просроченных партий нет — ежедневное письмо не уйдёт, пока снова не появится остаток."
      )
    } catch (e) {
      setMailError(e instanceof Error ? e.message : "Не удалось сохранить настройки")
    } finally {
      setMailSaving(false)
    }
  }

  async function sendMailNow() {
    setMailSending(true)
    setMailError(null)
    setMailStatus(null)
    try {
      const saved = await saveExpiryProductMailSettings(schedulePayload())
      applyMail(saved.settings)
      const result = await sendExpiryProductMail({ force: true })
      applyMail(result.settings)
      if (result.skipped) {
        setMailStatus(skipReasonLabel(result.reason || result.settings.lastSkipReason) || "Письмо не отправлено")
      } else {
        setMailStatus(
          `Письмо ушло на ${result.sentCount} ${result.sentCount === 1 ? "адрес" : "адреса"} · ${result.alertCount} позиц.`
        )
      }
      const preview = await getExpiryProductMailSettings()
      applyMail(preview.settings, preview.previewCount, preview.previewAlerts)
    } catch (e) {
      setMailError(e instanceof Error ? e.message : "Не удалось отправить письмо")
    } finally {
      setMailSending(false)
    }
  }

  const parsedRecipients = recipientsText
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean)
  const zoneShort = expiryMailTimeZoneShort(mail.timeZone || DEFAULT_EXPIRY_MAIL_TIME_ZONE)
  const sendAt = formatSendHour(mail.sendHour ?? DEFAULT_EXPIRY_MAIL_SEND_HOUR)

  return (
    <section className="rounded-xl border border-rose-200 bg-[#fdf4f2] p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Mail className="h-5 w-5 text-rose-700" />
        <h3 className="text-lg font-bold text-rose-900">Уведомление о просроченной продукции на складе</h3>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-rose-900/80">
        Каждый день в {sendAt} ({zoneShort}) на пул адресов уходит сводка по просрочке — тем же карточкам, что выше.
        Пока партию не спишут, письмо повторяется. Отправитель: support@scada25.ru (почта GSMT).
      </p>

      {mailLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем настройки…
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <label className="flex items-start gap-3 rounded-xl border border-rose-200 bg-white/70 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={mail.enabled}
                onChange={(e) => setMail((current) => ({ ...current, enabled: e.target.checked }))}
              />
              <span>
                <span className="font-medium">Включить ежедневную рассылку</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Без галочки утренний таймер письмо не отправит. «Отправить сейчас» работает и так.
                </span>
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-2 block font-medium">Часовой пояс</span>
                <select
                  value={mail.timeZone || DEFAULT_EXPIRY_MAIL_TIME_ZONE}
                  onChange={(e) => setMail((current) => ({ ...current, timeZone: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-rose-200 bg-white px-3 text-sm"
                >
                  {EXPIRY_MAIL_TIME_ZONES.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-2 block font-medium">Время рассылки</span>
                <select
                  value={mail.sendHour ?? DEFAULT_EXPIRY_MAIL_SEND_HOUR}
                  onChange={(e) => setMail((current) => ({ ...current, sendHour: Number(e.target.value) }))}
                  className="h-10 w-full rounded-xl border border-rose-200 bg-white px-3 text-sm"
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatSendHour(hour)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Пул адресов</div>
              <Textarea
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                placeholder={"ivan@zavod.ru\nsklad@zavod.ru"}
                className="min-h-28 rounded-xl bg-white"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Один адрес на строку. Сейчас в пуле {parsedRecipients.length}.
              </p>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Что включать в письмо</div>
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
                <label className="flex items-center gap-2 rounded-xl border border-rose-200 bg-white/70 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={mail.includeExpired}
                    onChange={(e) => setMail((current) => ({ ...current, includeExpired: e.target.checked }))}
                  />
                  Просрочка (срок вышел)
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-rose-200 bg-white/70 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={mail.includeCritical}
                    onChange={(e) => setMail((current) => ({ ...current, includeCritical: e.target.checked }))}
                  />
                  Срок стикера на исходе
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-rose-200 bg-white/70 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={mail.includeWarning}
                    onChange={(e) => setMail((current) => ({ ...current, includeWarning: e.target.checked }))}
                  />
                  Предупреждение
                </label>
              </div>
            </div>

            {mailError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {mailError}
              </div>
            )}
            {mailStatus && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-primary">{mailStatus}</div>
            )}
            {mail.lastError && !mailError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Последняя ошибка отправки: {mail.lastError}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={() => void saveMail()}
                disabled={mailSaving || mailSending}
                className="rounded-xl"
                variant="outline"
              >
                <Save className="mr-2 h-4 w-4" />
                {mailSaving ? "Сохраняем…" : "Сохранить настройки"}
              </Button>
              <Button
                type="button"
                onClick={() => void sendMailNow()}
                disabled={mailSaving || mailSending || parsedRecipients.length === 0}
                className="rounded-xl bg-rose-700 text-white hover:bg-rose-800"
              >
                <Send className="mr-2 h-4 w-4" />
                {mailSending ? "Отправляем…" : "Отправить сейчас"}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-rose-200 bg-white/80 p-4 text-sm">
              <div className="font-medium">Статус</div>
              <p className="mt-2 text-muted-foreground">
                Последняя рассылка: {formatLastSent(mail.lastSentAt, mail.timeZone || DEFAULT_EXPIRY_MAIL_TIME_ZONE)}
              </p>
              <p className="mt-1 text-muted-foreground">В прошлый раз в письме было {mail.lastSentCount} позиц.</p>
              {skipReasonLabel(mail.lastSkipReason) && (
                <p className="mt-2 text-muted-foreground">{skipReasonLabel(mail.lastSkipReason)}</p>
              )}
              <p className="mt-3 font-medium text-rose-900">
                Сейчас под фильтр попадает {previewCount}{" "}
                {previewCount === 1 ? "позиция" : previewCount >= 2 && previewCount <= 4 ? "позиции" : "позиций"}
              </p>
            </div>

            <div className="rounded-xl border border-rose-200 bg-white/80 p-4">
              <div className="mb-2 text-sm font-medium">Что уйдёт в письмо</div>
              {previewAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Просроченных партий нет. После списания рассылка сама замолкает.
                </p>
              ) : (
                <div className="max-h-64 space-y-2 overflow-auto pr-1">
                  {previewAlerts.map((alert, index) => {
                    const loc = String(alert.locationCode || "").trim()
                    const name = String(alert.itemName || alert.itemCode || "Позиция")
                    const tier = String(alert.tier || "")
                    return (
                      <div
                        key={`${alert.itemCode}-${alert.lotCode}-${loc}-${index}`}
                        className="rounded-lg border border-rose-100 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{loc ? `Ячейка ${loc}` : name}</span>
                          <Badge variant="secondary" className="rounded-lg">
                            {tier === "expired" ? "просрочка" : tier === "critical" ? "срок стикера" : "предупреждение"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {name}
                          {alert.qty != null ? ` · ${alert.qty} шт.` : ""}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
