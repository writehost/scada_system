import PageClient from "./page-client"

export function generateStaticParams() {
  return [{ documentId: "__export__" }]
}

export default function Page() {
  return <PageClient />
}
