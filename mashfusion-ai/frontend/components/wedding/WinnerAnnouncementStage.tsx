'use client'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Wedding Edition · Proclamazione Vincitore (Screen overlay)
// Versione CINEMATOGRAFICA PREMIUM (B + C + D + E).
//
// NON è un gioco: nessun punteggio, nessuna classifica, nessuna scelta
// casuale. Il DJ carica due foto (sposo/sposa), seleziona manualmente il
// vincitore e avvia la proclamazione.
//
// Regia della scena:
//  - Suspense (4.5s): alternanza con easeOutExpo (rallentamento drammatico),
//    heartbeat pulse sulla card highlightata, scintille dorate orbitanti,
//    micro camera-shake progressivo negli ultimi ~800ms.
//  - Flash (150ms): velo bianco-dorato che maschera il reveal.
//  - Reveal (~1.5s di transizione): perdente scale 0.75 + blur + fade,
//    vincitore scale 1.18 + shift verso il centro + cornice dorata SVG che
//    si disegna progressivamente + corona SVG con bounce + raggi di luce
//    dorati dietro il vincitore.
//  - Coriandoli (5s): 3 wave burst (~120 elementi), 3 livelli di profondità
//    (blur + size), origini centro / angoli superiori / centro-alto,
//    streamers sottili + cerchi + rettangoli, rotazione 3D via scaleX.
//  - Typography reveal: "IL VINCITORE È" (piccolo) + nome del vincitore
//    lettera-per-lettera con stagger 40ms + ruolo "SPOSO"/"SPOSA" 400ms dopo.
//
// Idempotenza (reload safe):
//  - Lo stato è derivato SOLO da (phase, started_at, run_id).
//  - `run_id` cambia solo su "Avvia" → la scena parte una sola volta per run.
//  - Se lo Screen viene ricaricato durante la suspense o durante il reveal,
//    riprende dal punto temporale corrispondente (nessun re-avvio spurio).
//  - Coriandoli / flash / scintille non ripartono se elapsed > delle rispettive
//    finestre temporali.
//
// Performance:
//  - Tutte le particelle usano solo `transform` + `opacity` (composited GPU).
//  - `will-change` applicato agli elementi animati per hint al compositor.
//  - Blur applicato SOLO come layer statico (mai animato).
//  - Nessuna nuova dipendenza: framer-motion + SVG inline già disponibili.
// ════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type {
  WinnerAnnouncementConfig,
  WinnerAnnouncementRole,
} from '@/lib/api'
import { useI18n } from '@/lib/i18n'

// ── Timing map (deterministico da started_at) ────────────────────
/** Durata totale della suspense (alternanza rallentata sposo/sposa). */
const SUSPENSE_MS = 8000
/** Durata del flash bianco-dorato al reveal. */
const FLASH_MS = 180
/** Ultimi ms di suspense in cui si attiva il camera shake progressivo. */
const SHAKE_WINDOW_MS = 1400
/** Periodo del pulse heartbeat sulla card highlightata (2 battiti per periodo). */
const HEARTBEAT_PERIOD_MS = 900
/** Durata dell'animazione dei coriandoli dopo il reveal. */
const CONFETTI_MS = 5000
/** Tick per animazioni tempo-derivate (shake/heartbeat/alternanza). */
const TICK_MS = 40

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

/** Curva easeOutExpo — rallentamento molto marcato sul finale (drum-roll). */
function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/**
 * Camera shake deterministico basato sul tempo trascorso.
 * Si attiva solo negli ultimi SHAKE_WINDOW_MS della suspense.
 * Ampiezza cresce con easeOutCubic da 0 a ~3px per non risultare aggressivo.
 * L'output è deterministico rispetto a `elapsed` + `seed`, quindi reload-safe.
 */
function shakeAt(elapsed: number, seed: string): { x: number; y: number } {
  const shakeStart = SUSPENSE_MS - SHAKE_WINDOW_MS
  if (elapsed < shakeStart || elapsed >= SUSPENSE_MS) return { x: 0, y: 0 }
  const t = (elapsed - shakeStart) / SHAKE_WINDOW_MS // 0..1
  const amp = 3 * easeOutCubic(t) // cresce fino a ~3px
  const h = hashSeed(seed) & 0xff
  const phase = elapsed / 40 + h
  return {
    x: Math.sin(phase * 0.7) * amp,
    y: Math.cos(phase * 0.9) * amp * 0.6,
  }
}

/**
 * Pulse heartbeat (lub-dub) sulla card highlightata durante la suspense.
 * Somma di due sinusoidi (freq base + doppia freq) per simulare battito.
 * Ampiezza ~±0.04 (scale 0.96..1.04).
 */
function heartbeatScale(elapsed: number): number {
  if (elapsed >= SUSPENSE_MS) return 1
  const t = (elapsed % HEARTBEAT_PERIOD_MS) / HEARTBEAT_PERIOD_MS
  const beat = Math.sin(t * Math.PI * 2) * 0.55 + Math.sin(t * Math.PI * 4) * 0.35
  return 1 + beat * 0.04
}

// ── Componente ──────────────────────────────────────────────────

export function WinnerAnnouncementStage({ state, coupleNames, fontFamily }: Props) {
  const { t } = useI18n()
  // Tick continuo (TICK_MS) durante suspense/reveal per aggiornare
  // shake / heartbeat / alternanza / gate coriandoli. Si ferma automaticamente
  // dopo la fine della finestra scenica (elapsed > SUSPENSE_MS + CONFETTI_MS).
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!state) return
    if (state.phase !== 'running') return
    const startedAt = safeParseIso(state.started_at) ?? Date.now()
    const elapsed = Date.now() - startedAt
    if (elapsed >= SUSPENSE_MS + CONFETTI_MS + 500) return
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
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
  const runId = state.run_id ?? 'r'

  // Fasi derivate (reload-safe):
  //  - stopped → freeze, entrambe visibili con pari importanza, nessun reveal
  //  - running & elapsed < SUSPENSE_MS → suspense in corso
  //  - running & elapsed >= SUSPENSE_MS → reveal (persistente anche a reload)
  //  - revealed → reveal statico
  const isStopped = state.phase === 'stopped'
  const isRunning = state.phase === 'running'
  const isRevealed = state.phase === 'revealed' || (isRunning && elapsed >= SUSPENSE_MS)
  const isSuspense = isRunning && elapsed < SUSPENSE_MS

  // Elapsed dal momento del reveal (per gate flash/coriandoli).
  const revealElapsed = isRevealed && startedAt != null
    ? Math.max(0, now - startedAt - SUSPENSE_MS)
    : Infinity
  const showConfetti = isRevealed && revealElapsed < CONFETTI_MS
  const showFlash = isRevealed && revealElapsed < FLASH_MS + 40

  // Alternanza con easeOutExpo (rallentamento drammatico verso la fine).
  const highlight: WinnerAnnouncementRole | null = (() => {
    if (isRevealed) return state.winner
    if (isStopped) return null
    if (!isSuspense) return null
    const progress = Math.min(1, elapsed / SUSPENSE_MS)
    const eased = easeOutExpo(progress)
    // 22 flip totali distribuiti su 8s con easeOutExpo: primi 4s scorrono
    // veloci (drum-roll), ultimi 4s rallentano molto per costruire tensione,
    // gli ultimi ~1.2s la card highlightata resta stabile prima del reveal.
    const totalFlips = 22
    const flips = Math.floor(eased * totalFlips)
    return flips % 2 === 0 ? 'groom' : 'bride'
  })()

  const winner = state.winner

  // Testo headline in base alla fase.
  const headline = isRevealed
    ? t('weddingPanels.winnerCongrats')
    : isSuspense
      ? t('weddingPanels.winnerScreenQuestion')
      : t('weddingPanels.winnerScreenPreReveal')

  // Blocco reveal typography: intro + nome + ruolo.
  const winnerName = winner === 'groom' ? groomName : winner === 'bride' ? brideName : ''
  const winnerRoleLabel = winner === 'groom'
    ? t('weddingPanels.winnerGenericGroom')
    : winner === 'bride'
      ? t('weddingPanels.winnerGenericBride')
      : ''
  // "IL VINCITORE È…" → strippo ellipsis per l'uso come intro line.
  const introText = t('weddingPanels.winnerScreenPreReveal').replace(/…$/, '').trim()

  // Micro camera-shake (solo durante SHAKE_WINDOW_MS finale della suspense).
  const shake = isSuspense ? shakeAt(elapsed, runId) : { x: 0, y: 0 }

  return (
    <motion.div
      key="winner-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-[80] flex items-center justify-center px-8 py-10 pointer-events-none overflow-hidden"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Backdrop elegante (sfondo scuro con velo dorato/champagne) */}
      <div className="absolute inset-0 bg-gradient-to-br from-wedding-night/95 via-[#1a1520]/95 to-wedding-night/95 backdrop-blur-md" />
      <div className="absolute top-0 left-1/4 h-[520px] w-[520px] rounded-full bg-wedding-gold/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 h-[440px] w-[440px] rounded-full bg-wedding-blush/12 blur-3xl pointer-events-none" />

      {/* Raggi di luce dorati (solo post-reveal, dietro tutto il contenuto). */}
      {isRevealed && winner && (
        <LightRays revealElapsed={revealElapsed} />
      )}

      {/* Wrapper contenuto con camera shake diretto via style
          (no framer transition, evita render costosi durante il tick 40ms). */}
      <div
        className="relative w-full max-w-[1600px] flex flex-col items-center gap-16 sm:gap-20"
        style={{
          transform: `translate3d(${shake.x}px, ${shake.y}px, 0)`,
          willChange: shake.x !== 0 || shake.y !== 0 ? 'transform' : undefined,
        }}
      >
        {/* Headline */}
        <div className="text-center">
          <p className="text-[11px] sm:text-sm uppercase tracking-[0.42em] text-wedding-gold/80 mb-3">
            {t('weddingPanels.winnerEyebrow')}
          </p>
          <AnimatePresence mode="wait">
            <motion.h1
              key={isRevealed ? 'h-reveal' : isSuspense ? 'h-suspense' : 'h-idle'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-wedding-ivory tracking-tight leading-[1.05]"
              style={{ fontFamily }}
            >
              {headline}
            </motion.h1>
          </AnimatePresence>
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
            isSuspense={isSuspense}
            heartbeat={isSuspense && highlight === 'groom' ? heartbeatScale(elapsed) : 1}
            runId={runId}
          />
          <PhotoCard
            role="bride"
            label={brideName}
            photoUrl={brideUrl}
            highlighted={highlight === 'bride'}
            isWinner={isRevealed && winner === 'bride'}
            isLoser={isRevealed && winner === 'groom'}
            neutral={isStopped}
            isSuspense={isSuspense}
            heartbeat={isSuspense && highlight === 'bride' ? heartbeatScale(elapsed) : 1}
            runId={runId}
          />
        </div>

        {/* Blocco reveal typography (intro + nome letter-by-letter + ruolo). */}
        <div className="min-h-[180px] flex items-center justify-center text-center">
          <AnimatePresence mode="wait">
            {isRevealed && winner && (
              <WinnerRevealText
                key={`reveal-${runId}`}
                introText={introText}
                nameText={winnerName.toUpperCase()}
                roleText={winnerRoleLabel.toUpperCase()}
                fontFamily={fontFamily}
              />
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

      {/* Flash bianco-dorato al reveal (150ms, top-most, non blocca layout). */}
      <AnimatePresence>
        {showFlash && (
          <motion.div
            key="flash"
            className="absolute inset-0 pointer-events-none z-[90]"
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(255,244,220,0.95) 0%, rgba(255,215,150,0.65) 28%, rgba(255,215,150,0.15) 55%, transparent 75%)',
              willChange: 'opacity',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{
              duration: FLASH_MS / 1000,
              times: [0, 0.35, 1],
              ease: 'easeOut',
            }}
          />
        )}
      </AnimatePresence>

      {/* Coriandoli premium (3 wave, ~120 pezzi, 3 livelli di profondità). */}
      {showConfetti && <ConfettiWaves seed={runId} />}
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
  isSuspense,
  heartbeat,
  runId,
}: {
  role: WinnerAnnouncementRole
  label: string
  photoUrl: string | null
  highlighted: boolean
  isWinner: boolean
  isLoser: boolean
  neutral: boolean
  isSuspense: boolean
  heartbeat: number
  runId: string
}) {
  const { t } = useI18n()
  // Stato visuale:
  // - winner  → scale 1.18 + shift verso il centro + cornice dorata + corona
  // - loser   → scale 0.75 + shift outward + blur + opacity 0.15 + saturazione bassa
  // - highlighted (suspense) → heartbeat pulse + glow morbido + scintille
  // - neutral (stopped) → entrambe pari importanza
  //
  // Shift orizzontale: percentuale della larghezza della card stessa
  // (funziona proporzionalmente ai vari breakpoint mantenendo la logica
  // "avvicinamento al centro" per il vincitore e "allontanamento" per il perdente).
  const winnerShift = role === 'groom' ? '80%' : '-80%'
  const loserShift = role === 'groom' ? '-15%' : '15%'
  const xTranslate = isWinner ? winnerShift : isLoser ? loserShift : 0

  const scale = isWinner
    ? 1.18
    : isLoser
      ? 0.75
      : highlighted && isSuspense
        ? heartbeat
        : highlighted
          ? 1.03
          : 1
  const opacity = isLoser ? 0.15 : 1
  const filter = isLoser ? 'saturate(0.4) brightness(0.7) blur(4px)' : 'none'

  const ringClass = isWinner
    ? 'ring-0' // la cornice dorata SVG sostituisce il ring standard
    : highlighted && !isLoser && !neutral
      ? 'ring-2 ring-wedding-champagne/70 shadow-[0_0_50px_rgba(232,183,200,0.35)]'
      : 'ring-1 ring-wedding-taupe/40'

  return (
    <motion.div
      className="relative flex flex-col items-center gap-5"
      animate={{ scale, opacity, x: xTranslate }}
      transition={{
        scale: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
        opacity: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
        x: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
      }}
      style={{
        filter,
        willChange: 'transform, opacity, filter',
        zIndex: isWinner ? 5 : 1,
      }}
    >
      {/* Wrapper foto (mantiene le dimensioni fisse per posizionare cornice/corona/scintille). */}
      <div className="relative w-[220px] h-[290px] sm:w-[280px] sm:h-[360px] md:w-[340px] md:h-[440px] lg:w-[400px] lg:h-[520px]">
        {/* Container immagine (overflow-hidden per clip della foto). */}
        <div
          className={`absolute inset-0 rounded-[26px] overflow-hidden bg-wedding-taupe-light/20 transition-shadow duration-500 ${ringClass}`}
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
          {/* Vignette scura leggera sul perdente per accentuare il contrasto */}
          {isLoser && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at 50% 50%, transparent 50%, rgba(20,10,20,0.55) 100%)',
              }}
            />
          )}
        </div>

        {/* Cornice dorata SVG che si disegna progressivamente (solo winner). */}
        {isWinner && <GoldenFrame />}

        {/* Scintille orbitanti (solo card highlightata durante la suspense). */}
        {highlighted && isSuspense && !neutral && (
          <SparkleRing seed={`${runId}-${role}`} />
        )}

        {/* Corona SVG con bounce (solo winner, posizionata sopra la foto).
            top ridotto per non intersecare la headline anche a scale 1.18. */}
        {isWinner && (
          <motion.div
            className="absolute pointer-events-none z-20"
            style={{
              top: '-38px',
              left: '50%',
              transformOrigin: 'center bottom',
            }}
            initial={{ opacity: 0, y: -30, scale: 0.5, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            transition={{
              delay: 0.5,
              type: 'spring',
              stiffness: 200,
              damping: 12,
              mass: 0.9,
            }}
          >
            <CrownSVG width={92} />
          </motion.div>
        )}
      </div>

      {/* Label sotto la foto: nascosta durante il reveal per evitare la
          duplicazione visiva del nome (già mostrato in grande da WinnerRevealText).
          Durante suspense/idle/stopped resta visibile per identificare le due card. */}
      {!(isWinner || isLoser) && (
        <p
          className={`text-xl sm:text-2xl md:text-3xl uppercase tracking-[0.28em] transition-colors duration-500 ${
            highlighted && !neutral ? 'text-wedding-gold-soft' : 'text-wedding-ivory/90'
          }`}
        >
          {label}
        </p>
      )}
    </motion.div>
  )
}

// ── Winner reveal typography (intro + nome letter-by-letter + ruolo) ─

function WinnerRevealText({
  introText,
  nameText,
  roleText,
  fontFamily,
}: {
  introText: string
  nameText: string
  roleText: string
  fontFamily?: string
}) {
  const letters = Array.from(nameText)
  // Delay del ruolo: ultima lettera + ~400ms di respiro.
  const roleDelay = 0.8 + letters.length * 0.04 + 0.4
  return (
    <motion.div
      key="reveal-text-block"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-3"
      style={{ fontFamily }}
      aria-label={`${introText} ${nameText} — ${roleText}`}
    >
      {/* Intro "IL VINCITORE È" */}
      <motion.p
        initial={{ opacity: 0, y: 6, letterSpacing: '0.6em' }}
        animate={{ opacity: 1, y: 0, letterSpacing: '0.4em' }}
        transition={{ duration: 0.6, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="text-lg sm:text-xl md:text-2xl uppercase text-wedding-champagne/85"
      >
        {introText}
      </motion.p>

      {/* Nome vincitore lettera per lettera */}
      <div className="flex justify-center items-baseline" aria-hidden="true">
        {letters.map((ch, idx) => (
          <motion.span
            key={`${idx}-${ch}`}
            initial={{ opacity: 0, y: 32, scale: 0.55, filter: 'blur(6px)' }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              filter: 'blur(0px)',
              textShadow: [
                '0 0 0 rgba(245,215,161,0)',
                '0 0 28px rgba(245,215,161,0.95)',
                '0 0 14px rgba(245,215,161,0.45)',
              ],
            }}
            transition={{
              duration: 0.6,
              delay: 0.8 + idx * 0.04,
              ease: [0.16, 1, 0.3, 1],
              textShadow: {
                duration: 1.6,
                delay: 0.8 + idx * 0.04,
                times: [0, 0.3, 1],
              },
            }}
            className="inline-block text-5xl sm:text-6xl md:text-7xl lg:text-[6.5rem] leading-none tracking-[0.05em] text-wedding-gold-soft"
            style={{ willChange: 'transform, opacity, filter' }}
          >
            {ch === ' ' ? '\u00A0' : ch}
          </motion.span>
        ))}
      </div>

      {/* Ruolo SPOSO / SPOSA */}
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: roleDelay, ease: [0.16, 1, 0.3, 1] }}
        className="text-sm sm:text-base md:text-lg uppercase tracking-[0.5em] text-wedding-champagne/75 mt-1"
      >
        {roleText}
      </motion.p>
    </motion.div>
  )
}

// ── Cornice dorata SVG (draw-in progressivo) ────────────────────

function GoldenFrame() {
  // ViewBox 400×520 = aspect ratio delle card lg. `preserveAspectRatio="none"`
  // stira leggermente ai breakpoint inferiori — accettabile perché tutte le
  // card usano ratio ~10:13 (max 1% di deviazione).
  return (
    <svg
      className="absolute inset-0 pointer-events-none z-10"
      viewBox="0 0 400 520"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%' }}
    >
      <defs>
        <linearGradient id="frameGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F5D7A1" />
          <stop offset="45%" stopColor="#FBEAF0" />
          <stop offset="100%" stopColor="#F5D7A1" />
        </linearGradient>
      </defs>

      {/* Cornice esterna: draw progressivo con pathLength */}
      <motion.rect
        x="4"
        y="4"
        width="392"
        height="512"
        rx="20"
        fill="none"
        stroke="url(#frameGold)"
        strokeWidth="3"
        pathLength={1}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{
          pathLength: { duration: 0.9, delay: 0.25, ease: 'easeInOut' },
          opacity: { duration: 0.3, delay: 0.25 },
        }}
      />

      {/* Cornice interna tratteggiata (accento decorativo) */}
      <motion.rect
        x="12"
        y="12"
        width="376"
        height="496"
        rx="14"
        fill="none"
        stroke="url(#frameGold)"
        strokeWidth="0.8"
        strokeDasharray="6 4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.7 }}
        transition={{ duration: 0.6, delay: 1.0 }}
      />

      {/* Fregi angolari ornamentali (4 corner, stagger) */}
      {[
        { tx: 4, ty: 4, rot: 0 },
        { tx: 396, ty: 4, rot: 90 },
        { tx: 396, ty: 516, rot: 180 },
        { tx: 4, ty: 516, rot: 270 },
      ].map((c, i) => (
        <motion.g
          key={i}
          transform={`translate(${c.tx} ${c.ty}) rotate(${c.rot})`}
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.85 + i * 0.06, duration: 0.4, ease: 'easeOut' }}
          style={{ transformOrigin: 'center', transformBox: 'fill-box' }}
        >
          <path
            d="M 0 0 L 22 0 M 0 0 L 0 22 M 8 0 Q 8 8 0 8"
            fill="none"
            stroke="url(#frameGold)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="0" cy="0" r="2.6" fill="#F5D7A1" />
        </motion.g>
      ))}
    </svg>
  )
}

// ── Corona SVG (5 punte, gradient oro→blush→bordeaux) ───────────

function CrownSVG({ width = 110 }: { width?: number }) {
  const height = (width * 80) / 120
  return (
    <svg width={width} height={height} viewBox="0 0 120 80" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="crownGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F5D7A1" />
          <stop offset="55%" stopColor="#E8B7C8" />
          <stop offset="100%" stopColor="#8F1D2C" />
        </linearGradient>
      </defs>
      {/* Base band */}
      <rect
        x="10"
        y="55"
        width="100"
        height="14"
        rx="2"
        fill="url(#crownGold)"
        stroke="#F5D7A1"
        strokeWidth="1"
      />
      {/* Crown points (5 punte) */}
      <path
        d="M 10 55 L 25 20 L 40 45 L 60 12 L 80 45 L 95 20 L 110 55 Z"
        fill="url(#crownGold)"
        stroke="#F5D7A1"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Gems */}
      <circle cx="25" cy="20" r="3" fill="#E8B7C8" stroke="#F5D7A1" strokeWidth="0.5" />
      <circle cx="60" cy="12" r="4" fill="#8F1D2C" stroke="#F5D7A1" strokeWidth="0.6" />
      <circle cx="95" cy="20" r="3" fill="#E8B7C8" stroke="#F5D7A1" strokeWidth="0.5" />
    </svg>
  )
}

// ── Raggi di luce dorati (rotazione lenta, fade dopo il reveal) ──

function LightRays({ revealElapsed }: { revealElapsed: number }) {
  // Fade-out progressivo negli ultimi 1500ms della finestra coriandoli
  // per non rimanere visibili in modo statico dopo la scena.
  const fadeStart = CONFETTI_MS - 1500
  const fadeOpacity =
    revealElapsed < fadeStart
      ? 0.45
      : Math.max(0, 0.45 * (1 - (revealElapsed - fadeStart) / 1500))
  return (
    <motion.svg
      className="absolute pointer-events-none z-[1]"
      style={{
        top: '50%',
        left: '50%',
        width: '85vh',
        height: '85vh',
        marginTop: '-42.5vh',
        marginLeft: '-42.5vh',
        willChange: 'transform, opacity',
      }}
      viewBox="0 0 200 200"
      initial={{ opacity: 0, rotate: 0 }}
      animate={{ opacity: fadeOpacity, rotate: 360 }}
      transition={{
        opacity: { duration: 1.2, delay: 0.4, ease: 'easeOut' },
        rotate: { duration: 24, repeat: Infinity, ease: 'linear' },
      }}
    >
      <defs>
        <radialGradient id="rayGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F5D7A1" stopOpacity="0.65" />
          <stop offset="55%" stopColor="#E8B7C8" stopOpacity="0.18" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      {/* 12 raggi triangolari attorno al centro */}
      {Array.from({ length: 12 }).map((_, i) => (
        <polygon
          key={i}
          points="100,100 96,0 104,0"
          fill="url(#rayGrad)"
          transform={`rotate(${i * 30} 100 100)`}
        />
      ))}
    </motion.svg>
  )
}

// ── Scintille orbitanti (twinkle loop) ──────────────────────────

function SparkleRing({ seed }: { seed: string }) {
  // 6 scintille distribuite intorno ai bordi della card (posizioni fisse
  // deterministiche via seed). Loop infinito di twinkle finché montato.
  const sparkles = useMemo(() => {
    const rand = mulberry32(hashSeed(seed))
    const anchors = [
      { top: 6, left: 8 },
      { top: 8, left: 92 },
      { top: 50, left: 4 },
      { top: 52, left: 96 },
      { top: 94, left: 10 },
      { top: 92, left: 90 },
    ]
    return anchors.map((a, i) => ({
      i,
      top: a.top,
      left: a.left,
      delay: rand() * 1.4,
      duration: 1.6 + rand() * 1.0,
      size: 14 + Math.floor(rand() * 6),
    }))
  }, [seed])

  return (
    <div className="absolute inset-0 pointer-events-none z-[5]">
      {sparkles.map((s) => (
        <motion.div
          key={s.i}
          className="absolute"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            transform: 'translate(-50%, -50%)',
            willChange: 'transform, opacity',
          }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{
            opacity: [0, 1, 0.3, 1, 0],
            scale: [0.4, 1.2, 0.85, 1.15, 0.4],
            rotate: [0, 45, 0, -45, 0],
          }}
          transition={{
            duration: s.duration,
            delay: s.delay,
            repeat: Infinity,
            repeatDelay: 0.4,
            ease: 'easeInOut',
          }}
        >
          <SparkleSVG size={s.size} />
        </motion.div>
      ))}
    </div>
  )
}

function SparkleSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <defs>
        <radialGradient id="sparkleGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFF4D6" stopOpacity="1" />
          <stop offset="60%" stopColor="#F5D7A1" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#F5D7A1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M 12 0 L 14 10 L 24 12 L 14 14 L 12 24 L 10 14 L 0 12 L 10 10 Z"
        fill="url(#sparkleGlow)"
      />
    </svg>
  )
}

// ── Coriandoli premium (3 wave burst, 3 livelli di profondità) ──

type ConfettiPiece = {
  i: number
  startX: number
  startY: number
  endX: number
  endY: number
  rotate: number
  size: number
  color: string
  shape: 'rect' | 'circle' | 'streamer'
  depth: 0 | 1 | 2
  delay: number
  duration: number
}

function ConfettiWaves({ seed }: { seed: string }) {
  const pieces = useMemo<ConfettiPiece[]>(() => {
    const rand = mulberry32(hashSeed(seed))
    const palette = [
      '#F5D7A1', // oro
      '#F0DFC9', // champagne
      '#FBEAF0', // avorio rosato
      '#E8B7C8', // blush
      '#8F1D2C', // bordeaux
      '#B8A89A', // taupe
    ]
    // 3 wave: burst dal centro, poi angoli superiori, poi centro-alto.
    const waves: Array<{ count: number; delay: number; origins: Array<'center' | 'top-left' | 'top-right' | 'top-center'> }> = [
      { count: 40, delay: 0, origins: ['center'] },
      { count: 40, delay: 1.2, origins: ['top-left', 'top-right'] },
      { count: 40, delay: 2.4, origins: ['top-center'] },
    ]
    const out: ConfettiPiece[] = []
    let idx = 0
    for (const w of waves) {
      for (let n = 0; n < w.count; n++) {
        const origin = w.origins[Math.floor(rand() * w.origins.length)]
        let startX = 50
        let startY = 50
        let angle: number
        if (origin === 'center') {
          startX = 46 + rand() * 8
          startY = 46 + rand() * 8
          angle = rand() * Math.PI * 2
        } else if (origin === 'top-left') {
          startX = rand() * 8
          startY = rand() * 6
          angle = (0.15 + rand() * 0.4) * Math.PI // diagonale verso basso-destra
        } else if (origin === 'top-right') {
          startX = 92 + rand() * 8
          startY = rand() * 6
          angle = Math.PI - (0.15 + rand() * 0.4) * Math.PI // diagonale verso basso-sinistra
        } else {
          startX = 42 + rand() * 16
          startY = rand() * 4
          angle = Math.PI / 2 + (rand() - 0.5) * Math.PI * 0.6 // ventaglio verso basso
        }
        const speed = origin === 'center' ? 380 + rand() * 380 : 480 + rand() * 460
        const gravity = 350 + rand() * 450
        const endX = Math.cos(angle) * speed + (rand() - 0.5) * 180
        const endY = Math.sin(angle) * speed * 0.6 + gravity

        const depth = Math.floor(rand() * 3) as 0 | 1 | 2
        const baseSize = depth === 0 ? 10 : depth === 1 ? 7 : 5
        const size = baseSize + Math.floor(rand() * 3)

        const shapeRoll = rand()
        const shape: ConfettiPiece['shape'] =
          shapeRoll < 0.18 ? 'streamer' : shapeRoll < 0.58 ? 'rect' : 'circle'

        out.push({
          i: idx++,
          startX,
          startY,
          endX,
          endY,
          rotate: (rand() - 0.5) * 720,
          size,
          color: palette[Math.floor(rand() * palette.length)],
          shape,
          depth,
          delay: w.delay + rand() * 0.4,
          duration: 2.4 + rand() * 1.6,
        })
      }
    }
    return out
  }, [seed])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-[70]">
      {pieces.map((p) => {
        const blur = p.depth === 0 ? 0 : p.depth === 1 ? 1 : 2
        const opacityMax = p.depth === 0 ? 1 : p.depth === 1 ? 0.85 : 0.6
        const width = p.shape === 'streamer' ? 3 : p.size
        const height =
          p.shape === 'streamer'
            ? p.size * 4
            : p.shape === 'circle'
              ? p.size
              : p.size * 1.5
        // Streamer: rotazione 3D simulata via scaleX flip (dà l'illusione di volumi).
        const flipScaleX = p.shape === 'streamer' ? [1, 1, -1, 1, -1] : undefined
        return (
          <motion.span
            key={p.i}
            className={`absolute ${p.shape === 'circle' ? 'rounded-full' : 'rounded-[1px]'}`}
            style={{
              left: `${p.startX}%`,
              top: `${p.startY}%`,
              width,
              height,
              background: p.color,
              filter: blur ? `blur(${blur}px)` : undefined,
              boxShadow: `0 0 4px ${p.color}55`,
              willChange: 'transform, opacity',
            }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 0, scaleX: 1 }}
            animate={{
              x: p.endX,
              y: p.endY,
              rotate: p.rotate,
              opacity: [0, opacityMax, opacityMax, 0],
              ...(flipScaleX ? { scaleX: flipScaleX } : {}),
            }}
            transition={{
              duration: p.duration,
              delay: p.delay,
              ease: [0.16, 1, 0.4, 1],
              opacity: {
                duration: p.duration,
                delay: p.delay,
                times: [0, 0.12, 0.78, 1],
              },
              ...(flipScaleX
                ? {
                    scaleX: {
                      duration: p.duration,
                      delay: p.delay,
                      times: [0, 0.25, 0.5, 0.75, 1],
                    },
                  }
                : {}),
            }}
          />
        )
      })}
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
