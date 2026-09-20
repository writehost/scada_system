import type { QuickLpnRow } from "@/lib/wms-api"

function fmtQty(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n)
}

function labelBlock(lpn: QuickLpnRow) {
  return `<section class="label">
  <h1>${escapeHtml(lpn.itemName)}</h1>
  <div class="row">LOT ${escapeHtml(lpn.lotCode)}</div>
  <div class="row">Изг. ${escapeHtml(lpn.productionDate || "—")}</div>
  <div class="row">Годен до ${escapeHtml(lpn.expiryDate || "—")}</div>
  <div class="row">${fmtQty(lpn.qty)} шт</div>
  <div class="lpn">LPN: ${escapeHtml(lpn.lpnCode)}</div>
  <img src="/api/wms/marking/datamatrix?text=${encodeURIComponent(lpn.lpnCode)}" alt="${escapeHtml(lpn.lpnCode)}" />
</section>`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function openLpnLabels(lpns: QuickLpnRow[]) {
  if (lpns.length === 0) return
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${lpns.map((l) => l.lpnCode).join(", ")}</title>
  <style>
    @page { size: 100mm 70mm; margin: 4mm; }
    body{font-family:Arial,sans-serif;margin:0;color:#111}
    .label{page-break-after:always;padding:8px}
    .label:last-child{page-break-after:auto}
    h1{font-size:18px;margin:0 0 8px;line-height:1.2}
    .row{font-size:14px;margin:2px 0}
    .lpn{font-size:22px;font-weight:700;margin-top:10px;letter-spacing:.04em}
    img{width:140px;height:140px;margin-top:10px}
  </style></head><body>
  ${lpns.map(labelBlock).join("")}
  <script>setTimeout(function(){window.print()},250)</script>
  </body></html>`
  const w = window.open("", "_blank", "width=480,height=640")
  if (!w) return
  w.document.write(html)
  w.document.close()
}
