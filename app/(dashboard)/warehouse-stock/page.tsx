"use client"

import Link from "next/link"
import { Boxes, ChevronRight, Factory, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
const WAREHOUSES = [
  {
    href: "/warehouse-stock/materials",
    title: "Склад материалов",
    description: "Объёмно-сортовой учёт: номенклатура, остатки, сроки годности и статус ЧЗ.",
    icon: Boxes,
    iconColor: "bg-chart-3/15 text-chart-3",
    badge: "OS / MAT",
  },
  {
    href: "/warehouse-stock/workshop",
    title: "Цех",
    description: "Остатки на линиях и в точках ожидания: стикеры и материалы, выданные в производство.",
    icon: Factory,
    iconColor: "bg-amber-500/15 text-amber-700",
    badge: "LINE",
  },
  {
    href: "/warehouse-stock/finished-goods",
    title: "Склад готовой продукции",
    description: "Сериализованный учёт: бутылки, блоки и палеты по кодам маркировки ЧЗ.",
    icon: Truck,
    iconColor: "bg-primary/10 text-primary",
    badge: "FG",
  },
] as const

export default function WarehouseStockHubPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Склад</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Выберите склад: материалы, цех (линии и точки ожидания) или готовая продукция (сериализованный учёт по
          кодам маркировки).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {WAREHOUSES.map((wh) => (
          <Link
            key={wh.href}
            href={wh.href}
            className="group rounded-2xl bg-card p-5 shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <div className="flex items-start justify-between gap-3">
              <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", wh.iconColor)}>
                <wh.icon className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="rounded-md font-mono text-[10px] font-normal">
                {wh.badge}
              </Badge>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-foreground group-hover:text-primary">{wh.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{wh.description}</p>
            <div className="mt-4 flex items-center gap-1 text-sm font-medium text-primary">
              Открыть
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>

    </div>
  )
}
