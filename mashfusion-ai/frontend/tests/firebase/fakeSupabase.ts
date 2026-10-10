import { createServer, type Server } from 'http'
import { randomUUID } from 'crypto'

/** Minimal PostgREST stand-in for `live_requests` used by the Functions bridge in tests. */
export interface FakeSupabase {
  rows: Array<{ id: string; session_id: string; track_title: string; artist: string | null; message: string | null }>
  dedications: Array<{ id: string; session_id: string; guest_name: string | null; message: string }>
  pollVotes: Map<string, number>
  presetCount: Record<string, number>
  failInserts: boolean
  close(): Promise<void>
}

export async function startFakeSupabase(port = 54321): Promise<FakeSupabase> {
  const fake: FakeSupabase = { rows: [], dedications: [], pollVotes: new Map(), presetCount: {}, failInserts: false, close: async () => {} }
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '', 'http://x')
    if (url.pathname === '/rest/v1/live_poll_votes' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (fake.failInserts) { res.statusCode = 500; return res.end('down') }
        const v = JSON.parse(body)
        fake.pollVotes.set(`${v.poll_id}|${v.ip_hash}`, v.option_index) // on_conflict=poll_id,ip_hash
        res.statusCode = 201; res.end()
      })
      return
    }
    const table = url.pathname === '/rest/v1/live_dedications' ? 'dedications' : url.pathname === '/rest/v1/live_requests' ? 'rows' : null
    if (!table) { res.statusCode = 404; return res.end() }
    if (req.headers.apikey !== 'test-key') { res.statusCode = 401; return res.end('bad key') }
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (fake.failInserts) { res.statusCode = 500; return res.end('down') }
        const row = { id: randomUUID(), ...JSON.parse(body) }
        ;(fake[table] as any[]).push(row)
        res.setHeader('content-type', 'application/json'); res.statusCode = 201; res.end(JSON.stringify([row]))
      })
      return
    }
    // GET count
    const sid = (url.searchParams.get('session_id') ?? '').replace('eq.', '')
    const n = (fake.presetCount[sid] ?? 0) + fake.rows.filter((r) => r.session_id === sid).length
    res.setHeader('content-range', `0-0/${n}`); res.setHeader('content-type', 'application/json'); res.statusCode = 200; res.end('[]')
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  fake.close = () => new Promise((r) => server.close(() => r()))
  return fake
}
