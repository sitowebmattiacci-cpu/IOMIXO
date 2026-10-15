import http from 'node:http'
import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser } from 'playwright-core'

/**
 * Local browser harness (NO production): Firebase emulators (started by `firebase emulators:exec`), a fake "Render" HTTP server that records every legacy call
 * (answers 503 unless a test registers a route), the Next.js dev server pointed at both, and the system Chrome driven by playwright-core.
 */
export const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export interface LegacyCall { method: string; path: string; body: any }
export interface FakeRender { url: string; calls: LegacyCall[]; routes: Map<string, (c: LegacyCall) => unknown>; close(): Promise<void> }

export async function startFakeRender(): Promise<FakeRender> {
  const calls: LegacyCall[] = [], routes = new Map<string, (c: LegacyCall) => unknown>()
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c })
    req.on('end', () => {
      res.setHeader('access-control-allow-origin', req.headers.origin ?? '*'); res.setHeader('access-control-allow-headers', '*'); res.setHeader('access-control-allow-methods', '*')
      res.setHeader('access-control-allow-credentials', 'true'); res.setHeader('content-type', 'application/json')
      if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
      const path = (req.url ?? '').split('?')[0]
      const call = { method: req.method!, path, body: raw ? JSON.parse(raw) : null }; calls.push(call)
      const handler = routes.get(`${call.method} ${path}`) ?? Array.from(routes.entries()).find(([k]) => { const [m, p] = k.split(' '); return m === call.method && p.endsWith('*') && path.startsWith(p.slice(0, -1)) })?.[1]
      if (!handler) { res.statusCode = 503; res.end(JSON.stringify({ error: 'render suspended' })); return }
      res.end(JSON.stringify({ data: handler(call) }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, calls, routes, close: () => new Promise((r) => server.close(() => r())) }
}

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) }) })

export interface App { url: string; port: number; stop(): Promise<void> }
export async function startNext(render: FakeRender, extraEnv: Record<string, string> = {}): Promise<App> {
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_FIREBASE_USE_EMULATORS: 'true', NEXT_PUBLIC_API_URL: render.url,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'unused-in-emulator-mode',        // never the real project
    NEXT_PUBLIC_FIRESTORE_OWNER_OPS: 'true', NEXT_PUBLIC_FIRESTORE_PUBLIC_READ: 'true', ...extraEnv,
  }
  const child: ChildProcess = spawn('npx', ['next', 'dev', '-p', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; child.stdout!.on('data', (d) => { log += d }); child.stderr!.on('data', (d) => { log += d })
  const t0 = Date.now()
  for (;;) {
    if (/Ready in|ready - started|Local:/.test(log)) break
    if (child.exitCode !== null) throw new Error('next dev exited: ' + log.slice(-800))
    if (Date.now() - t0 > 90_000) throw new Error('next dev did not start: ' + log.slice(-800))
    await new Promise((r) => setTimeout(r, 300))
  }
  return { url: `http://127.0.0.1:${port}`, port, stop: async () => { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 500)); child.kill('SIGKILL') } }
}

export const launch = (): Promise<Browser> => chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })

// ── Host simulation: the real portal hostnames resolve to the local dev server, so hostname detection, redirects and metadata run for real ──
export const PORTAL_HOSTS = ['iomixo.com', 'www.iomixo.com', 'miolovealbum.com', 'www.miolovealbum.com'] as const
/** http://<portal host>:<dev port> — the same Next dev server answers as iomixo.com or miolovealbum.com. */
export const portalUrl = (app: App, host: (typeof PORTAL_HOSTS)[number]) => `http://${host}:${app.port}`
export const launchPortals = (app: App): Promise<Browser> => chromium.launch({
  executablePath: CHROME, headless: true,
  args: [
    '--no-sandbox',
    `--host-resolver-rules=${PORTAL_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`,
    `--unsafely-treat-insecure-origin-as-secure=${PORTAL_HOSTS.map((h) => portalUrl(app, h)).join(',')}`,
  ],
})
