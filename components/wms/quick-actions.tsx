"use client"

import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"

export const IMG_NEW_RECEIVING = "/wms/dashboard/quick-new-receiving.png"
export const IMG_MOVEMENT = "/wms/dashboard/quick-movement.png"
export const IMG_ISSUE = "/wms/dashboard/quick-issue.png"
export const IMG_SCAN = "/wms/dashboard/quick-scan.png"
export const IMG_DOCUMENT = "/wms/dashboard/quick-document.png"
export const IMG_ADD_PRODUCT = "/wms/dashboard/quick-add-product.png"

/** Плитки главной (ТСД): те же PNG, что в «Быстрых действиях» дашборда. */
export const MOBILE_HOME_IMAGE_ACTIONS = [
  { href: "/mobile/receiving", src: IMG_NEW_RECEIVING, srLabel: "Приёмка" },
  { href: "/mobile/issue", src: IMG_ISSUE, srLabel: "Склад — выдача" },
  { href: "/mobile/movement", src: IMG_MOVEMENT, srLabel: "Перемещение" },
  { href: "/mobile/production", src: IMG_ADD_PRODUCT, srLabel: "Списание с линии" },
] as const

/** Плитка под вертикальные макеты: узкая колонка + portrait aspect → без «полей» по бокам; картинка рубит края через cover. */
export function ImageActionTile({
  href,
  src,
  srLabel,
  className,
}: {
  href: string
  src: string
  srLabel: string
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative block w-full overflow-hidden rounded-xl border border-border bg-muted/50 shadow-sm transition",
        /* высота от ширины ячейки — форма ближе к вертикальным PNG, без широкой «ласточки» */
        "aspect-[4/5]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "hover:opacity-95 active:scale-[0.98] motion-reduce:active:scale-100",
        className
      )}
    >
      <Image
        src={src}
        alt=""
        fill
        className="object-cover object-center"
        sizes="(max-width: 768px) 48vw, 240px"
      />
      <span className="sr-only">{srLabel}</span>
    </Link>
  )
}

interface QuickActionsProps {
  className?: string
}

export function QuickActions({ className }: QuickActionsProps) {
  return (
    <div className={cn("rounded-2xl bg-card shadow-sm", className)}>
      <div className="p-5 pb-3">
        <h3 className="font-semibold text-card-foreground">Быстрые действия</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3 pb-5">
        <ImageActionTile
          href="/receiving?new=1"
          src={IMG_NEW_RECEIVING}
          srLabel="Новая приёмка — создать документ приёмки"
        />
        <ImageActionTile
          href="/movement?new=1"
          src={IMG_MOVEMENT}
          srLabel="Перемещение — новое перемещение"
        />
        <ImageActionTile href="/return" src={IMG_ISSUE} srLabel="Возврат — новый возврат" />
        <ImageActionTile href="/search" src={IMG_SCAN} srLabel="Сканировать — поиск по штрихкоду" />
        <ImageActionTile href="/documents?new=1" src={IMG_DOCUMENT} srLabel="Документ — создать документ" />
        <ImageActionTile
          href="/nomenclature"
          src={IMG_ADD_PRODUCT}
          srLabel="Добавить товар — новая номенклатура"
        />
      </div>
    </div>
  )
}
