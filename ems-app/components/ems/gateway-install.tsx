"use client"

import { useEffect, useState } from "react"
import { Copy } from "lucide-react"
import { dateTimeRu } from "@/lib/client/format"
import { Badge, Button, Notice } from "@/components/ui"

export function GatewayInstall({ code, expiresAt }: { code: string; expiresAt: string }) {
  const [origin, setOrigin] = useState("https://ems.example")
  useEffect(() => setOrigin(window.location.origin), [])
  const config = JSON.stringify({ cloudUrl: origin, dataDir: "/var/lib/scada-ems-gateway", bufferMaxMb: 200 }, null, 2)
  const script = [
    "# Компьютер в локальной сети приборов, Node.js 18+",
    "sudo useradd --system --no-create-home --shell /usr/sbin/nologin scada-ems",
    "sudo mkdir -p /opt/scada-ems-gateway /etc/scada-ems-gateway /var/lib/scada-ems-gateway",
    "sudo chown scada-ems:scada-ems /var/lib/scada-ems-gateway && sudo chmod 700 /var/lib/scada-ems-gateway",
    "sudo cp -r ems-gateway/* /opt/scada-ems-gateway/",
    `echo '${config.replace(/\n\s*/g, " ")}' | sudo tee /etc/scada-ems-gateway/config.json`,
    `sudo -u scada-ems EMS_GATEWAY_CONFIG=/etc/scada-ems-gateway/config.json node /opt/scada-ems-gateway/src/cli.mjs enroll ${code}`,
    "sudo cp /opt/scada-ems-gateway/scada-ems-gateway.service /etc/systemd/system/",
    "sudo systemctl enable --now scada-ems-gateway",
  ].join("\n")
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/40 bg-primary/10 p-3">
        <p className="text-xs text-muted-foreground">Одноразовый код регистрации</p>
        <p className="ems-num select-all font-mono text-xl font-semibold tracking-wider">{code}</p>
        <p className="text-xs text-muted-foreground">Действует до {dateTimeRu(expiresAt)}. После использования код недействителен — повторная попытка будет зафиксирована как событие безопасности.</p>
      </div>
      <div className="relative">
        <pre className="max-w-full overflow-x-auto rounded-xl bg-[oklch(0.22_0.02_145)] p-3 text-[12px] leading-relaxed text-[oklch(0.95_0.01_90)]">{script}</pre>
        <Button size="sm" variant="secondary" className="absolute right-2 top-2" onClick={() => navigator.clipboard?.writeText(script)}>
          <Copy /> Копировать
        </Button>
      </div>
      <Notice>Шлюз только читает регистры (функции Modbus 03/04) и не управляет оборудованием. Связь — исходящий HTTPS; при обрыве данные копятся в локальном буфере (по умолчанию 200 МБ).</Notice>
    </div>
  )
}

export function GatewayStatus({ status }: { status: string }) {
  return <Badge tone={status === "online" ? "success" : status === "pending" ? "warning" : status === "offline" ? "danger" : "neutral"}>{status === "online" ? "на связи" : status === "pending" ? "ожидает регистрации" : status === "offline" ? "нет связи" : "отключён"}</Badge>
}

