/**
 * Стили документных блоков. Попадают в CSS шаблона (а значит и в предпросмотр, и в PDF),
 * поэтому описаны печатными единицами.
 */
export const DOC_COMPONENTS_CSS = `.doc-cols { display: flex; gap: 6mm; }
.doc-cols > .doc-col { flex: 1 1 0; min-width: 0; }
.doc-divider { border: 0; border-top: 0.75pt solid #333333; margin: 3mm 0; }
.doc-spacer { height: 6mm; }
.doc-small { font-size: 8pt; color: #475569; }
.doc-caption { font-size: 7pt; color: #64748b; }
.doc-signature { display: flex; align-items: flex-end; gap: 2mm; margin: 4mm 0 2mm; break-inside: avoid; }
.doc-signature-role { white-space: nowrap; }
.doc-signature-line { flex: 0 0 40mm; border-bottom: 0.75pt solid #111111; height: 6mm; position: relative; }
.doc-signature-line img { position: absolute; left: 4mm; bottom: 0; max-height: 14mm; max-width: 36mm; }
.doc-signature-name { white-space: nowrap; }
.doc-stamp { width: 38mm; height: 38mm; border: 0.75pt dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 9pt; position: relative; break-inside: avoid; }
.doc-stamp img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.doc-requisites { font-size: 8.5pt; line-height: 1.35; }
.doc-requisites b { font-weight: 700; }
.doc-barcode { display: inline-block; width: 25mm; height: 25mm; object-fit: contain; }
.doc-barcode.doc-barcode-linear { width: 50mm; height: 15mm; }
.doc-title { font-size: 14pt; font-weight: 700; text-align: center; margin: 2mm 0 4mm; }
.doc-region { position: relative; }
.doc-region-header { margin-bottom: 4mm; }
.doc-region-footer { margin-top: 4mm; font-size: 8pt; color: #475569; }`
