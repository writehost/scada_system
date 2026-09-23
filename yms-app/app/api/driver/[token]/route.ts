import { NextResponse } from "next/server"
import { acknowledgeDriverCall, publicDriverCard } from "@/lib/wms/yms/ops"
import { ensureYmsSchema } from "@/lib/wms/yms/schema"
import { tryGetPool } from "@/lib/wms/pool"
import { STATUS_LABEL } from "@/lib/wms/yms/state-machine"
import type { YmsStatus } from "@/lib/wms/yms/state-machine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ token: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  return read(ctx, false)
}

export async function POST(_req: Request, ctx: Ctx) {
  return read(ctx, true)
}

async function read(ctx: Ctx, ack: boolean) {
  const { token } = await ctx.params
  if (!/^[a-f0-9]{20,}$/i.test(token)) {
    return NextResponse.json({ error: "ссылка недействительна" }, { status: 404 })
  }
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "база недоступна" }, { status: 503 })
  const client = await pool.connect()
  try {
    await ensureYmsSchema(client)
    if (ack) await acknowledgeDriverCall(client, token)
    const card = await publicDriverCard(client, token)
    if (!card) return NextResponse.json({ error: "визит не найден" }, { status: 404 })
    const status = card.visit.status
    return NextResponse.json({
      visitNo: card.visit.visitNo,
      plate: card.visit.plate,
      trailerPlate: card.visit.trailerPlate,
      driverName: card.visit.driverName,
      status: status in STATUS_LABEL ? STATUS_LABEL[status as YmsStatus] : status,
      operation: card.visit.operation === "OUTBOUND" ? "Отгрузка" : card.visit.operation === "INBOUND" ? "Приёмка" : card.visit.operation,
      parkingCode: card.visit.parkingCode,
      dockCode: card.visit.dockCode,
      instruction: card.call?.message ?? null,
      sentAt: card.call?.sentAt ?? null,
      deliveredAt: card.call?.deliveredAt ?? null,
      acknowledgedAt: card.call?.acknowledgedAt ?? null,
      deliveryNote: card.call ? "Канал табло. Доставка SMS не подтверждается." : null,
    })
  } finally {
    client.release()
  }
}
