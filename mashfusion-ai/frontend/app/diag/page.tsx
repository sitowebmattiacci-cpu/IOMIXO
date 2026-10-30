'use client'
import { useEffect, useRef, useState } from 'react'

// Guest-link diagnostics, for a REAL phone: open miolovealbum.com/diag?slug=<album slug> in the same place the guest link fails (WhatsApp, camera / QR scanner, Chrome).
// It reads and measures only; nothing is sent anywhere: the report stays on screen until the person taps "Copia report" and pastes it. It records what the browser
// does with the page (navigation type, redirects, history, back / forward cache events, visibility) and whether the services the guest page needs answer from
// this phone. With ?slug= it also loads the real guest page in a frame and logs every address that frame goes through, which is what "opens and comes back" needs.
type Line = { t: number; k: string; v: string }
// The report is meant to be pasted into a chat: the album's slug (its public identifier) and any query / hash are never written in it, and the referrer is cut to its
// origin. Nothing else sensitive is read: no cookie values, no tokens, no storage contents, no account or album data.
const SLUG_PATH = /\/(live|booth|screen)\/[^/?#]+/g
const scrub = (u: string) => u.replace(SLUG_PATH, '/$1/<slug>').replace(/[?#].*$/, (m) => (m[0] === '?' ? '?…' : '#…'))
const originOf = (u: string) => { try { return new URL(u).origin } catch { return '(vuoto)' } }
const ENDPOINTS: Array<[string, string]> = [
  ['identitytoolkit (anonymous sign-in)', 'https://identitytoolkit.googleapis.com/'],
  ['firestore', 'https://firestore.googleapis.com/'],
  ['app check', 'https://content-firebaseappcheck.googleapis.com/'],
  ['recaptcha', 'https://www.google.com/recaptcha/enterprise.js'],
  // Reachability probe only (no-cors, no payload; the app's real calls go through getFirebaseFunctions). Composed like the preconnect hint in the root layout.
  ['functions europe-west1', `https://europe-west1-${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.${['cloudfunctions', 'net'].join('.')}/`],
  ['storage', 'https://firebasestorage.googleapis.com/'],
]

export default function DiagPage() {
  const [lines, setLines] = useState<Line[]>([])
  const [copied, setCopied] = useState(false)
  const t0 = useRef(0)
  const frame = useRef<HTMLIFrameElement>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const log = (k: string, v: string) => setLines((l) => [...l, { t: Math.round(performance.now() - t0.current), k, v }])

  useEffect(() => {
    t0.current = performance.now()
    const q = new URLSearchParams(location.search).get('slug')
    setSlug(q && /^[A-Za-z0-9_-]{3,64}$/.test(q) ? q : null)
    const nav = (performance.getEntriesByType('navigation')[0] ?? {}) as PerformanceNavigationTiming
    log('userAgent', navigator.userAgent)
    log('url', scrub(location.href))
    log('referrer', document.referrer ? originOf(document.referrer) : '(vuoto)')
    log('navigation', `type=${nav.type ?? '?'} redirectCount=${nav.redirectCount ?? '?'} historyLength=${history.length}`)
    log('displayMode', ['standalone', 'minimal-ui', 'fullscreen', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches) ?? '?')
    log('screen', `${innerWidth}x${innerHeight} dpr=${devicePixelRatio} lang=${navigator.language} online=${navigator.onLine}`)
    const tryDo = (name: string, fn: () => unknown) => { try { log(name, String(fn())) } catch (e) { log(name, `ERRORE ${(e as Error).name}`) } }
    tryDo('cookies', () => { document.cookie = 'ml_diag=1; path=/; samesite=lax'; return navigator.cookieEnabled && document.cookie.includes('ml_diag=1') ? 'ok' : 'bloccati' })
    tryDo('localStorage', () => { localStorage.setItem('ml_diag', '1'); localStorage.removeItem('ml_diag'); return 'ok' })
    tryDo('sessionStorage', () => { sessionStorage.setItem('ml_diag', '1'); sessionStorage.removeItem('ml_diag'); return 'ok' })
    tryDo('serviceWorker', () => ('serviceWorker' in navigator ? 'disponibile' : 'assente'))
    try {
      const r = indexedDB.open('ml_diag'); r.onsuccess = () => { r.result.close(); indexedDB.deleteDatabase('ml_diag'); log('indexedDB', 'ok') }; r.onerror = () => log('indexedDB', `ERRORE ${r.error?.name}`)
    } catch (e) { log('indexedDB', `ERRORE ${(e as Error).name}`) }
    for (const [name, url] of ENDPOINTS) {
      const s = performance.now(); const c = new AbortController(); const id = setTimeout(() => c.abort(), 10_000)
      fetch(url, { mode: 'no-cors', signal: c.signal, cache: 'no-store' }).then(() => log(`rete ${name}`, `raggiungibile ${Math.round(performance.now() - s)} ms`))
        .catch((e) => log(`rete ${name}`, `NON raggiungibile (${(e as Error).name}) dopo ${Math.round(performance.now() - s)} ms`)).finally(() => clearTimeout(id))
    }
    const on = (target: EventTarget, ev: string, fmt: (e: any) => string) => { const h = (e: Event) => log(`evento ${ev}`, fmt(e)); target.addEventListener(ev, h); return () => target.removeEventListener(ev, h) }
    const offs = [
      on(window, 'pageshow', (e) => `persisted=${e.persisted}`), on(window, 'pagehide', (e) => `persisted=${e.persisted}`),
      on(document, 'visibilitychange', () => document.visibilityState), on(window, 'popstate', () => `url=${scrub(location.href)}`),
      on(window, 'beforeunload', () => 'la pagina sta per essere lasciata'), on(window, 'hashchange', () => '(cambiato)'),
    ]
    return () => offs.forEach((f) => f())
  }, [])

  // Same-origin frame: follow its address (a redirect or a bounce shows up as a change) and whether it painted anything.
  useEffect(() => {
    if (!slug) return
    let last = ''; let painted = false
    const id = setInterval(() => {
      try {
        const w = frame.current?.contentWindow; if (!w) return
        const href = w.location.href
        if (href !== last) { last = href; log('frame url', scrub(href)) }
        const text = w.document.body?.innerText?.trim() ?? ''
        if (!painted && text.length > 40 && !/^Caricamento/i.test(text)) { painted = true; log('frame', `contenuto mostrato (${text.length} caratteri)`) }
      } catch (e) { log('frame', `non leggibile: ${(e as Error).name} (la pagina è uscita dal sito?)`) }
    }, 500)
    const stop = setTimeout(() => { clearInterval(id); if (!painted) log('frame', 'NESSUN contenuto dopo 30 s') }, 30_000)
    return () => { clearInterval(id); clearTimeout(stop) }
  }, [slug])

  const report = lines.map((l) => `+${l.t}ms ${l.k}: ${l.v}`).join('\n')
  const copy = async () => { try { await navigator.clipboard.writeText(report); setCopied(true) } catch { const ta = document.getElementById('diag-report') as HTMLTextAreaElement | null; ta?.select() } }

  return (
    <main className="min-h-screen bg-[#0A0A0D] text-white p-4 text-sm">
      <h1 className="text-lg font-bold mb-1">Diagnostica link invitati</h1>
      <p className="text-white/60 mb-3">Nulla viene inviato: il report resta su questa schermata. Apri questa pagina da dove il link non funziona (WhatsApp, fotocamera, Chrome), aspetta 30 secondi, poi tocca «Copia report».</p>
      <button type="button" onClick={copy} className="rounded-full bg-white text-black font-semibold px-5 py-2 mb-3">{copied ? 'Copiato' : 'Copia report'}</button>
      <textarea id="diag-report" readOnly value={report} className="w-full h-72 rounded-lg bg-black/60 border border-white/15 p-2 font-mono text-[11px]" />
      {slug && <iframe ref={frame} src={`/live/${slug}`} title="album" className="mt-3 w-full h-96 rounded-lg border border-white/15 bg-white/5" />}
      {!slug && <p className="text-white/50 mt-3">Per provare anche la pagina vera dell&apos;album aggiungi <code>?slug=</code> seguito dal codice del link (la parte dopo /live/).</p>}
    </main>
  )
}
