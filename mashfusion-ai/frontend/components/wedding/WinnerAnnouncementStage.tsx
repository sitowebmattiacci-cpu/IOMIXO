'use client'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Wedding Edition · Proclamazione Vincitore (Screen overlay)
// Sezione "Strumenti finali". NON è un gioco: nessun punteggio, nessuna
// classifica, nessuna scelta casuale. Il DJ carica due foto (sposo/sposa),
// seleziona manualmente il vincitore e avvia la proclamazione.
//
// Idempotenza dell'animazione (reload safe):
// - Lo stato è derivato SOLO da (phase, started_at, run_id).
// - `run_id` cambia solo su "Avvia" → la suspense parte una sola volta per run.
// - Se lo Screen viene ricaricato durante la suspense, riprende dal punto
//   temporale corrispondente. Se ricaricato dopo la durata prevista, mostra
//   direttamente il reveal statico (nessuna suspense).
// ════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type {
  WinnerAnnouncementConfig,
  WinnerAnnouncementRole,
} from '@/lib/api'
import { useI18n } from '@/lib/i18n'

/** Durata totale della suspense (alternanza rallentata sposo/sposa). */
const SUSPENSE_MS = 4500
/** Durata dell'animazione dei coriandoli dopo il reveal. */
const CONFETTI_MS = 5000

type StagePayload = WinnerAnnouncementConfig & {
  groom_photo_url?: string | null
  bride_photo_url?: string | null
}

interface Props {
  /** Config sarcificato dal backend (con signed URLs). */
  state: StagePayload | null | undefined
  /** couple_names della sessione (fallback per i nomi). */
  coupleNames?: string | null
  /** Font family principale (coerente con lo stile Screen Wedding). */
  fontFamily?: string
}

// ── Utility ─────────────────────────────────────────────────────

function safeParseIso(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/** Split di fallback su couple_names quando i campi dedicati sono vuoti. */
function splitCoupleNames(couple: string | null | undefined): [string | null, string | null] {
  if (!couple) return [null, null]
  const trimmed = couple.trim()
  if (!trimmed) return [null, null]
  // Separatori accettati (case insensitive, con spazi attorno).
  const separators = [' & ', ' + ', ' e ', ' E ', ' and ', ' AND ', ' y ', ' Y ', ' et ', ' ET ']
  for (const sep of separators) {
    const idx = trimmed.indexOf(sep)
    if (idx > 0) {
      const a = trimmed.slice(0, idx).trim()
      const b = trimmed.slice(idx + sep.length).trim()
      if (a && b) return [a, b]
    }
  }
  return [null, null]
}

/** Curva easeOutCubic per rallentare l'alternanza verso la fine. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// ── Componente ──────────────────────────────────────────────────

export function WinnerAnnouncementStage({ state, coupleNames, fontFamily }: Props) {
  const { t } = useI18n()
  // Tick 60ms durante la suspense per aggiornare l'alternanza.
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!state) return
    if (state.phase !== 'running') return
    const startedAt = safeParseIso(state.started_at) ?? Date.now()
    const elapsed = Date.now() - startedAt
    // Nessun tick se la suspense è già finita: reveal statico, niente polling.
    if (elapsed >= SUSPENSE_MS + CONFETTI_MS + 500) return
    const id = window.setInterval(() => setNow(Date.now()), 60)
    return () => window.clearInterval(id)
  }, [state?.phase, state?.started_at, state?.run_id])

  // Traccia il run_id già animato per evitare re-avvii spuri (safety net).
  const lastAnimatedRun = useRef<string | null>(null)
  useEffect(() => {
    if (state?.phase === 'running' && state?.run_id) {
      lastAnimatedRun.current = state.run_id
    }
  }, [state?.phase, state?.run_id])

  if (!state) return null
  if (state.phase === 'hidden') return null

  const groomUrl = state.groom_photo_url ?? null
  const brideUrl = state.bride_photo_url ?? null

  // Nomi: prima i campi dedicati, poi split di couple_names, poi label generiche.
  const [splitGroom, splitBride] = splitCoupleNames(coupleNames)
  const groomName = (state.groom_name ?? '').trim() || splitGroom || t('weddingPanels.winnerGenericGroom')
  const brideName = (state.bride_name ?? '').trim() || splitBride || t('weddingPanels.winnerGenericBride')

  const startedAt = safeParseIso(state.started_at)
  const elapsed = startedAt != null ? Math.max(0, now - startedAt) : 0

  // Fase resa: derivata da config + tempo. Nessuna scrittura server necessaria.
  //  - stopped → freeze, entrambe visibili con pari importanza, nessun reveal
  //  - running & elapsed < SUSPENSE_MS → suspense in corso
  //  - running & elapsed >= SUSPENSE_MS → reveal (persistente anche a reload)
  //  - revealed → reveal
  const isStopped = state.phase === 'stopped'
  const isRunning = state.phase === 'running'
  const isRevealed = state.phase === 'revealed' || (isRunning && elapsed >= SUSPENSE_MS)
  const isSuspense = isRunning && elapsed < SUSPENSE_MS

  // Coriandoli: solo nei primi CONFETTI_MS dopo il reveal (transizione).
  // Se lo Screen viene ricaricato dopo, i coriandoli non ripartono.
  const revealElapsed = isRevealed && startedAt != null
    ? Math.max(0, now - startedAt - SUSPENSE_MS)
    : Infinity
  const showConfetti = isRevealed && revealElapsed < CONFETTI_MS

  // Alternanza rallentata durante la suspense.
  const highlight: WinnerAnnouncementRole | null = (() => {
    if (isRevealed) return state.winner
    if (isStopped) return null
    if (!isSuspense) return null
    const progress = Math.min(1, elapsed / SUSPENSE_MS)
    const eased = easeOutCubic(progress)
    const totalFlips = 14
    const flips = Math.floor(eased * totalFlips)
    return flips % 2 === 0 ? 'groom' : 'bride'
  })()

  const winner = state.winner
  const headline = isRevealed
    ? t('weddingPanels.winnerCongrats')
    : isSuspense
      ? t('weddingPanels.winnerScreenQuestion')
      : t('weddingPanels.winnerScreenPreReveal')

  const revealText = winner === 'groom'
    ? t('weddingPanels.winnerIsGroom').replace('{name}', groomName.toUpperCase())
    : winner === 'bride'
      ? t('weddingPanels.winnerIsBride').replace('{name}', brideName.toUpperCase())
      : ''

  return (
    <motion.div
      key="winner-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-[80] flex items-center justify-center px-8 py-10 pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Backdrop elegante (sfondo scuro con velo dorato/champagne) */}
      <div className="absolute inset-0 bg-gradient-to-br from-wedding-night/95 via-[#1a1520]/95 to-wedding-night/95 backdrop-blur-md" />
      <div className="absolute top-0 left-1/4 h-[520px] w-[520px] rounded-full bg-wedding-gold/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 h-[440px] w-[440px] rounded-full bg-wedding-blush/12 blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-[1600px] flex flex-col items-center gap-10">
        {/* Headline */}
        <div className="text-center">
          <p className="text-[11px] sm:text-sm uppercase tracking-[0.42em] text-wedding-gold/80 mb-3">
            {t('weddingPanels.winnerEyebrow')}
          </p>
          <h1
            className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-wedding-ivory tracking-tight leading-[1.05]"
            style={{ fontFamily }}
          >
            {headline}
          </h1>
          <div className="mt-4 mx-auto h-px w-40 bg-gradient-to-r from-transparent via-wedding-gold/60 to-transparent" />
        </div>

        {/* Due foto affiancate */}
        <div className="grid grid-cols-2 gap-8 sm:gap-14 lg:gap-24 w-full items-end justify-items-center">
          <PhotoCard
            role="groom"
            label={groomName}
            photoUrl={groomUrl}
            highlighted={highlight === 'groom'}
            isWinner={isRevealed && winner === 'groom'}
            isLoser={isRevealed && winner === 'bride'}
            neutral={isStopped}
          />
          <PhotoCard
            role="bride"
            label={brideName}
            photoUrl={brideUrl}
            highlighted={highlight === 'bride'}
            isWinner={isRevealed && winner === 'bride'}
            isLoser={isRevealed && winner === 'groom'}
            neutral={isStopped}
          />
        </div>

        {/* Testo finale */}
        <div className="min-h-[70px] flex items-center justify-center text-center">
          <AnimatePresence mode="wait">
            {isRevealed && winner && (
              <motion.p
                key={`reveal-${state.run_id ?? 'r'}`}
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="text-3xl sm:text-4xl md:text-5xl uppercase tracking-[0.22em] text-wedding-gold-soft/95"
                style={{ fontFamily }}
              >
                {revealText}
              </motion.p>
            )}
            {isStopped && (
              <motion.p
                key="stopped"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xl sm:text-2xl uppercase tracking-[0.32em] text-wedding-taupe"
              >
                — · —
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Coriandoli (solo durante la transizione post-reveal) */}
      {showConfetti && <ConfettiLayer seed={state.run_id ?? 'r'} />}
    </motion.div>
  )
}

// ── Card foto ───────────────────────────────────────────────────

function PhotoCard({
  role,
  label,
  photoUrl,
  highlighted,
  isWinner,
  isLoser,
  neutral,
}: {
  role: WinnerAnnouncementRole
  label: string
  photoUrl: string | null
  highlighted: boolean
  isWinner: boolean
  isLoser: boolean
  neutral: boolean
}) {
  const { t } = useI18n()
  // Stato visuale:
  // - winner  → scale up + halo dorato luminoso
  // - loser   → opacity ridotta + saturazione bassa
  // - highlighted (durante suspense) → lieve scale + glow morbido
  // - neutral (stopped) → entrambe pari importanza
  const scale = isWinner ? 1.08 : highlighted && !isLoser ? 1.03 : 1
  const opacity = isLoser ? 0.42 : 1
  const filter = isLoser ? 'saturate(0.55) brightness(0.85)' : 'none'
  const ringClass = isWinner
    ? 'ring-4 ring-wedding-gold/70 shadow-[0_0_90px_rgba(232,183,200,0.55),0_0_38px_rgba(143,29,44,0.55)]'
    : highlighted && !isLoser && !neutral
      ? 'ring-2 ring-wedding-champagne/70 shadow-[0_0_50px_rgba(232,183,200,0.35)]'
      : 'ring-1 ring-wedding-taupe/40'

  return (
    <motion.div
      className="flex flex-col items-center gap-5"
      animate={{ scale, opacity }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      style={{ filter }}
    >
      <div
        className={`relative w-[220px] h-[290px] sm:w-[280px] sm:h-[360px] md:w-[340px] md:h-[440px] lg:w-[400px] lg:h-[520px] rounded-[26px] overflow-hidden bg-wedding-taupe-light/20 transition-shadow duration-500 ${ringClass}`}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={label}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-wedding-taupe/70 text-sm uppercase tracking-[0.28em]">
              {role === 'groom' ? t('weddingPanels.winnerGenericGroom') : t('weddingPanels.winnerGenericBride')}
            </span>
          </div>
        )}
        {/* Halo dorato interno per il vincitore */}
        {isWinner && (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.15 }}
            style={{
              background:
                'radial-gradient(circle at 50% 40%, rgba(251,234,240,0.35), rgba(251,234,240,0) 65%)',
            }}
          />
        )}
      </div>
      <p
        className={`text-xl sm:text-2xl md:text-3xl uppercase tracking-[0.28em] transition-colors duration-500 ${
          isWinner
            ? 'text-wedding-gold-soft'
            : isLoser
              ? 'text-wedding-taupe'
              : 'text-wedding-ivory/90'
        }`}
      >
        {label}
      </p>
    </motion.div>
  )
}

// ── Coriandoli ──────────────────────────────────────────────────

function ConfettiLayer({ seed }: { seed: string }) {
  // Coriandoli oro/champagne/blush eleganti, non chiassosi. Cadono in ~5s.
  const pieces = useMemo(() => {
    // Seed derivativo: usa il run_id come chiave per rigenerare a ogni run.
    const rand = mulberry32(hashSeed(seed))
    return Array.from({ length: 48 }).map((_, i) => {
      const left = rand() * 100
      const delay = rand() * 1.6
      const duration = 3.4 + rand() * 2.2
      const drift = (rand() - 0.5) * 260
      const rotate = (rand() - 0.5) * 720
      const size = 6 + Math.floor(rand() * 8)
      const palette = ['#E8B7C8', '#FBEAF0', '#F5D7A1', '#B8A89A', '#8F1D2C']
      const color = palette[Math.floor(rand() * palette.length)]
      const shape = rand() > 0.55 ? 'rect' : 'circle'
      return { i, left, delay, duration, drift, rotate, size, color, shape }
    })
  }, [seed])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.i}
          className={`absolute top-[-8%] ${p.shape === 'circle' ? 'rounded-full' : 'rounded-[2px]'}`}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.shape === 'circle' ? p.size : p.size * 1.6,
            background: p.color,
            boxShadow: `0 0 6px ${p.color}55`,
          }}
          initial={{ y: -30, x: 0, rotate: 0, opacity: 0 }}
          animate={{
            y: '110vh',
            x: p.drift,
            rotate: p.rotate,
            opacity: [0, 1, 1, 0.85, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: 'linear',
            times: [0, 0.1, 0.6, 0.85, 1],
          }}
        />
      ))}
    </div>
  )
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
