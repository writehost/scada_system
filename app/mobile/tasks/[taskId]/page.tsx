import PageClient from "./page-client"

export function generateStaticParams() {
  return [{ taskId: "__export__" }]
}

export default function Page() {
  return <PageClient />
}
