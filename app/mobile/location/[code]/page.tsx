import PageClient from "./page-client"

export function generateStaticParams() {
  return [{ code: "__export__" }]
}

export default function Page() {
  return <PageClient />
}
