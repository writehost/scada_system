import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** РЎС‚Р°С‚РёС‡РµСЃРєРёР№ `out/` РґР»СЏ APK (Capacitor `bundled`). РћР±С‹С‡РЅС‹Р№ `next build` Р±РµР· СЌС‚РѕР№ РїРµСЂРµРјРµРЅРЅРѕР№ вЂ” РєР°Рє СЂР°РЅСЊС€Рµ. */
const tsdAndroidBundle = process.env.TSD_ANDROID_BUNDLE === "1"

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(tsdAndroidBundle
    ? {
        output: "export",
        trailingSlash: true,
        distDir: ".next-tsd-export",
      }
    : {}),
  /**
   * Р РѕРґРёС‚РµР»СЊСЃРєРёР№ `web/` вЂ” РѕР±С‰РёРµ `../components`, `../lib` РёР· tsconfig Рё РѕРґРёРЅ workspace РґР»СЏ Turbopack.
   * Dev РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ Р·Р°РїСѓСЃРєР°Р№С‚Рµ СЃ Webpack (`npm run dev`): Turbopack РЅР° Windows С‡Р°СЃС‚Рѕ РЅРµ РІРёРґРёС‚ API С‡РµСЂРµР· junction `app/api/wms`.
   */
  turbopack: {
    root: path.join(__dirname, "..", "Backend", "web"),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  productionBrowserSourceMaps: false,
  experimental: {
    webpackMemoryOptimizations: true,
    cpus: 1,
  },
  images: {
    unoptimized: true,
  },
  ...(tsdAndroidBundle
    ? {}
    : {
        /**
         * РџСЂРѕРєСЃРё `/api/wms/*` РЅР° РІС‚РѕСЂРѕР№ Next (`web/`), РіРґРµ Р»РµР¶Р°С‚ СЂРµР°Р»СЊРЅС‹Рµ route handlers.
         * РќР° Windows junction `interface/app/api/wms` С‡Р°СЃС‚Рѕ РЅРµ РїРѕРїР°РґР°РµС‚ РІ dev вЂ” С‚РѕРіРґР° Р±РµР· РїСЂРѕРєСЃРё Р±СѓРґРµС‚ HTML 404.
         *
         * РџСЂРёРѕСЂРёС‚РµС‚: `WMS_BACKEND_URL` в†’ РёРЅР°С‡Рµ РІ **development** fallback `http://127.0.0.1:3001`
         * (РїРѕРґРЅРёРјРёС‚Рµ СЃРЅР°С‡Р°Р»Р° `scripts/start-web.ps1`, Р·Р°С‚РµРј РёРЅС‚РµСЂС„РµР№СЃ РЅР° :3000).
         * РћС‚РєР»СЋС‡РёС‚СЊ fallback: `WMS_DISABLE_DEV_PROXY=1` (С‚РѕР»СЊРєРѕ junction / СЃРІРѕР№ URL).
         */
        async rewrites() {
          const explicit = (process.env.WMS_BACKEND_URL || "").trim().replace(/\/$/, "")
          const disableDevProxy = process.env.WMS_DISABLE_DEV_PROXY === "1"
          const lifecycle = process.env.npm_lifecycle_script || ""
          const lifecyclePort =
            lifecycle.match(/--port\s+(\d+)/)?.[1] ||
            lifecycle.match(/-p\s+(\d+)/)?.[1] ||
            ""
          const interfacePort = (process.env.PORT || "").trim()
          const selfPort = (lifecyclePort || interfacePort || "3000").trim()
          const isSelfProxy = (url) => {
            if (!url) return false
            try {
              const u = new URL(url)
              const host = u.hostname.toLowerCase()
              const port = u.port || (u.protocol === "https:" ? "443" : "80")
              return (host === "127.0.0.1" || host === "localhost") && port === selfPort
            } catch {
              return false
            }
          }
          const devFallback =
            !disableDevProxy &&
            !explicit &&
            process.env.NODE_ENV === "development"
              ? "http://127.0.0.1:3001"
              : ""
          const chosen = explicit || devFallback
          if (isSelfProxy(chosen)) {
            throw new Error(
              `[WMS proxy misconfigured] interface is running on :${selfPort} and WMS_BACKEND_URL resolves to ${chosen}. ` +
                `This creates a self-proxy loop. Run interface on :3000 and backend web/ on :3001. ` +
                `Use scripts/start-interface.ps1 (sets PORT=3000) + scripts/start-web.ps1 (PORT=3001).`
            )
          }
          const base = chosen
          if (!base) return []
          return [{ source: "/api/wms/:path*", destination: `${base}/api/wms/:path*` }]
        },
      }),
}

export default nextConfig

