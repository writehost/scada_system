import { ReceivingSessionPage } from "@/components/wms/receiving-session-page"

export function generateStaticParams() {
  return [{ docId: "__export__" }]
}

export default async function Page({
  params,
}: {
  params: Promise<{ docId: string }>
}) {
  const { docId } = await params
  return <ReceivingSessionPage docId={docId} />
}
