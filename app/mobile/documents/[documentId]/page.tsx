import PageClient from "./page-client"

export function generateStaticParams() {
  return [{ documentId: "__" }]
}

export default function Page() {
  return <PageClient />
}
