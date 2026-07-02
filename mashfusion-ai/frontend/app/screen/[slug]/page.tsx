'use client'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { QRCodeSVG } from 'qrcode.react'
import { Heart, Sparkles, ListChecks, Footprints, Youtube, Users, Camera } from 'lucide-react'
import { liveScreen, type VideoLiveCommand, type StandUpGuessConfig, type StandUpGuessRound } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { WeddingShell } from '@/components/wedding/WeddingUI'
import { WeddingPhotoDisplay } from '@/components/wedding/WeddingPhotoGridWall'
import { RouletteWheel } from '@/components/wedding/RouletteWheel'
import { WinnerAnnouncementStage } from '@/components/wedding/WinnerAnnouncementStage'
import { PartyShell, PartyDivider, PARTY } from '@/components/party/PartyUI'
import { PartyPhotoDisplay, type LiveBoothLayout } from '@/components/party/PartyPhotoGridWall'
import { resolveVideoSource, type VideoLiveSource } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'

/** Remote-control state read from screen_config.video_live and applied by the
 *  Screen Mode players. The dashboard is the director. */
type VideoControl = { command?: VideoLiveCommand; commandId?: string; volume?: number }

const STAND_UP_GUESS_STATUSES = ['idle', 'instruction', 'guessing', 'reveal', 'finished'] as const

function normalizeStandUpGuess(raw: any): StandUpGuessConfig {
  const rounds: StandUpGuessRound[] = Array.isArray(raw?.rounds)
    ? raw.rounds
      .map((round: any, index: number) => {
        if (!round || typeof round !== 'object') return null
        return {
          id: typeof round.id === 'string' ? round.id : `sug-${index}`,
          guest_instruction: String(round.guest_instruction ?? '').trim(),
          answer: String(round.answer ?? '').trim(),
          hint: round.hint == null ? undefined : String(round.hint),
          enabled: round.enabled !== false,
          order: typeof round.order === 'number' ? round.order : index,
        } satisfies StandUpGuessRound
      })
      .filter((round: StandUpGuessRound | null): round is StandUpGuessRound => !!round)
      .sort((a: StandUpGuessRound, b: StandUpGuessRound) => a.order - b.order)
      .map((round: StandUpGuessRound, index: number) => ({ ...round, order: index }))
      .filter((round: StandUpGuessRound) => round.guest_instruction.length > 0)
    : []

  const safeIndex = Math.min(Math.max(Number(raw?.current_index ?? 0), 0), Math.max(rounds.length - 1, 0))
  const fallbackRound = rounds[safeIndex] ?? rounds[0]
  const roundById = rounds.find((round) => round.id === raw?.current_round_id)
  const parsedStatus = STAND_UP_GUESS_STATUSES.includes(raw?.status) ? raw.status : 'idle'

  return {
    enabled: raw?.enabled === true,
    status: parsedStatus,
    current_round_id: roundById?.id ?? fallbackRound?.id ?? null,
    current_index: safeIndex,
    rounds,
    score: {
      guessed: Math.max(0, Number(raw?.score?.guessed ?? 0) || 0),
      missed: Math.max(0, Number(raw?.score?.missed ?? 0) || 0),
    },
    updated_at: typeof raw?.updated_at === 'string' ? raw.updated_at : '',
  }
}

export default function ScreenModePage() {
  const { slug } = useParams<{ slug: string }>()
  const { t } = useI18n()
  const { data, error } = useSWR(
    slug ? ['screen', slug] : null,
    () => liveScreen.get(slug!),
    { refreshInterval: 1_500 },
  )

  const [showRouletteWheel, setShowRouletteWheel] = useState(false)
  const [wheelPenitenze, setWheelPenitenze] = useState<any[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const lastRouletteId = useRef<string | null>(null)
  // Momento di apertura/refresh della pagina schermo: round creati PRIMA di
  // questo timestamp sono considerati "vecchi" e non vengono rigiocati.
  const pageLoadedAt = useRef<number>(Date.now())

  useEffect(() => {
    if (!data?.roulette) return
    if (!data.roulette.result) return // round in corso senza risultato

    // Se l'id non è cambiato, è lo stesso round già visto: niente da fare
    if (data.roulette.id === lastRouletteId.current) return

    // Round creato prima dell'apertura schermo → è "storico", solo segnalo
    // come visto senza rigiocare l'animazione
    const createdAt = data.roulette.created_at
      ? new Date(data.roulette.created_at).getTime()
      : 0
    if (createdAt && createdAt < pageLoadedAt.current - 5000) {
      lastRouletteId.current = data.roulette.id
      return
    }

    // Nuovo round arrivato dopo il page load → fai partire la ruota
    lastRouletteId.current = data.roulette.id

    // Il backend salva le penitenze in config.penitenze come array di oggetti
    // { label, category, enabled }. Manteniamo fallback su "slots" per legacy.
    const rouletteConfig = data.roulette.config as any
    const rawPenitenze: any[] =
      rouletteConfig?.penitenze ||
      rouletteConfig?.slots ||
      []
    const idx = data.roulette.result.slot_index ?? 0

    if (rawPenitenze.length > 0 && idx >= 0) {
      // Normalizza: supporta sia stringhe legacy sia oggetti { label, category, enabled }
      const penitenze = rawPenitenze.map((p: any) =>
        typeof p === 'string'
          ? { label: p, category: 'party' as const, enabled: true }
          : {
              label: p.label ?? String(p),
              category: (p.category ?? 'party') as 'soft' | 'party' | 'wild',
              enabled: p.enabled ?? true,
            }
      )
      setWheelPenitenze(penitenze)
      setSelectedIndex(idx)
      setShowRouletteWheel(true)

      // Nascondi dopo 17 secondi (12s roulette + 5s popup)
      setTimeout(() => {
        setShowRouletteWheel(false)
      }, 17000)
    }
  }, [data?.roulette])

  if (error) {
    return (
      <WeddingShell variant="stage">
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-3xl text-wedding-ivory/40">Sessione non trovata.</p>
        </div>
      </WeddingShell>
    )
  }
  if (!data) {
    return (
      <WeddingShell variant="stage">
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-3xl text-wedding-ivory/30 font-wedding italic">{t('common.loading')}…</p>
        </div>
      </WeddingShell>
    )
  }

  const { session, roulette, shoe_game, active_poll, dedications, photos } = data
  const isParty = (session as any).session_type === 'party'

  // ─── PARTY MODE SCREEN (dark premium / red wine / fuchsia) ───
  if (isParty) {
    return (
      <PartyScreen
        slug={slug!}
        session={session as any}
        roulette={roulette}
        active_poll={active_poll}
        photos={photos as any}
      />
    )
  }

  const total = (active_poll?.tally ?? []).reduce((a, b) => a + b, 0) || 0
  const shoeActive = shoe_game?.status === 'running' && shoe_game?.config?.is_active
  const shoeQuestions: string[] = shoe_game?.config?.questions ?? []
  const shoeIdx: number = shoe_game?.config?.current_index ?? 0

  // Sezioni abilitate dal DJ nel pannello "Visibilità Schermo".
  // Default = TUTTO NASCOSTO: un blocco appare solo quando il DJ lo spunta
  // esplicitamente (show_* === true). Senza configurazione salvata lo schermo
  // parte pulito mostrando solo nomi sposi / data / titolo evento.
  const cfg = session.screen_config ?? {}
  const enabledRoulette   = cfg.show_roulette   === true
  const enabledShoeGame   = cfg.show_shoe_game  === true
  const enabledPolls      = cfg.show_polls      === true
  const enabledDedications = cfg.show_dedications === true
  const enabledPhotos     = cfg.show_photos     === true
  const standUpGuess = normalizeStandUpGuess(cfg.stand_up_guess)
  const enabledStandUpGuess = standUpGuess.enabled === true
  const standUpRound = standUpGuess.rounds.find((round) => round.id === standUpGuess.current_round_id)
    ?? standUpGuess.rounds[standUpGuess.current_index]
    ?? standUpGuess.rounds[0]

  // Layout Live Booth sullo schermo (single | grid | auto). Default 'single'
  // per retrocompatibilità con le sessioni esistenti.
  const liveBoothLayout: LiveBoothLayout = (cfg.live_booth_layout as LiveBoothLayout) ?? 'single'

  // Video Live — appare solo se il DJ ha attivato lo switch E ha inserito un
  // link valido (YouTube o file video diretto: mp4, webm, ogg, mov, m4v).
  // Niente switch ON + link mancante = nessun riquadro sullo schermo pubblico.
  const weddingVideo = cfg.show_video_live === true
    ? resolveVideoSource(cfg.video_url, { autoplay: true })
    : null
  const enabledVideo = !!weddingVideo
  // Remote-control state written by the DJ dashboard (regia video live).
  const videoControl: VideoControl = {
    command: cfg.video_live?.command,
    commandId: cfg.video_live?.command_id,
    volume: cfg.video_live?.volume,
  }
  // Show the one-time audio-unlock overlay when Video Live is active or a
  // video link is configured, so the first click unlocks autoplay-with-sound.
  const videoConfigured = cfg.show_video_live === true || !!resolveVideoSource(cfg.video_url)

  const activeSections = [
    enabledRoulette   ? 'roulette'    : null,
    enabledShoeGame   ? 'shoe'        : null,
    enabledPolls      ? 'poll'        : null,
    enabledDedications ? 'dedications' : null,
    enabledPhotos     ? 'photos'      : null,
    enabledStandUpGuess ? 'standup'   : null,
    enabledVideo      ? 'video'       : null,
  ].filter(Boolean)

  const hasContent = activeSections.length > 0
  const singleSection = activeSections.length === 1

  // Solo giochi attivi (no foto/dediche/sondaggi)
  const onlyGames = hasContent &&
    activeSections.every(s => s === 'roulette' || s === 'shoe' || s === 'standup') &&
    (activeSections.includes('roulette') || activeSections.includes('shoe') || activeSections.includes('standup'))

  // Get font family based on screen_config
  const getFontFamily = () => {
    const font = session.screen_config?.couple_font ?? 'cormorant'
    const fontMap: Record<string, string> = {
      'cormorant': 'var(--font-cormorant), Cormorant Garamond, serif',
      'playfair': 'var(--font-playfair), Playfair Display, serif',
      'great-vibes': 'var(--font-great-vibes), Great Vibes, cursive',
      'dancing': 'var(--font-dancing-script), Dancing Script, cursive',
      'cinzel': 'var(--font-cinzel), Cinzel, serif',
      'tangerine': 'var(--font-tangerine), Tangerine, cursive',
    }
    return fontMap[font] || fontMap['cormorant']
  }
  const coupleFontFamily = getFontFamily()

  // Cinzel and Playfair are wider, so use smaller size
  const selectedFont = session.screen_config?.couple_font ?? 'cormorant'
  const isWideFont = selectedFont === 'cinzel' || selectedFont === 'playfair'
  const coupleFontSize = session.screen_config?.couple_font_size ?? 'medium'
  // Empty state (couple names take the whole screen)
  const largeSizeMap: Record<string, string> = {
    small: isWideFont ? 'text-[8rem]' : 'text-[10rem]',
    medium: isWideFont ? 'text-[11rem]' : 'text-[14rem]',
    large: isWideFont ? 'text-[14rem]' : 'text-[17rem]',
    xlarge: isWideFont ? 'text-[17rem]' : 'text-[20rem]',
  }
  // Names shown above other content
  const mediumSizeMap: Record<string, string> = {
    small: isWideFont ? 'text-6xl' : 'text-7xl',
    medium: isWideFont ? 'text-7xl' : 'text-8xl',
    large: isWideFont ? 'text-8xl' : 'text-9xl',
    xlarge: isWideFont ? 'text-9xl' : 'text-[10rem]',
  }
  const largeFontSize = largeSizeMap[coupleFontSize] ?? largeSizeMap['medium']
  const mediumFontSize = mediumSizeMap[coupleFontSize] ?? mediumSizeMap['medium']

  return (
    <WeddingShell variant="stage">
      {videoConfigured && <VideoLiveAudioUnlock theme="wedding" />}
      {showRouletteWheel && wheelPenitenze.length > 0 && (
        <RouletteWheel
          penitenze={wheelPenitenze}
          selectedIndex={selectedIndex}
          onComplete={() => {}}
          showClose={false}
        />
      )}
      {/* Wedding · Proclamazione Vincitore: overlay indipendente sopra lo
          Screen quando phase !== 'hidden'. Quando phase === 'hidden' non
          renderizza nulla e lo schermo resta identico. */}
      <WinnerAnnouncementStage
        state={(cfg as any).winner_announcement ?? null}
        coupleNames={session.couple_names}
        fontFamily={coupleFontFamily}
      />
      <div className="min-h-screen w-screen overflow-hidden flex items-stretch relative">
        {/* Decorative gold orbs */}
        <div className="absolute top-0 left-1/4 h-[500px] w-[500px] rounded-full bg-wedding-gold/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 h-[400px] w-[400px] rounded-full bg-wedding-blush/10 blur-3xl pointer-events-none" />

        {/* Empty state - show only couple names centered */}
        {!hasContent && (
          <div className="w-full flex flex-col items-center justify-center p-12 relative z-10">
            <div className="text-center">
              <h1 className={`${largeFontSize} text-wedding-ivory tracking-tight leading-[0.9]`} style={{ fontFamily: coupleFontFamily }}>
                {session.couple_names ?? session.event_name}
              </h1>
              {session.wedding_date && (
                <p className="font-wedding text-5xl italic text-wedding-champagne/90 mt-8">
                  {new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' })}
                </p>
              )}
              {session.venue_name && (
                <p className="text-xl uppercase tracking-[0.5em] text-wedding-taupe mt-6">
                  {session.venue_name}
                </p>
              )}
            </div>
            <footer className="absolute bottom-8 text-xs uppercase tracking-[0.3em] text-wedding-taupe">
              Powered by <span className="text-wedding-gold">IOMIXO Live Hub</span>
            </footer>
          </div>
        )}

        {/* Single section - show centered */}
        {hasContent && singleSection && (
          <div className="w-full flex flex-col items-center justify-center p-12 relative z-10 min-h-screen">
            <div className="text-center mb-12">
              <h1 className={`${mediumFontSize} text-wedding-ivory tracking-tight leading-tight mb-4`} style={{ fontFamily: coupleFontFamily }}>
                {session.couple_names ?? session.event_name}
              </h1>
              {session.wedding_date && (
                <p className="font-wedding text-2xl italic text-wedding-champagne/80">
                  {new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' })}
                </p>
              )}
            </div>

            <div className="max-w-4xl w-full">
              {roulette?.result && (
                <div className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-12">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-wedding-gold/20">
                    <Sparkles className="h-8 w-8 text-wedding-gold" />
                    <h2 className="text-2xl font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">{t('wedding.screen.rouletteResult')}</h2>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-wedding-gold/20 to-wedding-blush/10 border border-wedding-gold/40 py-12 text-center">
                    <p className="font-wedding text-6xl text-wedding-ivory leading-tight px-4">
                      {roulette.result.slot_label}
                    </p>
                  </div>
                </div>
              )}

              {shoeActive && shoeQuestions[shoeIdx] && (
                <div className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-12">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-wedding-gold/20">
                    <Sparkles className="h-8 w-8 text-wedding-gold" />
                    <h2 className="text-2xl font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">Gioco della Scarpa</h2>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-wedding-gold/20 to-wedding-blush/10 border border-wedding-gold/40 py-12 text-center">
                    <p className="text-sm uppercase tracking-[0.32em] text-wedding-gold mb-6 tabular-nums">
                      Domanda {shoeIdx + 1}/{shoeQuestions.length}
                    </p>
                    <p className="font-wedding text-6xl text-wedding-ivory leading-tight px-4">
                      {shoeQuestions[shoeIdx]}
                    </p>
                  </div>
                </div>
              )}

              {enabledStandUpGuess && (
                <StandUpGuessStage round={standUpRound ?? null} state={standUpGuess} />
              )}

              {active_poll && (
                <div className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-12">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-wedding-gold/20">
                    <ListChecks className="h-8 w-8 text-wedding-gold" />
                    <h2 className="text-2xl font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">{t('wedding.screen.activePoll')}</h2>
                  </div>
                  <p className="font-wedding text-4xl text-wedding-ivory mb-8 italic text-center">{active_poll.question}</p>
                  <div className="space-y-4">
                    {active_poll.options.map((opt, i) => {
                      const tally = active_poll.tally?.[i] ?? 0
                      const pct = total > 0 ? Math.round((tally / total) * 100) : 0
                      return (
                        <div key={i} className="relative rounded-xl overflow-hidden border border-wedding-gold/30 bg-wedding-ivory/5 h-16">
                          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-wedding-gold/40 to-wedding-champagne/30 transition-all duration-500" style={{ width: `${pct}%` }} />
                          <div className="relative flex items-center justify-between h-full px-6">
                            <span className="text-2xl text-wedding-ivory">{opt}</span>
                            <span className="text-2xl font-semibold text-wedding-champagne">{pct}%</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {dedications.length > 0 && (
                <div className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-12">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-wedding-gold/20">
                    <Heart className="h-8 w-8 text-wedding-gold" />
                    <h2 className="text-2xl font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">{t('wedding.screen.recentDedications')}</h2>
                  </div>
                  <div className="space-y-6 max-h-[600px] overflow-y-auto">
                    {dedications.slice(0, 10).map((d) => (
                      <div key={d.id} className="rounded-xl border border-wedding-gold/20 bg-wedding-ivory/5 p-8">
                        <p className="font-wedding text-3xl italic text-wedding-ivory leading-snug whitespace-pre-line">
                          "{d.message}"
                        </p>
                        <div className="flex items-center justify-between mt-4 gap-3">
                          <p className="text-sm uppercase tracking-[0.22em] text-wedding-gold">
                            — {d.guest_name ?? 'Anonimo'}
                          </p>
                          <p className="text-sm uppercase tracking-[0.18em] text-wedding-ivory/50 tabular-nums">
                            {new Date(d.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {enabledPhotos && (
                <div className="flex items-center justify-center py-4">
                  <WeddingPhotoDisplay
                    photos={photos as any}
                    coupleNames={session.couple_names ?? session.event_name}
                    weddingDate={session.wedding_date}
                    layout={liveBoothLayout}
                  />
                </div>
              )}

              {weddingVideo && (
                <WeddingVideoLiveBox
                  source={weddingVideo}
                  title={cfg.video_title}
                  control={videoControl}
                />
              )}
            </div>

            <footer className="mt-12 text-xs uppercase tracking-[0.3em] text-wedding-taupe">
              Powered by <span className="text-wedding-gold">IOMIXO Live Hub</span>
            </footer>
          </div>
        )}

        {/* Games only layout - centered (when both games are active) */}
        {hasContent && !singleSection && onlyGames && (
          <div className="w-full flex flex-col items-center justify-center p-12 relative z-10 min-h-screen">
            <div className="text-center mb-12">
              <h1 className={`${mediumFontSize} text-wedding-ivory tracking-tight leading-tight mb-4`} style={{ fontFamily: coupleFontFamily }}>
                {session.couple_names ?? session.event_name}
              </h1>
              {session.wedding_date && (
                <p className="font-wedding text-2xl italic text-wedding-champagne/80">
                  {new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' })}
                </p>
              )}
            </div>

            <div className="max-w-3xl w-full space-y-8">
              {roulette?.result && (
                <div className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-12">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-wedding-gold/20">
                    <Sparkles className="h-8 w-8 text-wedding-gold" />
                    <h2 className="text-2xl font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">{t('wedding.screen.rouletteResult')}</h2>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-wedding-gold/20 to-wedding-blush/10 border border-wedding-gold/40 py-12 text-center">
                    <p className="font-wedding text-5xl text-wedding-ivory leading-tight px-8">
                      {roulette.result.slot_label}
                    </p>
                  </div>
                </div>
              )}

              {shoeActive && shoeQuestions[shoeIdx] && (
                <div className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-12">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-wedding-gold/20">
                    <Footprints className="h-8 w-8 text-wedding-gold" />
                    <h2 className="text-2xl font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">Gioco della Scarpa</h2>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-wedding-gold/20 to-wedding-blush/10 border border-wedding-gold/40 py-12 text-center">
                    <p className="text-sm uppercase tracking-[0.32em] text-wedding-gold mb-6 tabular-nums">
                      Domanda {shoeIdx + 1}/{shoeQuestions.length}
                    </p>
                    <p className="font-wedding text-5xl text-wedding-ivory leading-tight px-8">
                      {shoeQuestions[shoeIdx]}
                    </p>
                  </div>
                </div>
              )}

              {enabledStandUpGuess && (
                <StandUpGuessStage round={standUpRound ?? null} state={standUpGuess} compact />
              )}
            </div>

            <footer className="absolute bottom-8 text-xs uppercase tracking-[0.3em] text-wedding-taupe">
              Powered by <span className="text-wedding-gold">IOMIXO Live Hub</span>
            </footer>
          </div>
        )}

        {/* Full layout with multiple sections */}
        {hasContent && !singleSection && !onlyGames && (
          <div className="w-full flex flex-col p-12 relative z-10">
          {/* Header */}
          <header className="text-center mb-10">
            <h1 className={`${mediumFontSize} text-wedding-ivory tracking-tight leading-tight`} style={{ fontFamily: coupleFontFamily }}>
              {session.couple_names ?? session.event_name}
            </h1>
            {session.wedding_date && (
              <p className="font-wedding text-3xl italic text-wedding-champagne/80 mt-4">
                {new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' })}
              </p>
            )}
            {session.venue_name && (
              <p className="text-base uppercase tracking-[0.35em] text-wedding-taupe mt-3">
                {session.venue_name}
              </p>
            )}
          </header>

          {/* 3-column grid */}
          <div className="grid grid-cols-3 gap-8 flex-1 min-h-0">
            <div className="space-y-6 col-span-1">
              {enabledRoulette && (
                <StagePanel icon={<Sparkles className="h-6 w-6" />} title={t('wedding.screen.rouletteResult')}>
                  {roulette?.result ? (
                    <div className="rounded-xl bg-gradient-to-br from-wedding-gold/20 to-wedding-blush/10 border border-wedding-gold/40 py-8 text-center">
                      <p className="font-wedding text-4xl text-wedding-ivory leading-tight px-4">
                        {roulette.result.slot_label}
                      </p>
                    </div>
                  ) : (
                    <EmptyPanel text="In attesa del prossimo giro…" />
                  )}
                </StagePanel>
              )}
              {enabledShoeGame && (
                <StagePanel icon={<Footprints className="h-6 w-6" />} title="Gioco della Scarpa">
                  {shoeActive && shoeQuestions[shoeIdx] ? (
                    <div className="rounded-xl bg-gradient-to-br from-wedding-gold/20 to-wedding-blush/10 border border-wedding-gold/40 py-8 text-center">
                      <p className="text-sm uppercase tracking-[0.32em] text-wedding-gold mb-4 tabular-nums">
                        Domanda {shoeIdx + 1}/{shoeQuestions.length}
                      </p>
                      <p className="font-wedding text-4xl text-wedding-ivory leading-tight px-4">
                        {shoeQuestions[shoeIdx]}
                      </p>
                    </div>
                  ) : (
                    <EmptyPanel text="In attesa della prossima domanda…" />
                  )}
                </StagePanel>
              )}
              {enabledStandUpGuess && (
                <StagePanel icon={<Users className="h-6 w-6" />} title={t('weddingPanels.standUpGuessName')}>
                  <StandUpGuessStage round={standUpRound ?? null} state={standUpGuess} inline />
                </StagePanel>
              )}
              {enabledPolls && (
                <StagePanel icon={<ListChecks className="h-6 w-6" />} title={t('wedding.screen.activePoll')}>
                  {active_poll ? (
                    <>
                      <p className="font-wedding text-2xl text-wedding-ivory mb-4 italic">{active_poll.question}</p>
                      <div className="space-y-3">
                        {active_poll.options.map((opt, i) => {
                          const tally = active_poll.tally?.[i] ?? 0
                          const pct = total > 0 ? Math.round((tally / total) * 100) : 0
                          return (
                            <div key={i} className="relative rounded-xl overflow-hidden border border-wedding-gold/30 bg-wedding-ivory/5 h-12">
                              <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-wedding-gold/40 to-wedding-champagne/30 transition-all duration-500" style={{ width: `${pct}%` }} />
                              <div className="relative flex items-center justify-between h-full px-4">
                                <span className="text-lg text-wedding-ivory">{opt}</span>
                                <span className="text-lg font-semibold text-wedding-champagne">{pct}%</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <EmptyPanel text="Nessun sondaggio attivo al momento." />
                  )}
                </StagePanel>
              )}
            </div>

            {enabledDedications && (
              <StagePanel icon={<Heart className="h-6 w-6" />} title={t('wedding.screen.recentDedications')}>
                {dedications.length > 0 ? (
                  <div className="space-y-4 overflow-y-auto max-h-[520px] pr-1">
                    {dedications.slice(0, 30).map((d) => (
                      <div key={d.id} className="rounded-xl border border-wedding-gold/20 bg-wedding-ivory/5 p-5">
                        <p className="font-wedding text-xl italic text-wedding-ivory leading-snug whitespace-pre-line">
                          "{d.message}"
                        </p>
                        <div className="flex items-center justify-between mt-3 gap-3">
                          <p className="text-xs uppercase tracking-[0.22em] text-wedding-gold">
                            — {d.guest_name ?? 'Anonimo'}
                          </p>
                          <p className="text-xs uppercase tracking-[0.18em] text-wedding-ivory/50 tabular-nums">
                            {new Date(d.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyPanel text="Le dediche degli invitati appariranno qui ✨" />
                )}
              </StagePanel>
            )}

            {enabledPhotos && (
              <section className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-6 flex items-center justify-center min-h-0 shadow-wedding-lg">
                <WeddingPhotoDisplay
                  photos={photos as any}
                  coupleNames={session.couple_names ?? session.event_name}
                  weddingDate={session.wedding_date}
                  layout={liveBoothLayout}
                />
              </section>
            )}

            {weddingVideo && (
              <StagePanel icon={<Youtube className="h-6 w-6" />} title={cfg.video_title || t('wedding.screen.videoLive')}>
                <VideoEmbed source={weddingVideo} title={cfg.video_title} control={videoControl} frameClass="border border-wedding-gold/30" />
              </StagePanel>
            )}
          </div>

          <footer className="mt-8 text-center text-xs uppercase tracking-[0.3em] text-wedding-taupe">
            Powered by <span className="text-wedding-gold">IOMIXO Live Hub</span>
          </footer>
          </div>
        )}
      </div>
    </WeddingShell>
  )
}

function StagePanel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-6 flex flex-col min-h-0 shadow-wedding-lg">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-wedding-gold/20">
        <span className="text-wedding-gold">{icon}</span>
        <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">{title}</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </section>
  )
}

function StandUpGuessStage({
  round,
  state,
  compact,
  inline,
}: {
  round: StandUpGuessRound | null
  state: StandUpGuessConfig
  compact?: boolean
  inline?: boolean
}) {
  const { t } = useI18n()
  const showRoundWithAnswer = state.status === 'instruction' || state.status === 'guessing' || state.status === 'reveal'
  const wrapperBase = inline
    ? 'rounded-xl border border-wedding-gold/30 bg-gradient-to-br from-wedding-gold/10 to-wedding-blush/10 p-5'
    : 'rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-8 sm:p-12'
  // Quando un round è attivo nella vista TV principale (single section), centra
  // verticalmente istruzione + risposta così la risposta sta al centro schermo,
  // non attaccata in basso. Negli altri layout (griglia / più giochi) resta compatto.
  const isPrimary = !inline && !compact
  const wrapper = isPrimary && showRoundWithAnswer
    ? `${wrapperBase} flex flex-col justify-center min-h-[58vh]`
    : wrapperBase
  const questionSize = compact ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl md:text-5xl'
  const answerSize = compact ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl md:text-6xl'
  const answerText = round?.answer?.trim() ? round.answer : t('weddingPanels.standUpGuessAnswerMissing')

  return (
    <div className={wrapper}>
      {!inline && !showRoundWithAnswer && (
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-wedding-gold/20">
          <Users className="h-8 w-8 text-wedding-gold" />
          <h2 className="text-2xl font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">
            {t('weddingPanels.standUpGuessName')}
          </h2>
        </div>
      )}

      {state.status === 'idle' && (
        <div className="text-center py-6">
          <p className="text-[11px] uppercase tracking-[0.3em] text-wedding-gold mb-3">{t('weddingPanels.standUpGuessModeLabel')}</p>
          <p className={`font-wedding ${questionSize} text-wedding-ivory leading-tight`}>{t('weddingPanels.standUpGuessIdleTitle')}</p>
          <p className="text-xl text-wedding-champagne/85 mt-4">{t('weddingPanels.standUpGuessIdleSubtitle')}</p>
        </div>
      )}

      {showRoundWithAnswer && (
        <div className="space-y-6 sm:space-y-8 animate-[fadeIn_450ms_ease-out]">
          <p className="text-center text-[11px] uppercase tracking-[0.32em] text-wedding-gold">{t('weddingPanels.standUpGuessModeLabel')}</p>
          <div className="rounded-2xl border border-wedding-gold/25 bg-wedding-ivory/6 p-5 sm:p-6 text-center">
            <p className="text-[11px] uppercase tracking-[0.32em] text-wedding-gold mb-3">{t('weddingPanels.standUpGuessInstructionCard')}</p>
            <p className={`font-wedding ${questionSize} text-wedding-ivory leading-[1.12] whitespace-pre-wrap break-words max-w-[26ch] mx-auto`}>
              {round?.guest_instruction ?? t('weddingPanels.standUpGuessNoRounds')}
            </p>
            {state.status === 'instruction' && (
              <p className="text-base sm:text-lg text-wedding-champagne/85 mt-4">{t('weddingPanels.standUpGuessInstructionFooter')}</p>
            )}
          </div>
          <div className="rounded-2xl border border-wedding-gold/35 bg-gradient-to-br from-wedding-ivory/95 to-wedding-blush/25 p-6 sm:p-10 text-center shadow-[0_18px_60px_rgba(143,29,44,0.18)]">
            <p className="text-xs sm:text-sm uppercase tracking-[0.32em] text-wedding-ink mb-4">{t('weddingPanels.standUpGuessAnswerLabel')}</p>
            <p className={`font-wedding ${answerSize} font-semibold text-wedding-ink leading-[1.12] whitespace-pre-wrap break-words max-w-[24ch] mx-auto`}>
              {answerText}
            </p>
            {round?.hint && <p className="text-base sm:text-lg text-wedding-ink/70 mt-4">{round.hint}</p>}
          </div>
        </div>
      )}

      {state.status === 'finished' && (
        <div className="text-center py-6">
          <p className={`font-wedding ${questionSize} text-wedding-ivory leading-tight`}>{t('weddingPanels.standUpGuessFinished')}</p>
          <p className="text-xl text-wedding-champagne/85 mt-4">
            {t('weddingPanels.standUpGuessScore')}: {state.score.guessed} / {state.score.guessed + state.score.missed}
          </p>
        </div>
      )}
    </div>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-wedding-gold/25 bg-wedding-ivory/5 py-10 px-6 text-center">
      <p className="font-wedding text-xl italic text-wedding-ivory/60 leading-snug">
        {text}
      </p>
    </div>
  )
}

// Discreet one-time overlay shown on the public Screen Mode when a Video Live
// is configured. The first click/touch counts as a user gesture so the browser
// treats the page as "interacted", letting the dashboard's Play / unmute /
// volume commands work with sound. Elegant, non-invasive, theme-aware; never
// rendered when no video is configured. After the gesture it disappears.
function VideoLiveAudioUnlock({ theme }: { theme: 'wedding' | 'party' }) {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const unlock = () => {
    // The click itself satisfies the browser autoplay-with-sound policy.
    // Nudge a silent WebAudio context too, which some browsers require.
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (Ctx) {
        const ac = new Ctx()
        ac.resume?.().catch(() => {})
        setTimeout(() => ac.close?.().catch(() => {}), 300)
      }
    } catch {}
    setDismissed(true)
  }

  const isWedding = theme === 'wedding'
  const card = isWedding
    ? 'rounded-2xl border border-wedding-gold/30 bg-black/70 backdrop-blur-md px-6 py-4 shadow-wedding-lg'
    : 'rounded-2xl border border-[#FF3D8A]/40 bg-black/70 backdrop-blur-md px-6 py-4 shadow-[0_0_50px_rgba(255,61,138,0.25)]'
  const iconColor = isWedding ? 'text-wedding-gold' : 'text-[#FF3D8A]'
  const textColor = isWedding ? 'text-wedding-ivory' : 'text-white'

  return (
    <button
      type="button"
      onClick={unlock}
      onTouchStart={unlock}
      aria-label={t('wedding.screen.tapToEnable')}
      className="fixed inset-0 z-[60] flex items-end justify-center p-8 pb-28 bg-transparent cursor-pointer"
    >
      <div className={`flex items-center gap-3 ${card} animate-pulse`}>
        <Youtube className={`h-5 w-5 shrink-0 ${iconColor}`} />
        <span className={`text-sm font-medium tracking-wide ${textColor}`}>
          {t('wedding.screen.tapToEnable')}
        </span>
      </div>
    </button>
  )
}

// Shared media renderer for Video Live — YouTube embed (controllable via the
// IFrame Player API) or a direct video file (<video>). Both accept a remote
// `control` driven by the DJ dashboard so play/pause/mute/volume/restart/stop
// are applied to THIS public player without touching the screen physically.
function VideoEmbed({ source, title, frameClass, control }: { source: VideoLiveSource; title?: string; frameClass?: string; control?: VideoControl }) {
  return (
    <div className={`relative w-full aspect-video rounded-xl overflow-hidden bg-black ${frameClass ?? ''}`}>
      {source.kind === 'youtube' ? (
        <YouTubeLivePlayer videoId={source.videoId} title={title} control={control} />
      ) : (
        <VideoFileLivePlayer url={source.url} control={control} />
      )}
    </div>
  )
}

// ── YouTube IFrame Player API loader (singleton) ──────────────────
let ytApiPromise: Promise<void> | null = null
function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const w = window as any
  if (w.YT && w.YT.Player) return Promise.resolve()
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise<void>((resolve) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      try { prev?.() } catch {}
      resolve()
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return ytApiPromise
}

// Controllable YouTube player. Autoplays muted (the only autoplay browsers
// allow without a gesture) and then obeys remote commands from the dashboard.
function YouTubeLivePlayer({ videoId, title, control }: { videoId: string; title?: string; control?: VideoControl }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const lastCommandId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    loadYouTubeIframeApi().then(() => {
      if (cancelled || !hostRef.current) return
      const w = window as any
      playerRef.current = new w.YT.Player(hostRef.current, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          autoplay: 1, mute: 1, playsinline: 1, rel: 0,
          modestbranding: 1, controls: 0, fs: 0, disablekb: 1,
        },
        events: {
          onReady: () => { if (!cancelled) setReady(true) },
        },
      })
    })
    return () => {
      cancelled = true
      try { playerRef.current?.destroy?.() } catch {}
      playerRef.current = null
    }
  }, [videoId])

  // Apply volume reactively (does not depend on command_id).
  useEffect(() => {
    const p = playerRef.current
    if (!ready || !p || typeof control?.volume !== 'number') return
    try { p.setVolume(Math.min(100, Math.max(0, control.volume))) } catch {}
  }, [ready, control?.volume])

  // Execute each transport command exactly once (keyed by command_id).
  useEffect(() => {
    const p = playerRef.current
    if (!ready || !p || !control?.commandId) return
    if (control.commandId === lastCommandId.current) return
    lastCommandId.current = control.commandId
    try {
      switch (control.command) {
        case 'play':
          if (typeof control.volume === 'number') p.setVolume(Math.min(100, Math.max(0, control.volume)))
          p.unMute?.()
          p.playVideo?.()
          break
        case 'pause':  p.pauseVideo?.(); break
        case 'mute':   p.mute?.(); break
        case 'unmute': p.unMute?.(); break
        case 'restart':
          p.seekTo?.(0, true)
          p.playVideo?.()
          break
        case 'stop':   p.stopVideo?.(); break
      }
    } catch {}
  }, [ready, control?.commandId, control?.command, control?.volume])

  return (
    <div className="absolute inset-0 w-full h-full" aria-label={title || 'Video Live'}>
      <div ref={hostRef} className="w-full h-full" />
    </div>
  )
}

// Controllable direct-file player (mp4/webm/…). Same remote command contract.
function VideoFileLivePlayer({ url, control }: { url: string; control?: VideoControl }) {
  const ref = useRef<HTMLVideoElement>(null)
  const lastCommandId = useRef<string | null>(null)

  useEffect(() => {
    const v = ref.current
    if (!v || typeof control?.volume !== 'number') return
    v.volume = Math.min(1, Math.max(0, control.volume / 100))
  }, [control?.volume])

  useEffect(() => {
    const v = ref.current
    if (!v || !control?.commandId) return
    if (control.commandId === lastCommandId.current) return
    lastCommandId.current = control.commandId
    try {
      switch (control.command) {
        case 'play':
          if (typeof control.volume === 'number') v.volume = Math.min(1, Math.max(0, control.volume / 100))
          v.muted = false
          void v.play().catch(() => {})
          break
        case 'pause':  v.pause(); break
        case 'mute':   v.muted = true; break
        case 'unmute': v.muted = false; break
        case 'restart':
          v.currentTime = 0
          void v.play().catch(() => {})
          break
        case 'stop':
          v.pause()
          v.currentTime = 0
          break
      }
    } catch {}
  }, [control?.commandId, control?.command, control?.volume])

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      ref={ref}
      src={url}
      className="absolute inset-0 w-full h-full object-contain"
      autoPlay
      muted
      loop
      playsInline
    />
  )
}

// Video Live — wedding styled box (used when Video Live is the only / centered
// section). Stays inside the elegant gold frame and never covers the names,
// which live in the centered header above.
function WeddingVideoLiveBox({ source, title, control }: { source: VideoLiveSource; title?: string; control?: VideoControl }) {
  return (
    <div className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-6 sm:p-8 shadow-wedding-lg">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-wedding-gold/20">
        <Youtube className="h-7 w-7 text-wedding-gold" />
        <h2 className="text-xl font-semibold uppercase tracking-[0.22em] text-wedding-champagne/90 truncate">
          {title || 'Video Live'}
        </h2>
      </div>
      <VideoEmbed source={source} title={title} control={control} frameClass="border border-wedding-gold/30" />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// PARTY MODE SCREEN — dark premium with red wine & fuchsia accents
// Designed for TV/projector at clubs / private parties / events.
// ════════════════════════════════════════════════════════════════

function PartyScreen({
  slug, session, roulette, active_poll, photos,
}: {
  slug: string
  session: { event_name: string; dj_name: string | null; is_active: boolean; screen_config?: any }
  roulette: any
  active_poll: any
  photos: any[]
}) {
  const envBase = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
  const origin = envBase || (typeof window !== 'undefined' ? window.location.origin : 'https://www.iomixo.com')
  const liveUrl = `${origin}/live/${slug}`

  const total = (active_poll?.tally ?? []).reduce((a: number, b: number) => a + b, 0) || 0

  // Visibilità schermo Party Mode — guidata ESCLUSIVAMENTE da screen_config.
  // Un widget appare solo se il rispettivo toggle è esplicitamente true.
  // (Foto Live Booth → show_photos, Music Battle → show_polls, Party Roulette → show_roulette)
  const cfg = session.screen_config ?? {}
  const showLiveBooth     = cfg.show_photos   === true
  const showMusicBattle   = cfg.show_polls    === true
  const showPartyRoulette = cfg.show_roulette === true
  // Layout Live Booth (single | grid | auto). Default 'single' (retrocompat).
  const liveBoothLayout: LiveBoothLayout = (cfg.live_booth_layout as LiveBoothLayout) ?? 'single'
  // Video Live — solo con switch attivo E link valido (YouTube o file video).
  const partyVideo = cfg.show_video_live === true
    ? resolveVideoSource(cfg.video_url, { autoplay: true })
    : null
  // Remote-control state written by the DJ dashboard (regia video live).
  const videoControl: VideoControl = {
    command: cfg.video_live?.command,
    commandId: cfg.video_live?.command_id,
    volume: cfg.video_live?.volume,
  }
  // One-time audio-unlock overlay when Video Live is active or a link exists.
  const videoConfigured = cfg.show_video_live === true || !!resolveVideoSource(cfg.video_url)

  // ── Layout Party Mode Screen ──────────────────────────────────────
  // REGOLA UNICA e prevedibile, guidata dal numero di widget attivi.
  // I widget "colonna" (Party Roulette, Music Battle, Video Live) vengono
  // impilati a SINISTRA con ALTEZZE UGUALI (flex-1); il Live Booth (foto)
  // occupa la colonna DESTRA a tutta altezza. Tutto è centrato e con altezza
  // LIMITATA → card compatte, niente contenitori giganti che riempiono lo schermo.
  //
  //   1 widget → card unica centrata (grande ma controllata)
  //   2 widget → due colonne di pari altezza
  //   3 widget → [Music Battle]/[Video Live] a sinistra + [Live Booth] a destra (2 righe)
  //   4 widget → sinistra impilata (3) + Live Booth a destra
  //
  // SOLO Party Mode: la Wedding Edition usa funzioni/box separati e NON è toccata.

  const rouletteNode = showPartyRoulette ? (
    <PartyScreenPanel icon={<Sparkles className="h-5 w-5" />} title="Party Roulette">
      {roulette?.result ? (
        <div className="h-full flex items-center justify-center">
          <div className="w-full rounded-2xl bg-gradient-to-br from-[#8B0E2F]/40 to-[#FF3D8A]/30 border border-[#FF3D8A]/40 py-6 px-6 text-center">
            <p className="text-3xl xl:text-4xl font-black text-white leading-tight">
              {roulette.result.slot_label}
            </p>
          </div>
        </div>
      ) : (
        <div className="h-full flex items-center justify-center text-center">
          <p className="text-base text-white/50 italic">Il DJ avvierà presto la Party Roulette…</p>
        </div>
      )}
    </PartyScreenPanel>
  ) : null

  const musicBattleNode = showMusicBattle ? (
    <PartyScreenPanel icon={<ListChecks className="h-5 w-5" />} title="Music Battle" subtitle="Vota dal telefono">
      {active_poll ? (
        <div className="h-full flex flex-col min-h-0">
          <p className="text-base xl:text-lg font-bold text-white mb-2 leading-snug line-clamp-2 shrink-0">{active_poll.question}</p>
          <div className="flex flex-col gap-2 flex-1 min-h-0 justify-center">
            {active_poll.options.map((opt: string, i: number) => {
              const tally = active_poll.tally?.[i] ?? 0
              const pct = total > 0 ? Math.round((tally / total) * 100) : 0
              const max = Math.max(...(active_poll.tally ?? [0]))
              const winning = total > 0 && tally === max && tally > 0
              return (
                <div key={i} className={`relative rounded-xl overflow-hidden border flex-1 min-h-0 max-h-14 ${winning ? 'border-[#FF3D8A]/70 shadow-[0_0_20px_rgba(255,61,138,0.4)]' : 'border-white/15'} bg-white/[0.05]`}>
                  <div
                    className={`absolute inset-y-0 left-0 transition-all duration-700 ${winning ? 'bg-gradient-to-r from-[#FF3D8A] to-[#8B0E2F]' : 'bg-gradient-to-r from-[#8B0E2F]/50 to-[#B82E54]/40'}`}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between h-full px-4">
                    <span className={`text-sm font-bold truncate ${winning ? 'text-white' : 'text-white/90'}`}>{opt}</span>
                    <span className="text-sm font-black tabular-nums text-white shrink-0 ml-3">
                      {pct}% <span className="text-white/50 font-medium text-[10px]">({tally})</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 mt-2 text-center shrink-0">
            {total} {total === 1 ? 'voto' : 'voti'}
          </p>
        </div>
      ) : (
        <div className="h-full flex items-center justify-center text-center">
          <p className="text-base text-white/50 italic">Il DJ avvierà presto una Music Battle…</p>
        </div>
      )}
    </PartyScreenPanel>
  ) : null

  const videoNode = partyVideo ? (
    <PartyScreenPanel icon={<Youtube className="h-5 w-5" />} title="Video Live">
      {/* Player 16:9 centrato: riempie la card in altezza senza deformarsi né tagliarsi. */}
      <div className="h-full w-full flex items-center justify-center">
        <div className="h-full aspect-video max-w-full mx-auto">
          <VideoEmbed
            source={partyVideo}
            title={(cfg.video_title as string) || 'Video Live'}
            control={videoControl}
            frameClass="border border-[#FF3D8A]/40 shadow-[0_0_40px_rgba(255,61,138,0.2)]"
          />
        </div>
      </div>
    </PartyScreenPanel>
  ) : null

  const boothNode = showLiveBooth ? (
    <PartyScreenPanel icon={<Camera className="h-5 w-5" />} title="Live Booth" subtitle="Foto degli ospiti">
      {/* Foto INTERA: sfondo scuro soft + object-contain (mai tagliata, mai a striscia). */}
      <div className="h-full w-full rounded-xl bg-black/30 overflow-hidden flex items-center justify-center">
        <PartyPhotoDisplay photos={photos as any} layout={liveBoothLayout} eventName={session.event_name} />
      </div>
    </PartyScreenPanel>
  ) : null

  // Widget "colonna" (sinistra), ordine: Party Roulette → Music Battle → Video Live.
  const leftNodes = [rouletteNode, musicBattleNode, videoNode].filter(Boolean) as React.ReactNode[]
  const leftCount = leftNodes.length
  const hasLeft = leftCount > 0
  const hasBooth = !!boothNode
  const activeWidgetsCount = leftCount + (hasBooth ? 1 : 0)
  const anyActive = activeWidgetsCount > 0
  const isCompact = activeWidgetsCount >= 3
  const pad = isCompact ? 'p-6' : 'p-8'

  // Altezza dell'area widget: limitata così le card restano compatte.
  // 1 colonna sinistra → 500px · 2 → 576px (caso 3 widget) · 3 → 620px.
  const stackHeights: Record<number, string> = { 1: 'h-[500px]', 2: 'h-[576px]', 3: 'h-[620px]' }

  const renderWidgets = () => {
    // Nessun Live Booth → solo colonne affiancate (1 / 2 / 3).
    if (!hasBooth) {
      if (leftCount === 1) {
        return (
          <div className="w-full max-w-[1100px] h-[62vh] max-h-[620px] mx-auto">
            {leftNodes[0]}
          </div>
        )
      }
      const cols = leftCount === 2 ? 'grid-cols-2' : 'grid-cols-3'
      return (
        <div className={`w-full grid ${cols} gap-6 h-[500px] max-h-[70vh] max-w-[1600px] mx-auto`}>
          {leftNodes.map((n, i) => <div key={i} className="min-h-0">{n}</div>)}
        </div>
      )
    }

    // Solo Live Booth → card unica centrata (grande ma controllata).
    if (!hasLeft) {
      return (
        <div className="w-full max-w-[1150px] h-[64vh] max-h-[640px] mx-auto">
          {boothNode}
        </div>
      )
    }

    // Live Booth + colonna sinistra impilata (altezze uguali via flex-1).
    //   [ leftNodes[0] ] [ Live Booth ]
    //   [ leftNodes[1] ] [ Live Booth ]
    const leftSpan = leftCount === 1 ? 'col-span-6' : 'col-span-5'
    const boothSpan = leftCount === 1 ? 'col-span-6' : 'col-span-7'
    const areaH = stackHeights[Math.min(leftCount, 3)] ?? 'h-[620px]'
    return (
      <div className={`w-full grid grid-cols-12 gap-4 ${areaH} max-h-[82vh] max-w-[1700px] mx-auto`}>
        <div className={`${leftSpan} flex flex-col gap-4 min-h-0`}>
          {leftNodes.map((n, i) => (
            <div key={i} className="flex-1 min-h-0">{n}</div>
          ))}
        </div>
        <div className={`${boothSpan} min-h-0`}>
          {boothNode}
        </div>
      </div>
    )
  }

  return (
    <PartyShell>
      {videoConfigured && <VideoLiveAudioUnlock theme="party" />}
      <div className={`h-screen w-screen overflow-hidden flex flex-col relative ${pad}`}>
        {/* HEADER — sinistra: titolo evento + DJ · destra: modulo QR "scansiona & partecipa" */}
        <header className={`flex items-center justify-between gap-8 shrink-0 ${isCompact ? 'mb-5' : 'mb-7'}`}>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.45em] text-[#FF7AB6] mb-2">
              ✦ Party Mode Live ✦
            </p>
            <h1 className={`font-black text-white leading-[0.95] tracking-tight truncate ${isCompact ? 'text-4xl xl:text-5xl' : 'text-5xl xl:text-6xl'}`}>
              {session.event_name}
            </h1>
            {session.dj_name && (
              <p className={`text-white/55 ${isCompact ? 'text-lg mt-2' : 'text-xl mt-3'}`}>
                DJ <span className="text-[#FF7AB6] font-semibold">{session.dj_name}</span>
              </p>
            )}
          </div>
          {/* Modulo "Scan & join": QR + etichetta in una card coerente, centrata e staccata dal bordo */}
          <div className="shrink-0 flex flex-col items-center gap-2.5 rounded-2xl bg-white/[0.05] border border-white/10 px-5 py-4 backdrop-blur-md">
            <div className="bg-white p-3 rounded-xl shadow-[0_0_40px_rgba(255,61,138,0.35)] border-2 border-[#FF3D8A]/60">
              <QRCodeSVG value={liveUrl} size={isCompact ? 124 : 150} level="M" includeMargin={false} />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white text-center">
              Scansiona &amp; partecipa
            </p>
          </div>
        </header>

        {/* MAIN — griglia stabile guidata dal numero di widget attivi (renderWidgets). */}
        {anyActive ? (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {renderWidgets()}
          </div>
        ) : (
          /* Nessun toggle attivo → schermo Party pulito: solo header + QR + branding */
          <div className="flex-1" />
        )}

        {/* FOOTER */}
        <footer className={`shrink-0 ${isCompact ? 'mt-4' : 'mt-6'}`}>
          <PartyDivider />
          <p className="text-center text-[11px] uppercase tracking-[0.4em] text-white/50 mt-3">
            Powered by <span className="text-[#FF7AB6] font-bold">IOMIXO Live Hub</span>
          </p>
        </footer>
      </div>
    </PartyShell>
  )
}

function PartyScreenPanel({
  icon, title, subtitle, children, className = '',
}: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`h-full rounded-2xl backdrop-blur-md bg-white/[0.04] border border-white/[0.1] p-4 flex flex-col min-h-0 shadow-[0_8px_40px_rgba(139,14,47,0.25)] ${className}`}>
      <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-white/10 shrink-0">
        <span className="text-[#FF3D8A]">{icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.22em] text-white leading-none">{title}</h2>
          {subtitle && <p className="text-[9px] uppercase tracking-[0.18em] text-white/40 mt-1">{subtitle}</p>}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </section>
  )
}
