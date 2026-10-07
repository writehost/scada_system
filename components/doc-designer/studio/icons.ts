/** Иконки блоков (контурные, в стиле lucide), чтобы панель не выглядела как конструктор сайтов. */

const svg = (body: string) =>
  `<svg data-doc-icon viewBox="0 0 24 24" width="28" height="28" style="fill:none" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const BLOCK_ICONS = {
  text: svg('<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>'),
  heading: svg('<path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/>'),
  paragraph: svg('<path d="M4 6h16"/><path d="M4 10h16"/><path d="M4 14h16"/><path d="M4 18h10"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  divider: svg('<path d="M3 12h18"/><path d="M8 7h8" opacity=".4"/><path d="M8 17h8" opacity=".4"/>'),
  spacer: svg('<path d="M12 4v16"/><path d="m8 8 4-4 4 4"/><path d="m8 16 4 4 4-4"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18"/><path d="M3 15h18"/><path d="M9 4v16"/><path d="M15 4v16"/>'),
  container: svg('<rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="3 2"/>'),
  cols2: svg('<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>'),
  cols3: svg('<rect x="2.5" y="4" width="5.5" height="16" rx="1.2"/><rect x="9.25" y="4" width="5.5" height="16" rx="1.2"/><rect x="16" y="4" width="5.5" height="16" rx="1.2"/>'),
  header: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18"/><path d="M6 5.5h6"/>'),
  footer: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 16h18"/><path d="M14 18.5h4"/>'),
  pageBreak: svg('<path d="M5 3v5h14V3"/><path d="M5 21v-5h14v5"/><path d="M3 12h2"/><path d="M8 12h2"/><path d="M13 12h2"/><path d="M18 12h3"/>'),
  variable: svg('<path d="M12 3 21 12l-9 9-9-9z"/><path d="M9 12h6"/>'),
  condition: svg('<path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6"/><path d="M6 21v-4"/><circle cx="6" cy="14" r="1"/>'),
  conditionElse: svg('<path d="M12 3v6"/><path d="M12 9 6 15v6"/><path d="m12 9 6 6v6"/>'),
  loop: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  dataTable: svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18"/><path d="M8 13h8" stroke-dasharray="2 2"/><path d="M8 16.5h8" stroke-dasharray="2 2"/><path d="M17 12.5l1.5 1.5-1.5 1.5"/>'),
  qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 14v.01"/><path d="M14 20h.01"/><path d="M17 20h4v-3"/>'),
  barcode: svg('<path d="M3 5v14"/><path d="M6 5v14"/><path d="M8 5v14" stroke-width="2.4"/><path d="M11 5v14"/><path d="M14 5v14" stroke-width="2.4"/><path d="M17 5v14"/><path d="M19 5v14"/><path d="M21 5v14"/>'),
  datamatrix: svg('<path d="M3 3v18h18"/><path d="M3 3h2M7 3h2M11 3h2M15 3h2M19 3h2M21 5v2M21 9v2M21 13v2M21 17v2"/><path d="M7 7h3v3H7zM12 12h3v3h-3zM7 14h2v3H7zM14 6h3v3h-3z"/>'),
  number: svg('<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>'),
  date: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/>'),
  requisites: svg('<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 10h1M14 10h1M9 14h1M14 14h1"/>'),
  signature: svg('<path d="M3 17c3-1 4-8 6-8s0 8 3 8 3-4 5-4 2 3 4 3"/><path d="M3 21h18"/>'),
  stamp: svg('<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2"/><path d="M8.5 12h7"/>'),
  raw: svg('<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13 5-2 14"/>'),
}

const small = (body: string) =>
  `<svg data-doc-icon viewBox="0 0 24 24" style="fill:none" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const CMP_ICONS = {
  variable: small('<path d="M12 3 21 12l-9 9-9-9z"/>'),
  dataTable: small('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18"/><path d="M9 4v16"/>'),
  barcode: small('<path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/>'),
  raw: small('<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>'),
  region: small('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18"/>'),
  pageBreak: small('<path d="M3 12h4M10 12h4M17 12h4"/>'),
}
