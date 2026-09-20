/** xxhash64 — совместимо с github.com/cespare/xxhash/v2 Sum64 (seed 0). */

const PRIME64_1 = 0x9e3779b185ebca87n
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn
const PRIME64_3 = 0x165667919e3779f9n
const PRIME64_4 = 0x85ebca77c2b2ae63n
const PRIME64_5 = 0x27d4eb2f165667c5n

function rotl64(x: bigint, r: number): bigint {
  return ((x << BigInt(r)) | (x >> BigInt(64 - r))) & 0xffffffffffffffffn
}

function readU64LE(buf: Uint8Array, off: number): bigint {
  let v = 0n
  for (let i = 0; i < 8; i += 1) {
    v |= BigInt(buf[off + i] ?? 0) << BigInt(i * 8)
  }
  return v & 0xffffffffffffffffn
}

function round(acc: bigint, input: bigint): bigint {
  let a = (acc + input * PRIME64_2) & 0xffffffffffffffffn
  a = rotl64(a, 31)
  return (a * PRIME64_1) & 0xffffffffffffffffn
}

function mergeRound(acc: bigint, val: bigint): bigint {
  let a = (acc ^ round(0n, val)) & 0xffffffffffffffffn
  a = (a * PRIME64_1 + PRIME64_4) & 0xffffffffffffffffn
  return a
}

function finalize(h64: bigint, len: number): bigint {
  let h = (h64 ^ BigInt(len)) & 0xffffffffffffffffn
  h = (h ^ (h >> 33n)) & 0xffffffffffffffffn
  h = (h * PRIME64_2) & 0xffffffffffffffffn
  h = (h ^ (h >> 29n)) & 0xffffffffffffffffn
  h = (h * PRIME64_3) & 0xffffffffffffffffn
  h = (h ^ (h >> 32n)) & 0xffffffffffffffffn
  return h
}

export function xxhash64(input: Uint8Array | Buffer, seed = 0n): bigint {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input)
  const len = buf.length
  let h64 = seed + PRIME64_5 + BigInt(len)
  let off = 0

  if (len >= 32) {
    let v1 = seed + PRIME64_1 + PRIME64_2
    let v2 = seed + PRIME64_2
    let v3 = seed
    let v4 = seed - PRIME64_1
    const limit = len - 32
    while (off <= limit) {
      v1 = round(v1, readU64LE(buf, off))
      off += 8
      v2 = round(v2, readU64LE(buf, off))
      off += 8
      v3 = round(v3, readU64LE(buf, off))
      off += 8
      v4 = round(v4, readU64LE(buf, off))
      off += 8
    }
    h64 =
      (rotl64(v1, 1) +
        rotl64(v2, 7) +
        rotl64(v3, 12) +
        rotl64(v4, 18)) &
      0xffffffffffffffffn
    h64 = mergeRound(h64, v1)
    h64 = mergeRound(h64, v2)
    h64 = mergeRound(h64, v3)
    h64 = mergeRound(h64, v4)
  }

  h64 = (h64 + BigInt(len)) & 0xffffffffffffffffn

  while (off + 8 <= len) {
    const k1 = round(0n, readU64LE(buf, off))
    h64 = (h64 ^ k1) & 0xffffffffffffffffn
    h64 = rotl64(h64, 27)
    h64 = (h64 * PRIME64_1 + PRIME64_4) & 0xffffffffffffffffn
    off += 8
  }

  if (off + 4 <= len) {
    const k1 = BigInt(readU32LE(buf, off))
    h64 = (h64 ^ (k1 * PRIME64_1)) & 0xffffffffffffffffn
    h64 = rotl64(h64, 23)
    h64 = (h64 * PRIME64_2 + PRIME64_3) & 0xffffffffffffffffn
    off += 4
  }

  while (off < len) {
    const k1 = BigInt(buf[off] ?? 0)
    h64 = (h64 ^ (k1 * PRIME64_5)) & 0xffffffffffffffffn
    h64 = rotl64(h64, 11)
    h64 = (h64 * PRIME64_1) & 0xffffffffffffffffn
    off += 1
  }

  return finalize(h64, len)
}

function readU32LE(buf: Uint8Array, off: number): number {
  return (
    (buf[off] ?? 0) |
    ((buf[off + 1] ?? 0) << 8) |
    ((buf[off + 2] ?? 0) << 16) |
    ((buf[off + 3] ?? 0) << 24)
  ) >>> 0
}

/** signed int64 для Postgres BIGINT (raw_hash / base_hash). */
export function xxhash64Signed(input: Uint8Array | Buffer): string {
  const u = xxhash64(input)
  const signed = u >= 0x8000000000000000n ? u - 0x10000000000000000n : u
  return signed.toString()
}
