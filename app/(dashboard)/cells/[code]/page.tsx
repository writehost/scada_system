import { Suspense } from "react"
import PageClient from "./page-client"

export const dynamic = "force-dynamic"

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          Загрузка ячейки…
        </div>
      }
    >
      <PageClient />
    </Suspense>
  )
}
