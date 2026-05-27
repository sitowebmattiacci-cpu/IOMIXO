'use client'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { Heart, Sparkles, ListChecks, Camera, Footprints } from 'lucide-react'
import { liveScreen } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { WeddingShell } from '@/components/wedding/WeddingUI'
import { RouletteWheel } from '@/components/wedding/RouletteWheel'
import { useEffect, useRef, useState } from 'react'

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
  const total = (active_poll?.tally ?? []).reduce((a, b) => a + b, 0) || 0
  const shoeActive = shoe_game?.status === 'running' && shoe_game?.config?.is_active
  const shoeQuestions: string[] = shoe_game?.config?.questions ?? []
  const shoeIdx: number = shoe_game?.config?.current_index ?? 0

  // Sezioni abilitate dal DJ nel pannello "Visibilità Schermo".
  // Se è ON il pannello viene mostrato anche se ancora non c'è contenuto
  // (es. dediche o sondaggi in attesa) — così il DJ vede subito il layout.
  const cfg = session.screen_config ?? {}
  const enabledRoulette   = cfg.show_roulette   !== false
  const enabledShoeGame   = cfg.show_shoe_game  !== false
  const enabledPolls      = cfg.show_polls      !== false
  const enabledDedications = cfg.show_dedications !== false
  const enabledPhotos     = cfg.show_photos     !== false

  const activeSections = [
    enabledRoulette   ? 'roulette'    : null,
    enabledShoeGame   ? 'shoe'        : null,
    enabledPolls      ? 'poll'        : null,
    enabledDedications ? 'dedications' : null,
    enabledPhotos     ? 'photos'      : null,
  ].filter(Boolean)

  const hasContent = activeSections.length > 0
  const singleSection = activeSections.length === 1

  // Solo giochi attivi (no foto/dediche/sondaggi)
  const onlyGames = hasContent &&
    activeSections.every(s => s === 'roulette' || s === 'shoe') &&
    (activeSections.includes('roulette') || activeSections.includes('shoe'))

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
  const largeFontSize = isWideFont ? 'text-[11rem]' : 'text-[14rem]'
  const mediumFontSize = isWideFont ? 'text-7xl' : 'text-8xl'

  return (
    <WeddingShell variant="stage">
      {showRouletteWheel && wheelPenitenze.length > 0 && (
        <RouletteWheel
          penitenze={wheelPenitenze}
          selectedIndex={selectedIndex}
          onComplete={() => {}}
          showClose={false}
        />
      )}
      <div className="min-h-screen w-screen overflow-hidden flex items-stretch relative">
        {/* Decorative gold orbs */}
        <div className="absolute top-0 left-1/4 h-[500px] w-[500px] rounded-full bg-wedding-gold/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 h-[400px] w-[400px] rounded-full bg-wedding-blush/10 blur-3xl pointer-events-none" />

        {/* Empty state - show only couple names centered */}
        {!hasContent && (
          <div className="w-full flex flex-col items-center justify-center p-12 relative z-10">
            <div className="text-center">
              <div className="inline-flex items-center gap-3 mb-6 text-wedding-gold">
                <span className="h-px w-20 bg-gradient-to-r from-transparent to-wedding-gold/60" />
                <span className="text-3xl">✦</span>
                <span className="text-sm uppercase tracking-[0.4em] font-medium">Pro Plus Wedding</span>
                <span className="text-3xl">✦</span>
                <span className="h-px w-20 bg-gradient-to-l from-transparent to-wedding-gold/60" />
              </div>
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
              Powered by <span className="text-wedding-gold">Pro Plus Wedding Edition</span>
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

              {photos.length > 0 && (
                <div className="rounded-2xl border border-wedding-gold/20 bg-black/30 backdrop-blur-md p-12">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-wedding-gold/20">
                    <Camera className="h-8 w-8 text-wedding-gold" />
                    <h2 className="text-2xl font-semibold uppercase tracking-[0.25em] text-wedding-champagne/90">{t('wedding.screen.recentPhotos')}</h2>
                  </div>
                  <div className="grid grid-cols-3 gap-6 max-h-[600px] overflow-y-auto">
                    {photos.slice(0, 12).map((p) => (
                      <div
                        key={p.id}
                        className={`aspect-square rounded-xl overflow-hidden border shadow-lg transition-all duration-500 ${
                          (p as any).is_featured
                            ? 'border-wedding-gold/60 ring-4 ring-wedding-gold/30 scale-105'
                            : 'border-wedding-gold/20 bg-wedding-ivory/5'
                        }`}
                      >
                        {p.url && <img src={p.url} alt="" className="w-full h-full object-cover" />}
                        {(p as any).is_featured && (
                          <div className="absolute top-2 right-2 bg-wedding-gold/90 text-wedding-ink px-2 py-1 rounded-full text-xs font-semibold">
                            ★ In evidenza
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <footer className="mt-12 text-xs uppercase tracking-[0.3em] text-wedding-taupe">
              Powered by <span className="text-wedding-gold">Pro Plus Wedding Edition</span>
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
            </div>

            <footer className="absolute bottom-8 text-xs uppercase tracking-[0.3em] text-wedding-taupe">
              Powered by <span className="text-wedding-gold">Pro Plus Wedding Edition</span>
            </footer>
          </div>
        )}

        {/* Full layout with multiple sections */}
        {hasContent && !singleSection && !onlyGames && (
          <div className="w-full flex flex-col p-12 relative z-10">
          {/* Header */}
          <header className="text-center mb-10">
            <div className="inline-flex items-center gap-3 mb-4 text-wedding-gold">
              <span className="h-px w-16 bg-gradient-to-r from-transparent to-wedding-gold/60" />
              <span className="text-2xl">✦</span>
              <span className="text-[12px] uppercase tracking-[0.4em] font-medium">Pro Plus Wedding</span>
              <span className="text-2xl">✦</span>
              <span className="h-px w-16 bg-gradient-to-l from-transparent to-wedding-gold/60" />
            </div>
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
              <StagePanel icon={<Camera className="h-6 w-6" />} title={t('wedding.screen.recentPhotos')}>
                {photos.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 overflow-y-auto max-h-[520px] pr-1">
                    {photos.slice(0, 60).map((p) => (
                      <div
                        key={p.id}
                        className={`aspect-square rounded-xl overflow-hidden border shadow-lg relative transition-all duration-500 ${
                          (p as any).is_featured
                            ? 'border-wedding-gold/60 ring-2 ring-wedding-gold/40'
                            : 'border-wedding-gold/20 bg-wedding-ivory/5'
                        }`}
                      >
                        {p.url && <img src={p.url} alt="" className="w-full h-full object-cover" />}
                        {(p as any).is_featured && (
                          <div className="absolute top-1 right-1 bg-wedding-gold/95 text-wedding-ink px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                            ★
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyPanel text="Le foto degli invitati appariranno qui 📸" />
                )}
              </StagePanel>
            )}
          </div>

          <footer className="mt-8 text-center text-xs uppercase tracking-[0.3em] text-wedding-taupe">
            Powered by <span className="text-wedding-gold">Pro Plus Wedding Edition</span>
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

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-wedding-gold/25 bg-wedding-ivory/5 py-10 px-6 text-center">
      <p className="font-wedding text-xl italic text-wedding-ivory/60 leading-snug">
        {text}
      </p>
    </div>
  )
}
