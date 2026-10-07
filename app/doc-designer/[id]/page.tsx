import { DocumentDesignerLoader } from "./loader"

export const metadata = { title: "Редактор документа | WMS" }

export default async function DocDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DocumentDesignerLoader templateId={id} />
}
