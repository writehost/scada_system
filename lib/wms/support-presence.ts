export type SupportPeer = {
  clientId: string
  userId: string
  login: string
  displayName: string
  path: string
  x: number
  y: number
  followClientId: string | null
  lastSeen: number
  color: string
}

export type SupportOnlineUser = {
  userId: string
  login: string
  displayName: string
  path: string
  clientId: string
  color: string
  peerCount: number
}

type PresenceRecord = Omit<SupportPeer, "color">

const STALE_MS = 12_000
const COLORS = [
  "#f97316",
  "#22c55e",
  "#38bdf8",
  "#a855f7",
  "#ef4444",
  "#eab308",
  "#14b8a6",
  "#fb7185",
]

const globalKey = "__wmsSupportPresenceStore"

type Store = {
  peers: Map<string, PresenceRecord>
}

function getStore(): Store {
  const g = globalThis as typeof globalThis & { [globalKey]?: Store }
  if (!g[globalKey]) g[globalKey] = { peers: new Map() }
  return g[globalKey]!
}

export function peerColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return COLORS[hash % COLORS.length]!
}

function prune(now = Date.now()) {
  const store = getStore()
  for (const [id, peer] of store.peers) {
    if (now - peer.lastSeen > STALE_MS) store.peers.delete(id)
  }
}

function resolveHostId(clientId: string, seen = new Set<string>()): string {
  if (seen.has(clientId)) return clientId
  seen.add(clientId)
  const peer = getStore().peers.get(clientId)
  if (!peer?.followClientId) return clientId
  if (!getStore().peers.has(peer.followClientId)) return clientId
  return resolveHostId(peer.followClientId, seen)
}

function toPublic(peer: PresenceRecord): SupportPeer {
  return { ...peer, color: peerColor(peer.userId) }
}

export function upsertPresence(input: {
  clientId: string
  userId: string
  login: string
  displayName: string
  path: string
  x: number
  y: number
  followClientId: string | null
}): { self: SupportPeer; online: SupportOnlineUser[]; peers: SupportPeer[]; hostPath: string | null } {
  prune()
  const store = getStore()
  const clientId = input.clientId.slice(0, 64)
  let follow = input.followClientId?.slice(0, 64) || null
  if (follow === clientId) follow = null
  if (follow && !store.peers.has(follow)) follow = null

  const record: PresenceRecord = {
    clientId,
    userId: input.userId,
    login: input.login,
    displayName: input.displayName,
    path: input.path.slice(0, 500) || "/",
    x: clamp01(input.x),
    y: clamp01(input.y),
    followClientId: follow,
    lastSeen: Date.now(),
  }
  store.peers.set(clientId, record)

  const hostId = resolveHostId(clientId)
  const host = store.peers.get(hostId) ?? record
  const roomPeers = [...store.peers.values()]
    .filter((peer) => resolveHostId(peer.clientId) === hostId)
    .map(toPublic)

  return {
    self: toPublic(record),
    online: listOnline(),
    peers: roomPeers,
    hostPath: follow ? host.path : null,
  }
}

export function listOnline(): SupportOnlineUser[] {
  prune()
  const byUser = new Map<string, { best: PresenceRecord; count: number }>()
  for (const peer of getStore().peers.values()) {
    const existing = byUser.get(peer.userId)
    if (!existing) {
      byUser.set(peer.userId, { best: peer, count: 1 })
      continue
    }
    existing.count += 1
    if (peer.lastSeen > existing.best.lastSeen) existing.best = peer
  }
  return [...byUser.values()]
    .map(({ best, count }) => ({
      userId: best.userId,
      login: best.login,
      displayName: best.displayName,
      path: best.path,
      clientId: best.clientId,
      color: peerColor(best.userId),
      peerCount: count,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"))
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}
