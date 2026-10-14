export function qp(req: Request) {
  const u = new URL(req.url).searchParams
  return {
    str: (k: string) => (u.get(k) ?? "").trim() || undefined,
    list: (k: string) => u.getAll(k).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean),
    num: (k: string) => {
      const v = u.get(k)
      if (v == null || v === "") return null
      const n = Number(v.replace(",", "."))
      return Number.isFinite(n) ? n : null
    },
  }
}
