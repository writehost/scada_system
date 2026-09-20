import type { Metadata, Viewport } from "next"
import { CellScanPage } from "./page-client"

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
  const locationCode = decodeURIComponent(code || "")
  return {
    title: locationCode ? `Ячейка ${locationCode}` : "Ячейка",
    description: "Содержимое и сведения о ячейке склада",
  }
}

export default async function Page(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params
  return <CellScanPage locationCode={decodeURIComponent(code || "")} />
}
