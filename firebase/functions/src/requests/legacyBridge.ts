import { randomUUID } from 'node:crypto'
import { logger } from 'firebase-functions/logger'

/**
 * TRANSITIONAL bridge to Supabase `live_requests` (still the source of truth for the
 * legacy DJ dashboard / remote / my-requests routes). Delete with Supabase.
 * Plain PostgREST over fetch with the service-role key (Functions secret) — never exposed to clients.
 */
export interface LegacyBridge {
  /** Inserts the request and returns the Supabase row id. */
  insert(row: { sessionId: string; songTitle: string; artist: string | null; message: string | null }): Promise<string>
  /** Inserts a dedication into live_dedications and returns the Supabase row id. */
  insertDedication(row: { sessionId: string; senderName: string | null; message: string }): Promise<string>
  /** Idempotent vote upsert keyed by (poll, guest): one row per guest, a second call changes the option. */
  upsertPollVote(row: { pollId: string; guestKey: string; optionIndex: number }): Promise<void>
  /** Current number of requests of a session (seeds the Firestore counter). */
  count(sessionId: string): Promise<number>
}

export function supabaseBridge(env: NodeJS.ProcessEnv = process.env): LegacyBridge {
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Legacy bridge enabled but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set')
  const headers = { apikey: key, Authorization: `Bearer ${key}` }

  async function insertRow(table: string, body: object): Promise<string> {
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`supabase insert into ${table} failed: ${res.status}`)
    const rows = (await res.json()) as Array<{ id: string }>
    if (!rows[0]?.id) throw new Error('supabase insert returned no id')
    return rows[0].id
  }

  return {
    insert: (r) => insertRow('live_requests', { session_id: r.sessionId, track_title: r.songTitle, artist: r.artist, message: r.message }),
    async upsertPollVote(r) {
      const res = await fetch(`${url}/rest/v1/live_poll_votes?on_conflict=poll_id,ip_hash`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ poll_id: r.pollId, ip_hash: r.guestKey, option_index: r.optionIndex }),
      })
      if (!res.ok) throw new Error(`supabase vote upsert failed: ${res.status}`)
    },
    insertDedication: (r) => insertRow('live_dedications', { session_id: r.sessionId, guest_name: r.senderName, message: r.message }),
    async count(sessionId) {
      const res = await fetch(`${url}/rest/v1/live_requests?session_id=eq.${encodeURIComponent(sessionId)}&select=id`, {
        headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
      })
      if (!res.ok) throw new Error(`supabase count failed: ${res.status}`)
      const total = res.headers.get('content-range')?.split('/')[1]
      const n = Number(total)
      if (!Number.isFinite(n)) throw new Error('supabase count: bad content-range')
      return n
    },
  }
}

export type BridgeMode = 'mock' | 'none' | 'supabase'

/**
 * Strict parse of LEGACY_BRIDGE. FAIL CLOSED: a missing or unknown value throws, there is never an
 * implicit fallback to Supabase. `supabase` must be chosen explicitly.
 */
export function bridgeMode(env: NodeJS.ProcessEnv = process.env): BridgeMode {
  const v = env.LEGACY_BRIDGE
  if (v === 'mock' || v === 'none' || v === 'supabase') return v
  throw new Error(`LEGACY_BRIDGE must be one of mock | none | supabase (got ${v === undefined ? 'nothing' : 'an unknown value'})`)
}

export interface MockBridgeOptions {
  /** Structured log sink (default: Cloud Logging). Never receives the payload, only the operation. */
  log?: (op: string) => void
  /** TEST ONLY: operations that must throw, to exercise rollback. Not reachable from env or client input. */
  failOn?: ReadonlyArray<keyof LegacyBridge>
}

/**
 * No-network stand-in for the Supabase bridge, for cloud tests with real Auth/Firestore/transactions.
 * Contains no fetch / URL / key: it cannot reach Supabase. Each call logs `legacy_bridge_mock op=...`.
 */
export function mockBridge(opts: MockBridgeOptions = {}): LegacyBridge {
  const log = opts.log ?? ((op: string) => logger.info('legacy_bridge_mock', { bridge: 'mock', op }))
  const run = <T>(op: keyof LegacyBridge, value: T): T => {
    log(op)
    if (opts.failOn?.includes(op)) throw new Error(`mock bridge forced failure (${op})`)
    return value
  }
  return {
    insert: async () => run('insert', `mock-${randomUUID()}`),
    insertDedication: async () => run('insertDedication', `mock-${randomUUID()}`),
    upsertPollVote: async () => run('upsertPollVote', undefined),
    count: async () => run('count', 0),
  }
}

/** none → Firestore-only (end state, null bridge); mock → isolated test bridge; supabase → explicit opt-in only. */
export function bridgeFromEnv(env: NodeJS.ProcessEnv = process.env): LegacyBridge | null {
  switch (bridgeMode(env)) {
    case 'none': return null
    case 'mock': return mockBridge()
    case 'supabase': return supabaseBridge(env)
  }
}
