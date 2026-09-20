import type { Metadata, Viewport } from "next"
import { BatchScanPage } from "./page-client"

export const dynamic = "force-dynamic"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#F7F7F2",
}

export async function generateMetadata(props: {
  params: Promise<{ code: string }>
}): Promise<Metadata> {
  const { code } = await props.params
  const batchCode = decodeURIComponent(code || "")
  return {
    title: batchCode ? `Партия ${batchCode}` : "Партия стикеров",
    description: "Сведения о партии приёмки: номенклатура, ячейка, срок годности",
  }
}

export default async function Page(props: {
  params: Promise<{ code: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { code } = await props.params
  const sp = await props.searchParams
  const q = (key: string) => {
    const v = sp[key]
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined
  }
  return (
    <BatchScanPage
      batchCode={decodeURIComponent(code || "")}
      siteCode={q("siteCode")}
      cellHint={q("cell")}
      itemHint={q("item")}
      gtinHint={q("gtin")}
      qtyHint={q("qty")}
    />
  )
}
