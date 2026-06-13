'use client'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { QRCodeSVG } from 'qrcode.react'
import { Heart, Sparkles, ListChecks, Camera, Footprints, Star } from 'lucide-react'
import { liveScreen } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { WeddingShell } from '@/components/wedding/WeddingUI'
import { WeddingPhotoSlideshow } from '@/components/wedding/WeddingPhotoFrame'
import { RouletteWheel } from '@/components/wedding/RouletteWheel'
import { PartyShell, PartyDivider, PARTY } from '@/components/party/PartyUI'
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
                  <WeddingPhotoSlideshow
                    photos={photos as any}
                    coupleNames={session.couple_names ?? session.event_name}
                    weddingDate={session.wedding_date}
                  />
                </div>
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
                <WeddingPhotoSlideshow
                  photos={photos as any}
                  coupleNames={session.couple_names ?? session.event_name}
                  weddingDate={session.wedding_date}
                />
              </section>
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

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-wedding-gold/25 bg-wedding-ivory/5 py-10 px-6 text-center">
      <p className="font-wedding text-xl italic text-wedding-ivory/60 leading-snug">
        {text}
      </p>
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
  const featured = photos?.find((p: any) => p.is_featured) ?? null
  const rest = (photos ?? []).filter((p: any) => p.id !== featured?.id)

  // Visibilità schermo Party Mode — guidata ESCLUSIVAMENTE da screen_config.
  // Un widget appare solo se il rispettivo toggle è esplicitamente true.
  // (Foto Live Booth → show_photos, Music Battle → show_polls, Party Roulette → show_roulette)
  const cfg = session.screen_config ?? {}
  const showLiveBooth     = cfg.show_photos   === true
  const showMusicBattle   = cfg.show_polls    === true
  const showPartyRoulette = cfg.show_roulette === true
  const showGames = showMusicBattle || showPartyRoulette
  const anyActive = showLiveBooth || showGames

  // simple photo carousel
  const [carouselIdx, setCarouselIdx] = useState(0)
  useEffect(() => {
    if (rest.length <= 1) return
    const id = setInterval(() => setCarouselIdx((i) => (i + 1) % rest.length), 4500)
    return () => clearInterval(id)
  }, [rest.length])

  return (
    <PartyShell>
      <div className="min-h-screen w-screen overflow-hidden flex flex-col p-10 relative">
        {/* HEADER */}
        <header className="flex items-start justify-between gap-6 mb-8">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.45em] text-[#FF7AB6] mb-3">
              ✦ Party Mode Live ✦
            </p>
            <h1 className="text-7xl xl:text-8xl font-black text-white leading-[0.95] tracking-tight">
              {session.event_name}
            </h1>
            {session.dj_name && (
              <p className="text-2xl text-white/60 mt-3">DJ <span className="text-[#FF7AB6] font-semibold">{session.dj_name}</span></p>
            )}
          </div>
          <div className="shrink-0 text-center">
            <div className="bg-white p-3 rounded-2xl shadow-[0_0_40px_rgba(255,61,138,0.4)] border-2 border-[#FF3D8A]/60">
              <QRCodeSVG value={liveUrl} size={180} level="M" includeMargin={false} />
            </div>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.3em] text-white">
              Scansiona & partecipa
            </p>
            <p className="text-[10px] text-[#FF7AB6] mt-1 font-mono">
              {liveUrl.replace(/^https?:\/\//, '')}
            </p>
          </div>
        </header>

        {/* MAIN GRID — solo le sezioni abilitate in screen_config */}
        {anyActive ? (
          <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
            {/* LEFT — Party Roulette + Music Battle */}
            {showGames && (
              <div className={`flex flex-col gap-6 min-h-0 ${showLiveBooth ? 'col-span-5' : 'col-span-12'}`}>
                {showPartyRoulette && (
                  <PartyScreenPanel icon={<Sparkles />} title="Party Roulette">
                    {roulette?.result ? (
                      <div className="rounded-2xl bg-gradient-to-br from-[#8B0E2F]/40 to-[#FF3D8A]/30 border border-[#FF3D8A]/40 py-10 px-6 text-center">
                        <p className="text-5xl xl:text-6xl font-black text-white leading-tight">
                          {roulette.result.slot_label}
                        </p>
                      </div>
                    ) : (
                      <div className="text-center py-10">
                        <p className="text-xl text-white/50 italic">
                          Il DJ avvierà presto la Party Roulette…
                        </p>
                      </div>
                    )}
                  </PartyScreenPanel>
                )}

                {showMusicBattle && (
                  <PartyScreenPanel icon={<ListChecks />} title="Music Battle" subtitle="Vota dal telefono">
                    {active_poll ? (
                      <>
                        <p className="text-3xl font-bold text-white mb-5 leading-snug">{active_poll.question}</p>
                        <div className="space-y-3">
                          {active_poll.options.map((opt: string, i: number) => {
                            const tally = active_poll.tally?.[i] ?? 0
                            const pct = total > 0 ? Math.round((tally / total) * 100) : 0
                            const max = Math.max(...(active_poll.tally ?? [0]))
                            const winning = total > 0 && tally === max && tally > 0
                            return (
                              <div key={i} className={`relative rounded-2xl overflow-hidden border h-16 ${winning ? 'border-[#FF3D8A]/70 shadow-[0_0_20px_rgba(255,61,138,0.4)]' : 'border-white/15'} bg-white/[0.05]`}>
                                <div
                                  className={`absolute inset-y-0 left-0 transition-all duration-700 ${winning ? 'bg-gradient-to-r from-[#FF3D8A] to-[#8B0E2F]' : 'bg-gradient-to-r from-[#8B0E2F]/50 to-[#B82E54]/40'}`}
                                  style={{ width: `${pct}%` }}
                                />
                                <div className="relative flex items-center justify-between h-full px-6">
                                  <span className={`text-xl font-bold ${winning ? 'text-white' : 'text-white/90'}`}>{opt}</span>
                                  <span className="text-xl font-black tabular-nums text-white">{pct}%</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 mt-4 text-center">
                          {total} {total === 1 ? 'voto' : 'voti'}
                        </p>
                      </>
                    ) : (
                      <div className="text-center py-10">
                        <p className="text-xl text-white/50 italic">
                          Il DJ avvierà presto una Music Battle…
                        </p>
                      </div>
                    )}
                  </PartyScreenPanel>
                )}
              </div>
            )}

            {/* RIGHT — Live Booth photos */}
            {showLiveBooth && (
              <div className={`flex flex-col min-h-0 ${showGames ? 'col-span-7' : 'col-span-12'}`}>
                <PartyScreenPanel icon={<Camera />} title="Live Booth" subtitle="Foto del pubblico" className="flex-1">
                  {featured && (
                    <div className="mb-4 relative rounded-2xl overflow-hidden border-2 border-[#FF3D8A]/70 ring-4 ring-[#FF3D8A]/20 shadow-[0_0_50px_rgba(255,61,138,0.35)] max-h-[420px]">
                      <img src={featured.url} alt="" className="w-full h-full object-cover" />
                      <div className="absolute top-3 right-3 bg-[#FF3D8A] text-white px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-lg">
                        <Star className="h-3 w-3 fill-current" /> In evidenza
                      </div>
                    </div>
                  )}

                  {rest.length > 0 ? (
                    <div className="grid grid-cols-4 gap-3">
                      {rest.slice(0, 8).map((p: any, i: number) => (
                        <div
                          key={p.id}
                          className={`aspect-square rounded-xl overflow-hidden border bg-white/[0.04] transition-all duration-500 ${
                            i === carouselIdx % Math.max(rest.length, 1) ? 'border-[#FF3D8A]/60 ring-2 ring-[#FF3D8A]/30 scale-[1.04]' : 'border-white/10'
                          }`}
                        >
                          {p.url && <img src={p.url} alt="" className="w-full h-full object-cover" />}
                        </div>
                      ))}
                    </div>
                  ) : !featured ? (
                    <div className="rounded-2xl border-2 border-dashed border-[#FF3D8A]/30 bg-white/[0.02] py-20 text-center">
                      <Camera className="h-14 w-14 text-[#FF3D8A]/40 mx-auto mb-4" />
                      <p className="text-2xl font-bold text-white mb-2">Photo Moment in arrivo!</p>
                      <p className="text-sm text-white/50">
                        Scansiona il QR e scatta la prima foto della serata
                      </p>
                    </div>
                  ) : null}
                </PartyScreenPanel>
              </div>
            )}
          </div>
        ) : (
          /* Nessun toggle attivo → schermo Party pulito: solo header + QR + branding */
          <div className="flex-1" />
        )}

        <footer className="mt-8">
          <PartyDivider />
          <p className="text-center text-[11px] uppercase tracking-[0.4em] text-white/50 mt-4">
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
    <section className={`rounded-2xl backdrop-blur-md bg-white/[0.04] border border-white/[0.1] p-6 flex flex-col min-h-0 shadow-[0_8px_40px_rgba(139,14,47,0.25)] ${className}`}>
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
        <span className="text-[#FF3D8A]">{icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold uppercase tracking-[0.3em] text-white">{title}</h2>
          {subtitle && <p className="text-[10px] uppercase tracking-[0.25em] text-white/40 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </section>
  )
}
