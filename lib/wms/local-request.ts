function normalizeIp(value: string): string {
  const ip = value.trim().toLowerCase();
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function isLoopbackIp(value: string): boolean {
  const ip = normalizeIp(value);
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || ip.startsWith("127.");
}

/** True for direct/loopback calls. Public nginx hops keep a non-local forwarded IP. */
export function isLocalRequest(req: Request): boolean {
  const candidates = [
    req.headers.get("x-real-ip") || "",
    ...(req.headers.get("x-forwarded-for") || "").split(","),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  if (candidates.length === 0) return true;
  return candidates.every(isLoopbackIp);
}
