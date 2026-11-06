// Сборка предпросмотра: node tests/route/preview/build.mjs <outdir>
import { build } from "/opt/npm-tools/node_modules/esbuild/lib/main.js"
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const YMS = path.resolve(HERE, "../../..")
const out = path.resolve(process.argv[2] || "/tmp/route-preview")
const REACT = process.env.REACT_DIR || "/home/claude/.npm-global/lib/node_modules"
mkdirSync(path.join(out, "route/plan"), { recursive: true })
await build({
  entryPoints: [path.join(HERE, "entry.tsx")],
  bundle: true,
  outfile: path.join(out, "route/app.js"),
  format: "esm",
  jsx: "automatic",
  minify: false,
  sourcemap: false,
  target: "es2020",
  nodePaths: [REACT],
  alias: { "@": YMS },
  loader: { ".json": "json" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
})
copyFileSync(path.join(YMS, "app/route/route.css"), path.join(out, "route/route.css"))
copyFileSync(path.join(YMS, "public/route/plan/fg.png"), path.join(out, "route/plan/fg.png"))
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>SCADA System Forklift</title><link rel="stylesheet" href="/route/route.css"><style>html,body{margin:0;height:100%}</style></head><body><div id="root"></div><script type="module" src="/route/app.js"></script></body></html>`
for (const p of ["route/index.html", "route/dispatch/index.html", "route/editor/index.html"]) {
  mkdirSync(path.dirname(path.join(out, p)), { recursive: true })
  writeFileSync(path.join(out, p), html)
}
console.log("preview built:", out)
