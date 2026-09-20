const REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseRequestId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return REQUEST_ID_RE.test(s) ? s : null;
}
