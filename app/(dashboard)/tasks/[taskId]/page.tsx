import PageClient from "./page-client"

export function generateStaticParams() {
  return [{ taskId: "__" }]
}

export default function Page() {
  return <PageClient />
}
