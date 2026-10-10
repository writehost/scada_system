import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DiskBuffer } from "../src/buffer.mjs"

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ems-buf-"))
const items = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ channelId: 1, at: new Date(Date.UTC(2026, 0, 1) + (from + i) * 60000).toISOString(), raw: from + i }))

test("data survives restart until acknowledged", () => {
  const dir = tmp()
  const b1 = new DiskBuffer({ dir })
  b1.append(items(5))
  const { items: got, cursor } = b1.peek(3)
  assert.equal(got.length, 3)
  // «Падение» до подтверждения: новый экземпляр видит всё
  const b2 = new DiskBuffer({ dir })
  assert.equal(b2.peek(100).items.length, 5)
  b2.ack(b2.peek(3).cursor)
  const b3 = new DiskBuffer({ dir })
  assert.deepEqual(b3.peek(100).items.map((x) => x.raw), [3, 4])
  void cursor
})

test("torn last line after power loss is not delivered", () => {
  const dir = tmp()
  const b = new DiskBuffer({ dir })
  b.append(items(2))
  fs.appendFileSync(path.join(dir, "00000001.jsonl"), '{"channelId":1,"at":"2026')
  assert.equal(new DiskBuffer({ dir }).peek(10).items.length, 2)
})

test("size limit drops oldest data and counts it explicitly", () => {
  const dir = tmp()
  const b = new DiskBuffer({ dir, maxBytes: 1.5 * 1024 * 1024 })
  for (let i = 0; i < 40; i += 1) b.append(items(1000, i * 1000))
  const st = b.stats()
  assert.ok(st.bufferBytes <= 1.5 * 1024 * 1024 + 1024 * 1024)
  assert.ok(st.droppedItems > 0)
  const first = b.peek(1).items[0]
  assert.ok(first.raw >= st.droppedItems - 1)
  assert.equal(st.bufferItems + st.droppedItems, 40000)
})

test("ack across segments removes delivered files", () => {
  const dir = tmp()
  const b = new DiskBuffer({ dir })
  for (let i = 0; i < 30; i += 1) b.append(items(1000, i * 1000))
  let delivered = 0
  for (;;) {
    const { items: got, cursor } = b.peek(5000)
    if (!got.length) break
    delivered += got.length
    b.ack(cursor)
  }
  assert.equal(delivered, 30000)
  assert.equal(b.stats().bufferItems, 0)
  assert.ok(fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).length <= 1)
})
