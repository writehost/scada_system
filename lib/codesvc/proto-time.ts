/** Форматирование `google.protobuf.Timestamp` из ответа gRPC (proto-loader). */
export function formatProtoTimestamp(ts: unknown): string | undefined {
  if (ts == null || typeof ts !== "object") return undefined;
  const o = ts as Record<string, unknown>;
  const sec = o.seconds ?? o.Seconds;
  if (sec == null || sec === "") return undefined;
  let s: number;
  if (typeof sec === "object" && sec !== null && "low" in (sec as object)) {
    const lo = Number((sec as { low?: number }).low ?? 0);
    const hi = Number((sec as { high?: number }).high ?? 0);
    s = hi === 0 ? lo : hi * 0x100000000 + (lo >>> 0);
  } else if (typeof sec === "string") {
    s = Number(sec);
  } else {
    s = Number(sec);
  }
  if (!Number.isFinite(s)) return undefined;
  const nanos = Number(o.nanos ?? o.Nanos ?? 0);
  const ms = s * 1000 + Math.floor(nanos / 1e6);
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return undefined;
  }
}
