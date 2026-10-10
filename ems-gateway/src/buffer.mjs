// Устойчивый локальный буфер показаний: файлы-сегменты JSONL на диске.
// Запись дописывается и сбрасывается на диск (fsync) до подтверждения опроса;
// удаляется только после ответа облака 200. При превышении лимита объёма
// удаляются самые старые сегменты, и это явно учитывается (droppedItems).

import fs from "node:fs"
import path from "node:path"

const SEGMENT_BYTES = 1024 * 1024

export class DiskBuffer {
  constructor({ dir, maxBytes = 200 * 1024 * 1024 }) {
    this.dir = dir
    this.maxBytes = maxBytes
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.statePath = path.join(dir, "state.json")
    this.state = this.loadState()
  }

  loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(this.statePath, "utf8"))
      if (Number.isInteger(s.readSegment) && Number.isInteger(s.readOffset)) return { droppedItems: 0, ...s }
    } catch {
      /* новый буфер */
    }
    const segs = this.segments()
    return { readSegment: segs[0] ?? 1, readOffset: 0, droppedItems: 0 }
  }

  saveState() {
    const tmp = `${this.statePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.state))
    fs.renameSync(tmp, this.statePath)
  }

  segments() {
    return fs
      .readdirSync(this.dir)
      .map((f) => /^(\d{8})\.jsonl$/.exec(f))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b)
  }

  segPath(n) {
    return path.join(this.dir, `${String(n).padStart(8, "0")}.jsonl`)
  }

  /** Дописать показания. Возвращается после fsync. */
  append(items) {
    if (!items.length) return
    const segs = this.segments()
    let n = segs.at(-1) ?? this.state.readSegment
    if (fs.existsSync(this.segPath(n)) && fs.statSync(this.segPath(n)).size > SEGMENT_BYTES) n += 1
    const fd = fs.openSync(this.segPath(n), "a", 0o600)
    try {
      fs.writeSync(fd, items.map((i) => JSON.stringify(i)).join("\n") + "\n")
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    this.enforceLimit()
  }

  sizeBytes() {
    let total = 0
    for (const n of this.segments()) total += fs.statSync(this.segPath(n)).size
    return Math.max(0, total - this.state.readOffset)
  }

  enforceLimit() {
    let segs = this.segments()
    while (segs.length > 1 && this.sizeBytes() > this.maxBytes) {
      const oldest = segs[0]
      const lines = this.readLines(oldest, oldest === this.state.readSegment ? this.state.readOffset : 0, Infinity).items.length
      fs.unlinkSync(this.segPath(oldest))
      this.state.droppedItems += lines
      if (this.state.readSegment <= oldest) {
        this.state.readSegment = segs[1]
        this.state.readOffset = 0
      }
      this.saveState()
      segs = this.segments()
    }
  }

  readLines(seg, offset, max) {
    const p = this.segPath(seg)
    if (!fs.existsSync(p)) return { items: [], nextOffset: offset, complete: true }
    const data = fs.readFileSync(p)
    const items = []
    let pos = offset
    while (pos < data.length && items.length < max) {
      const nl = data.indexOf(10, pos)
      if (nl === -1) break // неполная строка после сбоя питания — дождёмся дозаписи или пропустим при ротации
      const line = data.subarray(pos, nl).toString("utf8")
      pos = nl + 1
      if (!line.trim()) continue
      try {
        items.push(JSON.parse(line))
      } catch {
        /* повреждённая строка пропускается */
      }
    }
    return { items, nextOffset: pos, complete: pos >= data.length }
  }

  /** Очередная порция для отправки (не удаляется до ack). */
  peek(max = 1000) {
    const segs = this.segments().filter((n) => n >= this.state.readSegment)
    const items = []
    let cursor = { seg: this.state.readSegment, offset: this.state.readOffset }
    for (const seg of segs) {
      const start = seg === this.state.readSegment ? this.state.readOffset : 0
      const r = this.readLines(seg, start, max - items.length)
      items.push(...r.items)
      cursor = { seg, offset: r.nextOffset }
      if (items.length >= max || !r.complete) break
      const isLast = seg === segs.at(-1)
      if (!isLast) cursor = { seg: seg + 1, offset: 0 }
    }
    return { items, cursor }
  }

  /** Подтверждение доставки: удаляет отправленное. */
  ack(cursor) {
    for (const n of this.segments()) if (n < cursor.seg) fs.unlinkSync(this.segPath(n))
    this.state.readSegment = cursor.seg
    this.state.readOffset = cursor.offset
    const p = this.segPath(cursor.seg)
    if (fs.existsSync(p) && fs.statSync(p).size === cursor.offset && this.segments().length > 1) {
      fs.unlinkSync(p)
      this.state.readSegment = cursor.seg + 1
      this.state.readOffset = 0
    }
    this.saveState()
  }

  stats() {
    const bytes = this.sizeBytes()
    // Точный подсчёт строк — для небольшого буфера; для большого — оценка по среднему размеру записи.
    const items = bytes < 20 * 1024 * 1024 ? this.countPending() : Math.round(bytes / 90)
    return { bufferBytes: bytes, bufferLimitBytes: this.maxBytes, droppedItems: this.state.droppedItems, bufferItems: items }
  }

  countPending() {
    let n = 0
    for (const seg of this.segments().filter((s) => s >= this.state.readSegment)) {
      n += this.readLines(seg, seg === this.state.readSegment ? this.state.readOffset : 0, Infinity).items.length
    }
    return n
  }
}
