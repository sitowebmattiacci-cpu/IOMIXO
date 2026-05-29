'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  QrCode, Heart, Camera, Monitor, Images, Radio,
  CheckCircle2, ArrowRight, PartyPopper, Music2, Gamepad2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { PLAN_METADATA, type Plan } from '@/types'
import { Logo } from '@/components/Logo'
import { useI18n } from '@/lib/i18n'

// ── Brand tokens (DARK wine palette) ────────────────────────────
// bg-deep:        #0F0A0C  (page background)
// bg-alt:         #170F11  (alt section bg)
// bg-card:        #1E1417  (card surface)
// bg-card-2:      #241519  (raised surface)
// border:         #3A2428
// border-soft:    #2B1B1F
// primary:        #8F1D2C
// primary-hi:     #A82335  (hover on dark)
// rose:           #E8B7C8
// rose-soft:      #C98AA0
// ivory:          #F7F4F3  (text on dark)
// muted:          #A89A98

// ── Top navigation ─────────────────────────────────────────────
function TopNav() {
  const { t } = useI18n()
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0F0A0C]/85 border-b border-[#2B1B1F]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={32} />
          <div className="leading-tight">
            <p className="text-sm font-bold text-[#F7F4F3]">IOMIXO</p>
            <p className="text-[10px] text-[#E8B7C8] font-medium -mt-0.5">Live Hub</p>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-[#A89A98]">
          <a href="#features" className="hover:text-[#F7F4F3]">{t('landing.nav.features')}</a>
          <a href="#pricing"  className="hover:text-[#F7F4F3]">{t('landing.nav.pricing')}</a>
          <Link href="/login" className="hover:text-[#F7F4F3]">{t('landing.nav.login')}</Link>
          <Link href="/register">
            <Button size="sm" className="!bg-[#8F1D2C] hover:!bg-[#A82335] !text-white !border-0">{t('landing.nav.cta')}</Button>
          </Link>
          <LanguageSwitcher />
        </nav>
        <Link href="/register" className="md:hidden">
          <Button size="sm" className="!bg-[#8F1D2C] hover:!bg-[#A82335] !text-white !border-0">{t('landing.nav.ctaShort')}</Button>
        </Link>
      </div>
    </header>
  )
}

// ── Hero ───────────────────────────────────────────────────────
function Hero() {
  const { t } = useI18n()
  return (
    <section className="relative overflow-hidden pt-10 pb-12 sm:pt-14 sm:pb-16">
      {/* Deep wine background with rose/burgundy glows */}
      <div className="absolute inset-0 -z-10 bg-[#0F0A0C]" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#1E0F14] via-[#140A0D] to-[#0F0A0C]" />
      <div className="absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full bg-[#8F1D2C]/25 blur-3xl -z-10" />
      <div className="absolute top-24 -right-24 w-[460px] h-[460px] rounded-full bg-[#E8B7C8]/10 blur-3xl -z-10" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Compact heading block */}
        <div className="text-center max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 rounded-full border border-[#8F1D2C]/40 bg-[#1E1417] px-3 py-1 text-xs text-[#E8B7C8] mb-5"
          >
            <Radio className="h-3 w-3" />
            {t('landing.hero.badge', 'Piattaforma live per eventi interattivi')}
          </motion.div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#F7F4F3] mb-4">
            IOMIXO <span className="text-[#E8B7C8]">Live Hub</span>
          </h1>
          <p className="text-lg sm:text-xl text-[#F7F4F3] max-w-2xl mx-auto mb-3 font-medium">
            {t('landing.hero.tagline', 'La piattaforma interattiva per DJ, eventi e matrimoni.')}
          </p>
          <p className="text-sm sm:text-base text-[#A89A98] max-w-2xl mx-auto mb-6">
            {t('landing.hero.subline', 'Gli ospiti partecipano dal telefono via QR — richieste musicali, giochi, dediche, foto e Screen Mode in tempo reale.')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto !bg-[#8F1D2C] hover:!bg-[#A82335] !text-white !border-0">
                {t('landing.hero.ctaPrimary', 'Inizia gratis')} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <a href="#modes">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto !bg-transparent hover:!bg-[#1E1417] !text-[#E8B7C8] !border !border-[#8F1D2C]/50">
                {t('landing.hero.ctaSecondary', 'Scopri le modalità')}
              </Button>
            </a>
          </div>
        </div>

        {/* Mode cards — Party Mode & Wedding Edition (above the fold) */}
        <div id="modes" className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 max-w-5xl mx-auto">
          {/* PARTY MODE */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="relative rounded-2xl p-6 sm:p-7 bg-[#1E1417] border border-[#3A2428] hover:border-[#8F1D2C]/70 transition group overflow-hidden"
          >
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[#8F1D2C]/25 blur-2xl" />
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-xl bg-[#8F1D2C] text-white flex items-center justify-center">
                <PartyPopper className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#E8B7C8] font-semibold">Modalità</p>
                <h3 className="text-xl font-bold text-[#F7F4F3]">Party Mode</h3>
              </div>
            </div>
            <p className="text-sm text-[#A89A98] mb-4">
              {t('landing.modes.party.for', 'Per compleanni, feste private, locali, aperitivi ed eventi aziendali.')}
            </p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-[#F7F4F3] mb-5">
              {[
                t('landing.modes.party.f1', 'Richieste live'),
                t('landing.modes.party.f2', 'Giochi'),
                t('landing.modes.party.f3', 'Live Booth'),
                t('landing.modes.party.f4', 'Screen Mode'),
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#E8B7C8] shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/register?mode=party">
              <Button className="w-full !bg-[#8F1D2C] hover:!bg-[#A82335] !text-white !border-0">
                {t('landing.modes.party.cta', 'Avvia un Party')} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </motion.div>

          {/* WEDDING EDITION */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="relative rounded-2xl p-6 sm:p-7 bg-gradient-to-br from-[#241519] via-[#1E1417] to-[#1A0F12] border border-[#E8B7C8]/30 hover:border-[#E8B7C8]/60 transition group overflow-hidden"
          >
            <span className="absolute top-4 right-4 text-[10px] font-semibold bg-[#E8B7C8] text-[#3A1019] rounded-full px-2.5 py-0.5">
              Premium
            </span>
            <div className="absolute -bottom-12 -left-10 w-44 h-44 rounded-full bg-[#E8B7C8]/15 blur-2xl" />
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-xl bg-[#1E1417] border border-[#E8B7C8]/40 text-[#E8B7C8] flex items-center justify-center">
                <Heart className="h-6 w-6 fill-[#E8B7C8]" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#E8B7C8] font-semibold">Edizione</p>
                <h3 className="text-xl font-bold text-[#F7F4F3]">Wedding Edition</h3>
              </div>
            </div>
            <p className="text-sm text-[#A89A98] mb-4">
              {t('landing.modes.wedding.for', 'Per matrimoni, anniversari ed eventi romantici.')}
            </p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-[#F7F4F3] mb-5">
              {[
                t('landing.modes.wedding.f1', 'Dediche agli sposi'),
                t('landing.modes.wedding.f2', 'Album foto'),
                t('landing.modes.wedding.f3', 'Live Booth'),
                t('landing.modes.wedding.f4', 'Giochi wedding'),
                t('landing.modes.wedding.f5', 'Screen Mode'),
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#E8B7C8] shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/register?mode=wedding">
              <Button className="w-full !bg-[#8F1D2C] hover:!bg-[#A82335] !text-white !border-0">
                {t('landing.modes.wedding.cta', 'Avvia il Matrimonio')} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
        </div>

        {/* Trust line */}
        <p className="mt-8 text-center text-xs text-[#A89A98] flex items-center justify-center gap-2">
          <QrCode className="h-3.5 w-3.5 text-[#E8B7C8]" />
          {t('landing.hero.audiences', 'Gli ospiti partecipano scansionando un QR Code — nessuna app da scaricare.')}
        </p>
      </div>
    </section>
  )
}

// ── Capabilities row (4 big icons) ─────────────────────────────
function Capabilities() {
  const { t } = useI18n()
  const items = [
    { Icon: Music2,    title: t('landing.caps.requests.title', 'Richieste Live'),     body: t('landing.caps.requests.body', 'Il pubblico invia canzoni dal telefono. Tu approvi e gestisci la coda.') },
    { Icon: Camera,    title: t('landing.caps.booth.title',    'Live Booth'),         body: t('landing.caps.booth.body',    'Foto degli ospiti che alimentano album e Photo Moment in tempo reale.') },
    { Icon: Gamepad2,  title: t('landing.caps.games.title',    'Giochi Interattivi'), body: t('landing.caps.games.body',    'Roulette, quiz e giochi wedding per coinvolgere tutta la sala.') },
    { Icon: Monitor,   title: t('landing.caps.screen.title',   'Screen Mode'),        body: t('landing.caps.screen.body',   'QR, foto, dediche e giochi proiettati su TV o maxi-schermo.') },
  ]
  return (
    <section className="py-14 sm:py-20 bg-[#170F11] border-y border-[#2B1B1F]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#1E1417] border border-[#3A2428] px-3 py-1 text-xs text-[#E8B7C8] mb-4">
            <Sparkles className="h-3 w-3" />
            {t('landing.caps.badge', 'Tutto in una sola piattaforma')}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#F7F4F3]">
            {t('landing.caps.title', 'Quattro strumenti, un evento indimenticabile')}
          </h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {items.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl p-5 sm:p-6 bg-[#1E1417] border border-[#3A2428] hover:border-[#8F1D2C]/70 transition text-center"
            >
              <div className="h-14 w-14 mx-auto rounded-2xl bg-[#8F1D2C]/15 border border-[#8F1D2C]/30 flex items-center justify-center mb-4">
                <Icon className="h-7 w-7 text-[#E8B7C8]" />
              </div>
              <h3 className="text-base font-semibold text-[#F7F4F3] mb-1.5">{title}</h3>
              <p className="text-xs sm:text-sm text-[#A89A98] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Feature sections (5 per spec) ──────────────────────────────
type SectionKey = 'requests' | 'wedding' | 'booth' | 'screen' | 'album'
const SECTION_ICONS: Record<SectionKey, typeof QrCode> = {
  requests: QrCode,
  wedding:  Heart,
  booth:    Camera,
  screen:   Monitor,
  album:    Images,
}
const SECTION_FALLBACK: Record<SectionKey, { title: string; body: string }> = {
  requests: { title: 'Richieste musicali senza interruzioni', body: 'Gli ospiti inviano le richieste dal telefono. Il DJ approva, rifiuta o gestisce tutto dalla dashboard.' },
  wedding:  { title: 'Esperienze interattive per matrimoni',  body: 'Dediche agli sposi, giochi live, roulette wedding, gioco della scarpa e momenti speciali guidati dal DJ.' },
  booth:    { title: 'Live Booth fotografico',                body: 'Gli invitati scattano foto dal telefono, partecipano al Photo Moment e le immagini entrano nell’album degli sposi.' },
  screen:   { title: 'Tutto anche su schermo',                body: 'Mostra QR Code, foto, risultati dei giochi e momenti live su TV o proiettore.' },
  album:    { title: 'Album ospiti pronto da condividere',    body: 'Le foto approvate finiscono in una libreria privata con link dedicato per gli sposi.' },
}

function Sections() {
  const { t } = useI18n()
  const keys: SectionKey[] = ['requests', 'wedding', 'booth', 'screen', 'album']
  return (
    <section id="features" className="py-20 sm:py-28 bg-[#0F0A0C]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#F7F4F3] mb-4">
            {t('landing.features.title', 'Tutto quello che serve per la tua serata')}
          </h2>
          <p className="text-[#A89A98] max-w-2xl mx-auto">
            {t('landing.features.subtitle', 'IOMIXO Live Hub è il ponte tra te e il tuo pubblico — senza distrarti dal mix.')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {keys.map((key) => {
            const Icon = SECTION_ICONS[key]
            const fb = SECTION_FALLBACK[key]
            return (
              <div
                key={key}
                className="rounded-2xl p-6 bg-[#1E1417] border border-[#3A2428] hover:border-[#8F1D2C]/70 transition"
              >
                <div className="h-11 w-11 rounded-xl bg-[#8F1D2C]/15 border border-[#8F1D2C]/30 flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-[#E8B7C8]" />
                </div>
                <h3 className="text-base font-semibold text-[#F7F4F3] mb-2">
                  {t(`landing.sections.${key}.title`, fb.title)}
                </h3>
                <p className="text-sm text-[#A89A98] leading-relaxed">
                  {t(`landing.sections.${key}.body`, fb.body)}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ── Pricing ────────────────────────────────────────────────────
function PricingCard({ plan, highlight }: { plan: Plan; highlight?: boolean }) {
  const meta = PLAN_METADATA[plan]
  const { t } = useI18n()

  const isWedding = plan === 'wedding'
  return (
    <div
      className={`relative rounded-2xl p-6 transition ${
        highlight
          ? 'bg-[#241519] border-2 border-[#8F1D2C]'
          : isWedding
          ? 'bg-gradient-to-br from-[#241519] via-[#1E1417] to-[#1A0F12] border-2 border-[#E8B7C8]/40'
          : 'bg-[#1E1417] border border-[#3A2428]'
      }`}
    >
      {highlight && (
        <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#8F1D2C] text-white rounded-full px-3 py-1">
          {t('landing.pricing.mostChosen')}
        </span>
      )}
      {isWedding && (
        <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#E8B7C8] text-[#3A1019] rounded-full px-3 py-1">
          {t('landing.pricing.premium')}
        </span>
      )}
      <p className="text-xs uppercase tracking-wider text-[#E8B7C8] mb-1">{meta.tagline}</p>
      <h3 className="text-2xl font-bold text-[#F7F4F3]">{meta.name}</h3>
      <div className="my-4 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-[#F7F4F3]">
          {meta.priceMonthly === 0 ? t('landing.pricing.free') : `€${meta.priceMonthly.toFixed(2)}`}
        </span>
        {meta.priceMonthly > 0 && <span className="text-[#A89A98] text-sm">{t('landing.pricing.perMonth')}</span>}
      </div>
      <ul className="space-y-2 mb-6">
        {meta.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-[#F7F4F3]">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[#E8B7C8]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link href="/register" className="block">
        <Button
          className={
            highlight || isWedding
              ? 'w-full !bg-[#8F1D2C] hover:!bg-[#A82335] !text-white !border-0'
              : 'w-full !bg-transparent hover:!bg-[#241519] !text-[#E8B7C8] !border !border-[#8F1D2C]/50'
          }
        >
          {plan === 'free' ? t('landing.pricing.startFree') : `${t('landing.pricing.upgradeTo')} ${meta.name}`}
        </Button>
      </Link>
    </div>
  )
}

function Pricing() {
  const { t } = useI18n()
  return (
    <section id="pricing" className="py-20 sm:py-28 bg-[#170F11] border-t border-[#2B1B1F]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#F7F4F3] mb-4">{t('landing.pricing.title')}</h2>
          <p className="text-[#A89A98]">{t('landing.pricing.subtitle')}</p>
        </div>

        {/* Piani mensili */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
          <PricingCard plan="free" />
          <PricingCard plan="pro" highlight />
          <PricingCard plan="wedding" />
        </div>

        {/* Wedding Pass 24H */}
        <div className="mt-16">
          <div className="text-center mb-8">
            <h3 className="text-2xl sm:text-3xl font-bold text-[#F7F4F3] mb-3">{t('landing.pricing.or24h')}</h3>
            <p className="text-[#A89A98]">{t('landing.pricing.or24hDesc')}</p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-2xl p-8 bg-gradient-to-br from-[#241519] via-[#1E1417] to-[#1A0F12] border-2 border-[#E8B7C8]/40">
              <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#8F1D2C] text-white rounded-full px-3 py-1">
                {t('landing.pricing.tempAccess')}
              </span>

              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <p className="text-xs uppercase tracking-wider text-[#E8B7C8] mb-2">{t('landing.pricing.trial24h')}</p>
                  <h3 className="text-3xl font-bold text-[#F7F4F3] mb-3">{t('landing.pricing.eventPass')}</h3>
                  <div className="flex items-baseline gap-2 mb-6">
                    <span className="text-5xl font-bold text-[#F7F4F3]">€7,99</span>
                    <span className="text-[#A89A98] text-sm">{t('landing.pricing.oneTime')}</span>
                  </div>
                  <p className="text-sm text-[#A89A98] mb-6">
                    {t('landing.pricing.eventPassDesc')}
                  </p>
                  <Link href="/register" className="block">
                    <Button className="w-full !bg-[#8F1D2C] hover:!bg-[#A82335] !text-white !border-0">
                      {t('landing.pricing.buyPass')}
                    </Button>
                  </Link>
                </div>

                <div className="bg-[#1E1417] rounded-xl p-6 border border-[#3A2428]">
                  <p className="text-xs uppercase tracking-wider text-[#E8B7C8] mb-4 font-semibold">{t('landing.pricing.includes')}</p>
                  <ul className="space-y-3">
                    {(['f1','f2','f3','f4','f5','f6'] as const).map((k) => (
                      <li key={k} className="flex items-start gap-2 text-sm text-[#F7F4F3]">
                        <CheckCircle2 className="h-4 w-4 text-[#E8B7C8] mt-0.5 shrink-0" />
                        <span>{t(`landing.pricing.${k}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Footer ─────────────────────────────────────────────────────
function Footer() {
  const { t } = useI18n()
  return (
    <footer className="border-t border-[#2B1B1F] py-10 bg-[#0F0A0C]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#A89A98]">
        <p>© {new Date().getFullYear()} IOMIXO Live Hub</p>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-[#F7F4F3]">{t('landing.footer.privacy')}</Link>
          <Link href="/terms"   className="hover:text-[#F7F4F3]">{t('landing.footer.terms')}</Link>
        </div>
      </div>
    </footer>
  )
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0F0A0C] text-[#F7F4F3]">
      <TopNav />
      <Hero />
      <Capabilities />
      <Sections />
      <Pricing />
      <Footer />
    </main>
  )
}
