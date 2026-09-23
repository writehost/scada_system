import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: true },
}

export default nextConfig
