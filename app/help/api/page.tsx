"use client"

import Link from "next/link"
import { useEffect } from "react"
import { ArrowLeft, Download, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"

declare global {
  interface Window {
    SwaggerUIBundle?: (opts: Record<string, unknown>) => void
  }
}

export default function FullApiSwaggerPage() {
  useEffect(() => {
    const css = document.createElement("link")
    css.rel = "stylesheet"
    css.href = "https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"
    document.head.appendChild(css)

    const style = document.createElement("style")
    style.dataset.swaggerTheme = "wms"
    style.textContent = `
      .swagger-ui-wrap { padding: 0 8px 48px; }
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info { margin: 16px 0; }
      .swagger-ui .scheme-container { background: transparent; box-shadow: none; }
    `
    document.head.appendChild(style)

    const script = document.createElement("script")
    script.src = "https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"
    script.async = true
    script.onload = () => {
      window.SwaggerUIBundle?.({
        url: "/api/wms/openapi",
        dom_id: "#wms-full-swagger",
        persistAuthorization: true,
        tryItOutEnabled: true,
        deepLinking: true,
        filter: true,
        docExpansion: "none",
        defaultModelsExpandDepth: 0,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      })
    }
    document.body.appendChild(script)

    return () => {
      css.remove()
      style.remove()
      script.remove()
    }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 flex items-center gap-3 bg-card px-4 py-3 shadow-sm">
        <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
          <Link href="/help">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 font-semibold text-foreground">
            <BookOpen className="h-4 w-4 text-primary" />
            Полный API — Swagger
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            Все маршруты WMS, очередь печати GSMT и сервер обновлений. Фильтр сверху списка.
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-xl">
          <a href="/api/wms/openapi" download="wms.openapi.json">
            <Download className="mr-2 h-4 w-4" />
            JSON
          </a>
        </Button>
      </div>
      <div id="wms-full-swagger" className="swagger-ui-wrap" />
    </div>
  )
}
