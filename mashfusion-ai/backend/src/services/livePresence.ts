// In-memory presence tracking per live session.
// Maps sessionId → (ipHash → lastSeenTs). A client is "online" if its last
// heartbeat is within PRESENCE_WINDOW_MS. Single-instance only; TODO move
// to Redis when scaling backend horizontally.

const PRESENCE_WINDOW_MS = 30_000

const presence = new Map<string, Map<string, number>>()

export function markPresent(sessionId: string, hash: string): void {
  let inner = presence.get(sessionId)
  if (!inner) {
    inner = new Map()
    presence.set(sessionId, inner)
  }
  inner.set(hash, Date.now())
}

export function countOnline(sessionId: string): number {
  const inner = presence.get(sessionId)
  if (!inner) return 0
  const cutoff = Date.now() - PRESENCE_WINDOW_MS
  let n = 0
  for (const [h, ts] of inner) {
    if (ts < cutoff) inner.delete(h)
    else n++
  }
  if (inner.size === 0) presence.delete(sessionId)
  return n
}
