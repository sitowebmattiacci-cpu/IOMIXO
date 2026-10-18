'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  QrCode, Heart, Monitor, Radio, Mic2, Smartphone,
  CheckCircle2, ArrowRight, PartyPopper, Music2, Gamepad2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { PLAN_METADATA, type Plan } from '@/types'
import { Logo } from '@/components/Logo'
import { useI18n } from '@/lib/i18n'
import {
  currencyForLocale, formatPrice, PLAN_PRICING, EVENT_PASS_PRICING,
  type PaidPlan,
} from '@/lib/pricing'

// ── IOMIXO Party palette (dark · pink + neon yellow accents) ────
// bg #0A0A0D · alt bg #0F0F14 · surface #15151B · surface-2 #1C1C23 · border #2A2A33
// pink #FF2D8D (hover #E9207C) · soft pink #FF9BC8 · neon yellow #F4FF3A · text #F8F8FA · muted #9A9AA3

// ── Top navigation ─────────────────────────────────────────────
function TopNav() {
  const { t } = useI18n()
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0A0A0D]/90 border-b border-[#2A2A33]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo variant="party" size={32} />
          <div className="leading-tight">
            <p className="text-sm font-bold text-[#F8F8FA]">IOMIXO</p>
            <p className="text-[10px] text-[#F4FF3A] font-semibold -mt-0.5">Live Hub</p>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-[#9A9AA3]">
          <a href="#features" className="hover:text-[#F8F8FA]">{t('landing.nav.features')}</a>
          <a href="#pricing"  className="hover:text-[#F8F8FA]">{t('landing.nav.pricing')}</a>
          <Link href="/login" className="hover:text-[#F8F8FA]">{t('landing.nav.login')}</Link>
          <Link href="/register">
            <Button size="sm" className="!bg-[#FF2D8D] hover:!bg-[#E9207C] !text-white !border-0">{t('landing.nav.cta')}</Button>
          </Link>
          <LanguageSwitcher />
        </nav>
        <Link href="/register" className="md:hidden">
          <Button size="sm" className="!bg-[#FF2D8D] hover:!bg-[#E9207C] !text-white !border-0">{t('landing.nav.ctaShort')}</Button>
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
      {/* Near-black background with subtle pink / neon-yellow glows */}
      <div className="absolute inset-0 -z-10 bg-[#0A0A0D]" />
      <div className="absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full bg-[#FF2D8D]/10 blur-3xl -z-10" />
      <div className="absolute top-24 -right-24 w-[460px] h-[460px] rounded-full bg-[#F4FF3A]/[0.05] blur-3xl -z-10" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Compact heading block */}
        <div className="text-center max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 rounded-full border border-[#FF2D8D]/40 bg-[#15151B] px-3 py-1 text-xs text-[#F8F8FA] mb-5"
          >
            <Radio className="h-3 w-3 text-[#F4FF3A]" />
            {t('landing.hero.badge', 'DJ · Karaoke · Wedding entertainment')}
          </motion.div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#F8F8FA] mb-4">
            IOMIXO <span className="text-gradient">Live Hub</span>
          </h1>
          <p className="text-lg sm:text-xl text-[#F8F8FA] max-w-2xl mx-auto mb-3 font-medium">
            {t('landing.hero.tagline', 'La piattaforma interattiva per DJ, serate karaoke e matrimoni.')}
          </p>
          <p className="text-sm sm:text-base text-[#9A9AA3] max-w-2xl mx-auto mb-6">
            {t('landing.hero.subline', 'Gli ospiti partecipano dal telefono via QR: richieste musicali, karaoke, giochi, dediche e Screen Mode in tempo reale.')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto !bg-[#FF2D8D] hover:!bg-[#E9207C] !text-white !border-0">
                {t('landing.hero.ctaPrimary', 'Inizia gratis')} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <a href="#modes">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto !bg-[#15151B] hover:!bg-[#1C1C23] !text-[#F8F8FA] !border !border-[#2A2A33] hover:!border-[#FF2D8D]/60">
                {t('landing.hero.ctaSecondary', 'Scopri le modalità')}
              </Button>
            </a>
          </div>
        </div>

        {/* Mode cards — Party & Karaoke, Wedding DJ (above the fold) */}
        <div id="modes" className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 max-w-5xl mx-auto">
          {/* PARTY MODE */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="relative rounded-2xl p-6 sm:p-7 bg-[#15151B] border border-[#2A2A33] hover:border-[#FF2D8D]/70 transition group overflow-hidden"
          >
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[#FF2D8D]/15 blur-2xl" />
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-xl bg-[#FF2D8D] text-white flex items-center justify-center">
                <PartyPopper className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#F4FF3A] font-semibold">{t('landing.modes.party.label', 'Modalità')}</p>
                <h3 className="text-xl font-bold text-[#F8F8FA]">Party &amp; Karaoke</h3>
              </div>
            </div>
            <p className="text-sm text-[#9A9AA3] mb-4">
              {t('landing.modes.party.for', 'Per serate DJ, karaoke, compleanni, feste private, locali ed eventi aziendali.')}
            </p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-[#F8F8FA] mb-5">
              {[
                t('landing.modes.party.f1', 'Richieste live'),
                t('landing.modes.party.f2', 'Karaoke'),
                t('landing.modes.party.f3', 'Giochi e Music Battle'),
                t('landing.modes.party.f4', 'Screen Mode'),
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#F4FF3A] shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/register?mode=party">
              <Button className="w-full !bg-[#FF2D8D] hover:!bg-[#E9207C] !text-white !border-0">
                {t('landing.modes.party.cta', 'Avvia un Party')} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </motion.div>

          {/* WEDDING DJ */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="relative rounded-2xl p-6 sm:p-7 bg-gradient-to-br from-[#1C1C23] to-[#15151B] border border-[#FF9BC8]/30 hover:border-[#FF9BC8]/60 transition group overflow-hidden"
          >
            <span className="absolute top-4 right-4 text-[10px] font-semibold bg-[#FF9BC8] text-[#0A0A0D] rounded-full px-2.5 py-0.5">
              {t('landing.modes.wedding.premium', 'Premium')}
            </span>
            <div className="absolute -bottom-12 -left-10 w-44 h-44 rounded-full bg-[#FF9BC8]/10 blur-2xl" />
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-xl bg-[#15151B] border border-[#FF9BC8]/40 text-[#FF9BC8] flex items-center justify-center">
                <Heart className="h-6 w-6 fill-[#FF9BC8]" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#FF9BC8] font-semibold">{t('landing.modes.wedding.label', 'Modalità')}</p>
                <h3 className="text-xl font-bold text-[#F8F8FA]">Wedding DJ</h3>
              </div>
            </div>
            <p className="text-sm text-[#9A9AA3] mb-4">
              {t('landing.modes.wedding.for', 'Per DJ di matrimoni: musica, giochi e intrattenimento per il ricevimento.')}
            </p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-[#F8F8FA] mb-5">
              {[
                t('landing.modes.wedding.f1', 'Dediche agli sposi'),
                t('landing.modes.wedding.f2', 'Giochi wedding'),
                t('landing.modes.wedding.f3', 'Sondaggi live'),
                t('landing.modes.wedding.f4', 'Regia dal telefono'),
                t('landing.modes.wedding.f5', 'Screen Mode'),
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#FF9BC8] shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/register?mode=wedding">
              <Button className="w-full !bg-[#FF2D8D] hover:!bg-[#E9207C] !text-white !border-0">
                {t('landing.modes.wedding.cta', 'Avvia il Matrimonio')} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
        </div>

        {/* Trust line */}
        <p className="mt-8 text-center text-xs text-[#9A9AA3] flex items-center justify-center gap-2">
          <QrCode className="h-3.5 w-3.5 text-[#F4FF3A]" />
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
    { Icon: Mic2,      title: t('landing.caps.karaoke.title',  'Karaoke'),            body: t('landing.caps.karaoke.body',  'Gli ospiti scelgono dal telefono il brano da cantare e tu gestisci la scaletta dalla dashboard.') },
    { Icon: Gamepad2,  title: t('landing.caps.games.title',    'Giochi Interattivi'), body: t('landing.caps.games.body',    'Roulette, quiz e giochi wedding per coinvolgere tutta la sala.') },
    { Icon: Monitor,   title: t('landing.caps.screen.title',   'Screen Mode'),        body: t('landing.caps.screen.body',   'QR, dediche, giochi e sondaggi proiettati su TV o maxi-schermo.') },
  ]
  return (
    <section className="py-14 sm:py-20 bg-[#0F0F14] border-y border-[#2A2A33]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#15151B] border border-[#2A2A33] px-3 py-1 text-xs text-[#F8F8FA] mb-4">
            <Sparkles className="h-3 w-3 text-[#F4FF3A]" />
            {t('landing.caps.badge', 'Tutto in una sola piattaforma')}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#F8F8FA]">
            {t('landing.caps.title', 'Quattro strumenti per far ballare, cantare e giocare la sala')}
          </h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {items.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl p-5 sm:p-6 bg-[#15151B] border border-[#2A2A33] hover:border-[#FF2D8D]/70 transition text-center"
            >
              <div className="h-14 w-14 mx-auto rounded-2xl bg-[#FF2D8D]/10 border border-[#FF2D8D]/30 flex items-center justify-center mb-4">
                <Icon className="h-7 w-7 text-[#FF2D8D]" />
              </div>
              <h3 className="text-base font-semibold text-[#F8F8FA] mb-1.5">{title}</h3>
              <p className="text-xs sm:text-sm text-[#9A9AA3] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Feature sections: DJ, karaoke and wedding entertainment (no photo features: those are MIOLOVE ALBUM) ──
type SectionKey = 'requests' | 'karaoke' | 'wedding' | 'screen' | 'remote'
const SECTION_ICONS: Record<SectionKey, typeof QrCode> = {
  requests: QrCode,
  karaoke:  Mic2,
  wedding:  Heart,
  screen:   Monitor,
  remote:   Smartphone,
}
const SECTION_FALLBACK: Record<SectionKey, { title: string; body: string }> = {
  requests: { title: 'Richieste musicali senza interruzioni', body: 'Gli ospiti inviano le richieste dal telefono. Il DJ approva, rifiuta o gestisce tutto dalla dashboard.' },
  wedding:  { title: 'Esperienze interattive per matrimoni',  body: 'Dediche agli sposi, giochi live, roulette wedding, gioco della scarpa e momenti speciali guidati dal DJ.' },
  karaoke:  { title: 'Serate karaoke senza caos',             body: 'Niente fogli e penne: il pubblico prenota il brano dal telefono e tu decidi l\'ordine dalla regia.' },
  screen:   { title: 'Tutto anche su schermo',                body: 'Mostra QR Code, dediche, risultati dei giochi e sondaggi su TV o proiettore.' },
  remote:   { title: 'Regia dal telefono',                    body: 'Gestisci richieste, dediche, giochi e schermo dal telefono mentre sei in consolle.' },
}

function Sections() {
  const { t } = useI18n()
  const keys: SectionKey[] = ['requests', 'karaoke', 'wedding', 'screen', 'remote']
  return (
    <section id="features" className="py-20 sm:py-28 bg-[#0A0A0D]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#F8F8FA] mb-4">
            {t('landing.features.title', 'Tutto quello che serve per la tua serata')}
          </h2>
          <p className="text-[#9A9AA3] max-w-2xl mx-auto">
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
                className="rounded-2xl p-6 bg-[#15151B] border border-[#2A2A33] hover:border-[#FF2D8D]/70 transition"
              >
                <div className={`h-11 w-11 rounded-xl border flex items-center justify-center mb-4 ${key === 'screen' || key === 'remote' ? 'bg-[#F4FF3A]/10 border-[#F4FF3A]/30' : 'bg-[#FF2D8D]/10 border-[#FF2D8D]/30'}`}>
                  <Icon className={`h-5 w-5 ${key === 'screen' || key === 'remote' ? 'text-[#F4FF3A]' : 'text-[#FF2D8D]'}`} />
                </div>
                <h3 className="text-base font-semibold text-[#F8F8FA] mb-2">
                  {t(`landing.sections.${key}.title`, fb.title)}
                </h3>
                <p className="text-sm text-[#9A9AA3] leading-relaxed">
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
  const { t, locale } = useI18n()
  const currency = currencyForLocale(locale)
  const amount = plan === 'free' ? 0 : PLAN_PRICING[plan as PaidPlan][currency]

  const isWedding = plan === 'wedding'
  return (
    <div
      className={`relative rounded-2xl p-6 transition ${
        highlight
          ? 'bg-[#1C1C23] border-2 border-[#FF2D8D]'
          : isWedding
          ? 'bg-[#15151B] border-2 border-[#F4FF3A]/60'
          : 'bg-[#15151B] border border-[#2A2A33]'
      }`}
    >
      {highlight && (
        <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#FF2D8D] text-white rounded-full px-3 py-1">
          {t('landing.pricing.mostChosen')}
        </span>
      )}
      {isWedding && (
        <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#F4FF3A] text-[#0A0A0D] rounded-full px-3 py-1">
          {t('landing.pricing.premium')}
        </span>
      )}
      <p className="text-xs uppercase tracking-wider text-[#FF2D8D] mb-1">{t(`landing.plans.${plan}.tagline`, meta.tagline)}</p>
      <h3 className="text-2xl font-bold text-[#F8F8FA]">{meta.name}</h3>
      <div className="my-4 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-[#F8F8FA]">
          {amount === 0 ? t('landing.pricing.free') : formatPrice(amount, currency)}
        </span>
        {amount > 0 && <span className="text-[#9A9AA3] text-sm">{t('landing.pricing.perMonth')}</span>}
      </div>
      <ul className="space-y-2 mb-6">
        {meta.features.map((fallback, i) => {
          const f = t(`landing.plans.${plan}.f${i + 1}`, fallback)
          return (
            <li key={i} className="flex items-start gap-2 text-sm text-[#F8F8FA]">
              <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${isWedding ? 'text-[#F4FF3A]' : 'text-[#FF2D8D]'}`} />
              <span>{f}</span>
            </li>
          )
        })}
      </ul>
      <Link href="/register" className="block">
        <Button
          className={
            highlight || isWedding
              ? 'w-full !bg-[#FF2D8D] hover:!bg-[#E9207C] !text-white !border-0'
              : 'w-full !bg-[#15151B] hover:!bg-[#1C1C23] !text-[#F8F8FA] !border !border-[#2A2A33] hover:!border-[#FF2D8D]/60'
          }
        >
          {plan === 'free' ? t('landing.pricing.startFree') : `${t('landing.pricing.upgradeTo')} ${meta.name}`}
        </Button>
      </Link>
    </div>
  )
}

function Pricing() {
  const { t, locale } = useI18n()
  const currency = currencyForLocale(locale)
  return (
    <section id="pricing" className="py-20 sm:py-28 bg-[#0F0F14] border-t border-[#2A2A33]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#F8F8FA] mb-4">{t('landing.pricing.title')}</h2>
          <p className="text-[#9A9AA3]">{t('landing.pricing.subtitle')}</p>
        </div>

        {/* Piani mensili */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
          <PricingCard plan="free" />
          <PricingCard plan="pro" highlight />
          <PricingCard plan="wedding" />
        </div>

        {/* Event Pass 24H */}
        <div className="mt-16">
          <div className="text-center mb-8">
            <h3 className="text-2xl sm:text-3xl font-bold text-[#F8F8FA] mb-3">{t('landing.pricing.or24h')}</h3>
            <p className="text-[#9A9AA3]">{t('landing.pricing.or24hDesc')}</p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-2xl p-8 bg-[#15151B] border-2 border-[#F4FF3A]/40">
              <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#F4FF3A] text-[#0A0A0D] rounded-full px-3 py-1">
                {t('landing.pricing.tempAccess')}
              </span>

              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <p className="text-xs uppercase tracking-wider text-[#FF2D8D] mb-2">{t('landing.pricing.trial24h')}</p>
                  <h3 className="text-3xl font-bold text-[#F8F8FA] mb-3">{t('landing.pricing.eventPass')}</h3>
                  <div className="flex items-baseline gap-2 mb-6">
                    <span className="text-5xl font-bold text-[#F8F8FA]">{formatPrice(EVENT_PASS_PRICING[currency], currency)}</span>
                    <span className="text-[#9A9AA3] text-sm">{t('landing.pricing.oneTime')}</span>
                  </div>
                  <p className="text-sm text-[#9A9AA3] mb-6">
                    {t('landing.pricing.eventPassDesc')}
                  </p>
                  <Link href="/register" className="block">
                    <Button className="w-full !bg-[#FF2D8D] hover:!bg-[#E9207C] !text-white !border-0">
                      {t('landing.pricing.buyPass')}
                    </Button>
                  </Link>
                </div>

                <div className="bg-[#1C1C23] rounded-xl p-6 border border-[#2A2A33]">
                  <p className="text-xs uppercase tracking-wider text-[#F4FF3A] mb-4 font-semibold">{t('landing.pricing.includes')}</p>
                  <ul className="space-y-3">
                    {(['f1','f2','f3','f4','f5','f6'] as const).map((k) => (
                      <li key={k} className="flex items-start gap-2 text-sm text-[#F8F8FA]">
                        <CheckCircle2 className="h-4 w-4 text-[#FF2D8D] mt-0.5 shrink-0" />
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
    <footer className="border-t border-[#2A2A33] py-10 bg-[#0A0A0D]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#9A9AA3]">
        <p>© {new Date().getFullYear()} IOMIXO Live Hub</p>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-[#F8F8FA]">{t('landing.footer.privacy')}</Link>
          <Link href="/terms"   className="hover:text-[#F8F8FA]">{t('landing.footer.terms')}</Link>
        </div>
      </div>
    </footer>
  )
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0A0A0D] text-[#F8F8FA]">
      <TopNav />
      <Hero />
      <Capabilities />
      <Sections />
      <Pricing />
      <Footer />
    </main>
  )
}
