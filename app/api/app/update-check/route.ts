import { NextResponse } from "next/server"
import { readLocalBuildMeta } from "@/lib/app-version"
import { fetchTsdUpdateCheck, fetchUpdateCheck, isUpdateServerConfigured } from "@/lib/update-server-client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const local = readLocalBuildMeta()
  const [remote, tsd] = await Promise.all([fetchUpdateCheck(local.buildId), fetchTsdUpdateCheck(1, "0")])
  const updateAvailable = Boolean(remote.updateAvailable && remote.release)

  return NextResponse.json(
    {
      local,
      updateAvailable,
      release: updateAvailable ? remote.release : remote.release ?? null,
      latestRelease: remote.release ?? null,
      isTest: updateAvailable ? Boolean(remote.isTest) : false,
      serverConfigured: isUpdateServerConfigured(),
      remoteError: remote.error ?? null,
      tsd: {
        updateAvailable: Boolean(tsd.updateAvailable && tsd.release),
        release: tsd.release ?? null,
        error: tsd.error ?? null,
      },
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  )
}
