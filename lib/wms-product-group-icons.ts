/** Публичные файлы из `/public`. Добавляйте сюда новые группы по мере появления иконок. */

export function productGroupIconSrc(productGroupDisplay: string): string | null {
  const s = productGroupDisplay.trim().toLowerCase()
  if (!s || s === "—") return null

  const stickerLike =
    /стикер|стікер|sticker|stickers|этикетк|label|groupestick/i.test(s) ||
    s.includes("стикер") ||
    s.includes("sticker")

  if (stickerLike) return "/wms/groups/stickers.png"

  return null
}

/** Иконка по группе из БД, наименованию или коду (например код «Стикер» без заполненного product_group). */
export function productGroupIconSrcForRow(
  productGroup: string | null | undefined,
  name: string | null | undefined,
  itemCode?: string | null | undefined
) {
  return (
    productGroupIconSrc(productGroup || "") ||
    productGroupIconSrc(name || "") ||
    productGroupIconSrc(itemCode || "")
  )
}
