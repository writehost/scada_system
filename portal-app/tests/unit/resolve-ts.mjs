// Резолвер для node --test: импорты без расширения и алиас «@/» как в Next.
import { register } from "node:module"
import { pathToFileURL } from "node:url"

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs"
      import { fileURLToPath, pathToFileURL } from "node:url"
      const root = ${JSON.stringify(pathToFileURL(process.cwd() + "/").href)}
      export async function resolve(spec, ctx, next) {
        if (spec.startsWith("@/")) spec = new URL(spec.slice(2), root).href
        if ((spec.startsWith(".") || spec.startsWith("file:")) && !/\\.[cm]?[jt]sx?$/.test(spec)) {
          const base = new URL(spec, ctx.parentURL)
          for (const ext of [".ts", ".tsx", "/index.ts"]) {
            const cand = new URL(base.href + ext)
            if (existsSync(fileURLToPath(cand))) return next(cand.href, ctx)
          }
        }
        return next(spec, ctx)
      }
    `),
  pathToFileURL("./")
)
