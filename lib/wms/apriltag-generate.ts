import { deflateSync, inflateSync } from "node:zlib"
import {
  APRILTAG_BORDER,
  APRILTAG_FAMILY,
  resolveFamily,
  type AprilTagFamilyId,
} from "./apriltag-families"

export {
  APRILTAG_BORDER,
  APRILTAG_DATA_SIZE,
  APRILTAG_FAMILIES,
  APRILTAG_FAMILY,
  APRILTAG_FAMILY_IDS,
  APRILTAG_MAX_ID,
  APRILTAG_TAG_CELLS,
  isAprilTagFamilyId,
  listAprilTagFamilies,
  resolveFamily,
  type AprilTagFamilyId,
  type AprilTagFamilyInfo,
} from "./apriltag-families"

export type AprilTagPrintInput = {
  family?: AprilTagFamilyId | string
  sizeCm?: number
  dpi?: number
  quiet?: number
  scale?: number
  preview?: boolean
}

export type AprilTagPrintSpec = {
  family: AprilTagFamilyId
  sizeCm: number
  dpi: number
  quiet: number
  tagCells: number
  pixelsPerCell: number
  tagPx: number
  sheetPx: number
  sheetCm: number
  pixelsPerMeter: number
  preview: boolean
}

export type AprilTagGrid = {
  family: AprilTagFamilyId
  id: number
  cells: number
  bits: number[]
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0, 0)
  return b
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii")
  const crc = crc32(Buffer.concat([typeBuf, data]))
  return Buffer.concat([u32(data.length), typeBuf, data, u32(crc)])
}

export function encodeGrayPng(
  width: number,
  height: number,
  pixels: Uint8Array,
  pixelsPerMeter?: number
): Buffer {
  if (pixels.length !== width * height) throw new Error("png size mismatch")
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
  ]
  if (pixelsPerMeter && pixelsPerMeter > 0) {
    const phys = Buffer.alloc(9)
    phys.writeUInt32BE(Math.round(pixelsPerMeter), 0)
    phys.writeUInt32BE(Math.round(pixelsPerMeter), 4)
    phys[8] = 1
    chunks.push(pngChunk("pHYs", phys))
  }
  chunks.push(pngChunk("IDAT", deflateSync(raw, { level: 9 })))
  chunks.push(pngChunk("IEND", Buffer.alloc(0)))
  return Buffer.concat(chunks)
}

function clampNum(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function printInputFromSearchParams(sp: URLSearchParams): AprilTagPrintInput {
  const sizeCm = sp.get("sizeCm")
  const dpi = sp.get("dpi")
  const quiet = sp.get("quiet")
  const preview = sp.get("preview")
  const family = sp.get("family")
  return {
    family: family && family.trim() ? family.trim() : undefined,
    sizeCm: sizeCm != null && sizeCm !== "" ? Number(sizeCm) : undefined,
    dpi: dpi != null && dpi !== "" ? Number(dpi) : undefined,
    quiet: quiet != null && quiet !== "" ? Number(quiet) : undefined,
    preview: preview === "1" || preview === "true",
  }
}

export function resolvePrintSpec(raw?: AprilTagPrintInput): AprilTagPrintSpec {
  const family = resolveFamily(raw?.family)
  const preview = raw?.preview === true
  const sizeCm = clampNum(raw?.sizeCm, 80, 5, 200)
  const dpi = preview ? 36 : Math.round(clampNum(raw?.dpi, 150, 72, 300))
  const quiet = Math.round(clampNum(raw?.quiet, 1, 0, 4))
  const tagCells = family.tagCells
  const sheetCells = tagCells + quiet * 2
  const fromScale = raw?.scale != null && Number.isFinite(Number(raw.scale)) && !raw.sizeCm
  const tagPx = fromScale
    ? Math.round(clampNum(raw?.scale, 32, 8, 80)) * tagCells
    : Math.max(tagCells, Math.round((sizeCm / 2.54) * dpi))
  const pixelsPerCell = Math.max(1, Math.round(tagPx / tagCells))
  const exactTagPx = pixelsPerCell * tagCells
  const sheetPx = pixelsPerCell * sheetCells
  const sheetCm = (sheetPx / exactTagPx) * sizeCm
  return {
    family: family.id,
    sizeCm,
    dpi,
    quiet,
    tagCells,
    pixelsPerCell,
    tagPx: exactTagPx,
    sheetPx,
    sheetCm: Math.round(sheetCm * 10) / 10,
    pixelsPerMeter: dpi / 0.0254,
    preview,
  }
}

export function tagCode(family: AprilTagFamilyId | string, id: number): bigint {
  const def = resolveFamily(family)
  if (!Number.isInteger(id) || id < 0 || id > def.maxId) {
    throw new Error(`AprilTag ${def.id}: id 0…${def.maxId}`)
  }
  return def.codes[id]!
}

export function tag36h11Code(id: number): bigint {
  return tagCode("tag36h11", id)
}

export function renderTagGrid(family: AprilTagFamilyId | string, id: number): AprilTagGrid {
  const def = resolveFamily(family)
  const code = tagCode(def.id, id)
  const d = def.dataSize
  const cells = def.tagCells
  const bits = new Array<number>(cells * cells).fill(0)
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const shift = BigInt(d * d - 1 - (y * d + x))
      const on = ((code >> shift) & 1n) === 1n
      bits[(y + APRILTAG_BORDER) * cells + (x + APRILTAG_BORDER)] = on ? 1 : 0
    }
  }
  return { family: def.id, id, cells, bits }
}

export function renderTag36h11Grid(id: number): AprilTagGrid {
  return renderTagGrid("tag36h11", id)
}

export function rasterizeTag(id: number, spec: AprilTagPrintSpec): Uint8Array {
  const grid = renderTagGrid(spec.family, id)
  const width = spec.sheetPx
  const pixels = new Uint8Array(width * width).fill(255)
  const q = spec.quiet * spec.pixelsPerCell
  const s = spec.pixelsPerCell
  for (let y = 0; y < grid.cells; y++) {
    for (let x = 0; x < grid.cells; x++) {
      const shade = grid.bits[y * grid.cells + x] === 1 ? 255 : 0
      const x0 = q + x * s
      const y0 = q + y * s
      for (let dy = 0; dy < s; dy++) {
        pixels.fill(shade, (y0 + dy) * width + x0, (y0 + dy) * width + x0 + s)
      }
    }
  }
  return pixels
}

export function renderTag36h11Png(id: number, raw?: AprilTagPrintInput): Buffer {
  const spec = resolvePrintSpec(raw)
  const pixels = rasterizeTag(id, spec)
  return encodeGrayPng(spec.sheetPx, spec.sheetPx, pixels, spec.preview ? undefined : spec.pixelsPerMeter)
}

export function tagFileName(id: number, ext = "png", family: AprilTagFamilyId | string = APRILTAG_FAMILY): string {
  const def = resolveFamily(family)
  return `${def.filePrefix}_${String(id).padStart(5, "0")}.${ext}`
}

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

export function renderTag36h11Pdf(id: number, raw?: AprilTagPrintInput): Buffer {
  const spec = resolvePrintSpec({ ...raw, preview: false })
  const pixels = rasterizeTag(id, spec)
  const compressed = deflateSync(Buffer.from(pixels), { level: 9 })
  const wPt = (spec.sheetCm / 2.54) * 72
  const captionPt = 18
  const hPt = wPt + captionPt
  const caption = pdfEscape(
    `${spec.family}  ID ${id}   ${spec.sizeCm}x${spec.sizeCm} cm   sheet ${spec.sheetCm}x${spec.sheetCm} cm`
  )
  const content =
    `q ${wPt.toFixed(3)} 0 0 ${wPt.toFixed(3)} 0 ${captionPt.toFixed(3)} cm /Im0 Do Q\n` +
    `BT /F1 10 Tf 12 5 Td (${caption}) Tj ET\n`

  const parts: Buffer[] = []
  const offsets: number[] = [0]
  let pos = 0

  function push(chunk: string | Buffer) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "latin1") : chunk
    parts.push(buf)
    pos += buf.length
  }

  function addObj(chunk: string | Buffer) {
    offsets.push(pos)
    push(chunk)
  }

  push("%PDF-1.4\n")
  addObj("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
  addObj("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n")
  addObj(
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(3)} ${hPt.toFixed(3)}] /Resources << /Font << /F1 6 0 R >> /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >> endobj\n`
  )
  addObj(
    `4 0 obj << /Type /XObject /Subtype /Image /Width ${spec.sheetPx} /Height ${spec.sheetPx} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >> stream\n`
  )
  push(compressed)
  push("\nendstream\nendobj\n")
  addObj(`5 0 obj << /Length ${Buffer.byteLength(content, "latin1")} >> stream\n${content}endstream\nendobj\n`)
  addObj("6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n")

  const xrefPos = pos
  let xref = "xref\n0 7\n0000000000 65535 f \n"
  for (let i = 1; i <= 6; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`
  }
  push(xref)
  push(`trailer << /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)
  return Buffer.concat(parts)
}

function decodeGrayPng(png: Buffer): { width: number; height: number; pixels: Uint8Array } {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const chunks: Buffer[] = []
  let off = 8
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off)
    const type = png.subarray(off + 4, off + 8).toString("ascii")
    const data = png.subarray(off + 8, off + 8 + len)
    if (type === "IDAT") chunks.push(data)
    if (type === "IEND") break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const pixels = new Uint8Array(width * height)
  const stride = width + 1
  for (let y = 0; y < height; y++) {
    pixels.set(raw.subarray(y * stride + 1, y * stride + 1 + width), y * width)
  }
  return { width, height, pixels }
}

function blitGray(
  dest: Uint8Array,
  destW: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
  x0: number,
  y0: number
) {
  for (let y = 0; y < srcH; y++) {
    dest.set(src.subarray(y * srcW, (y + 1) * srcW), (y0 + y) * destW + x0)
  }
}

export function renderTagMosaicPng(ids: number[], raw?: AprilTagPrintInput): Buffer {
  const unique = [...new Set(ids)].sort((a, b) => a - b)
  if (unique.length === 0) throw new Error("нет тегов для мозаики")
  const spec = resolvePrintSpec({ ...raw, preview: true, sizeCm: raw?.sizeCm ?? 8 })
  const tiles = unique.map((id) => rasterizeTag(id, spec))
  const tile = spec.sheetPx
  const cols = Math.max(1, Math.ceil(Math.sqrt(tiles.length)))
  const rows = Math.ceil(tiles.length / cols)
  const gap = 8
  const width = cols * tile + (cols + 1) * gap
  const height = rows * tile + (rows + 1) * gap
  const pixels = new Uint8Array(width * height).fill(255)
  for (let i = 0; i < tiles.length; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    blitGray(pixels, width, tiles[i]!, tile, tile, gap + c * (tile + gap), gap + r * (tile + gap))
  }
  return encodeGrayPng(width, height, pixels)
}

function dosTime(date: Date): { time: number; day: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export function zipStore(files: Array<{ name: string; data: Buffer }>): Buffer {
  const now = dosTime(new Date())
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8")
    const crc = crc32(file.data)
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from([now.time & 0xff, now.time >> 8, now.day & 0xff, now.day >> 8]),
      u32le(crc),
      u32le(file.data.length),
      u32le(file.data.length),
      u16le(name.length),
      u16le(0),
      name,
      file.data,
    ])
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02, 0x14, 0x00, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from([now.time & 0xff, now.time >> 8, now.day & 0xff, now.day >> 8]),
      u32le(crc),
      u32le(file.data.length),
      u32le(file.data.length),
      u16le(name.length),
      u16le(0),
      u16le(0),
      u16le(0),
      u16le(0),
      u32le(0),
      u32le(offset),
      name,
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00]),
    u16le(files.length),
    u16le(files.length),
    u32le(centralBuf.length),
    u32le(offset),
    u16le(0),
  ])
  return Buffer.concat([...locals, centralBuf, end])
}

function u16le(n: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n, 0)
  return b
}

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

export function packTagZip(ids: number[], raw?: AprilTagPrintInput, kind: "png" | "pdf" = "png"): Buffer {
  const unique = [...new Set(ids)].sort((a, b) => a - b)
  if (unique.length === 0) throw new Error("нет тегов для архива")
  const files = unique.map((id) => ({
    name: tagFileName(id, kind, raw?.family),
    data: kind === "pdf" ? renderTag36h11Pdf(id, raw) : renderTag36h11Png(id, raw),
  }))
  return zipStore(files)
}

export { decodeGrayPng }
