import PageClient from "./page-client"

export function generateStaticParams() {
  return [{ itemCode: "__" }]
}

export default function Page() {
  return <PageClient />
}
