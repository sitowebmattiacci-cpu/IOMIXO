'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  QrCode, Heart, Camera, Monitor, Images, Radio,
  CheckCircle2, ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { PLAN_METADATA, type Plan } from '@/types'
import { Logo } from '@/components/Logo'
import { useI18n } from '@/lib/i18n'

// ── Brand tokens (wedding light palette) ────────────────────────
// primary:        #8F1D2C
// primary-deep:   #741625
// rose:           #E8B7C8
// rose-light:    #FBEAF0
// ivory:          #FFFDFB
// card:           #F7F4F3
// ink:            #2B2424
// muted:          #6F6260
// taupe-light:    #E8DED6

// ── Top navigation ─────────────────────────────────────────────
function TopNav() {
  const { t } = useI18n()
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[#FFFDFB]/80 border-b border-[#E8DED6]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={32} />
          <div className="leading-tight">
            <p className="text-sm font-bold text-[#2B2424]">IOMIXO</p>
            <p className="text-[10px] text-[#8F1D2C] font-medium -mt-0.5">Live Hub</p>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-[#6F6260]">
          <a href="#features" className="hover:text-[#2B2424]">{t('landing.nav.features')}</a>
          <a href="#pricing"  className="hover:text-[#2B2424]">{t('landing.nav.pricing')}</a>
          <Link href="/login" className="hover:text-[#2B2424]">{t('landing.nav.login')}</Link>
          <Link href="/register">
            <Button size="sm" className="!bg-[#8F1D2C] hover:!bg-[#741625] !text-white !border-0">{t('landing.nav.cta')}</Button>
          </Link>
          <LanguageSwitcher />
        </nav>
        <Link href="/register" className="md:hidden">
          <Button size="sm" className="!bg-[#8F1D2C] hover:!bg-[#741625] !text-white !border-0">{t('landing.nav.ctaShort')}</Button>
        </Link>
      </div>
    </header>
  )
}

// ── Hero ───────────────────────────────────────────────────────
function Hero() {
  const { t } = useI18n()
  return (
    <section className="relative overflow-hidden pt-20 pb-24 sm:pt-28 sm:pb-32">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#FBEAF0] via-[#FFFDFB] to-[#FFFDFB]" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-[#E8B7C8]/30 blur-3xl -z-10" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-[#E8B7C8] bg-white px-3 py-1 text-xs text-[#8F1D2C] mb-6 shadow-wedding"
        >
          <Radio className="h-3 w-3" />
          {t('landing.hero.badge')}
        </motion.div>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-[#2B2424] mb-6">
          IOMIXO <span className="text-[#8F1D2C]">Live Hub</span>
        </h1>
        <p className="text-base sm:text-lg text-[#2B2424] max-w-3xl mx-auto mb-4 font-medium">
          {t('landing.hero.tagline')}
        </p>
        <p className="text-base sm:text-lg text-[#6F6260] max-w-3xl mx-auto mb-4 leading-relaxed">
          {t('landing.hero.description', 'Crea una sessione live con QR Code, ricevi richieste musicali, attiva giochi, raccogli dediche e crea un’esperienza coinvolgente per il tuo pubblico.')}
        </p>
        <p className="text-sm sm:text-base italic text-[#8F1D2C] max-w-2xl mx-auto mb-10">
          “{t('landing.hero.claim')}”
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/register">
            <Button size="lg" className="w-full sm:w-auto !bg-[#8F1D2C] hover:!bg-[#741625] !text-white !border-0">
              {t('landing.hero.ctaPrimary')} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <a href="#features">
            <Button size="lg" variant="secondary" className="w-full sm:w-auto !bg-[#FBEAF0] hover:!bg-[#E8B7C8] !text-[#8F1D2C] !border !border-[#E8B7C8]">
              {t('landing.hero.ctaSecondary')}
            </Button>
          </a>
        </div>
        <p className="mt-6 text-xs text-[#6F6260]/80 max-w-3xl mx-auto">
          {t('landing.hero.audiences')}
        </p>
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
    <section id="features" className="py-20 sm:py-28 bg-[#FFFDFB]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#2B2424] mb-4">
            {t('landing.features.title', 'Tutto quello che serve per la tua serata')}
          </h2>
          <p className="text-[#6F6260] max-w-2xl mx-auto">
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
                className="rounded-2xl p-6 bg-[#F7F4F3] border border-[#E8B7C8]/60 hover:border-[#E8B7C8] transition shadow-wedding hover:shadow-wedding-lg"
              >
                <div className="h-11 w-11 rounded-xl bg-[#FBEAF0] flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-[#8F1D2C]" />
                </div>
                <h3 className="text-base font-semibold text-[#2B2424] mb-2">
                  {t(`landing.sections.${key}.title`, fb.title)}
                </h3>
                <p className="text-sm text-[#6F6260] leading-relaxed">
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
      className={`relative rounded-2xl p-6 transition shadow-wedding hover:shadow-wedding-lg ${
        highlight
          ? 'bg-white border-2 border-[#8F1D2C]'
          : isWedding
          ? 'bg-gradient-to-b from-[#FBEAF0] to-white border-2 border-[#E8B7C8]'
          : 'bg-[#F7F4F3] border border-[#E8DED6]'
      }`}
    >
      {highlight && (
        <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#8F1D2C] text-white rounded-full px-3 py-1">
          {t('landing.pricing.mostChosen')}
        </span>
      )}
      {isWedding && (
        <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#E8B7C8] text-[#741625] rounded-full px-3 py-1">
          {t('landing.pricing.premium')}
        </span>
      )}
      <p className="text-xs uppercase tracking-wider text-[#8F1D2C] mb-1">{meta.tagline}</p>
      <h3 className="text-2xl font-bold text-[#2B2424]">{meta.name}</h3>
      <div className="my-4 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-[#2B2424]">
          {meta.priceMonthly === 0 ? t('landing.pricing.free') : `€${meta.priceMonthly.toFixed(2)}`}
        </span>
        {meta.priceMonthly > 0 && <span className="text-[#6F6260] text-sm">{t('landing.pricing.perMonth')}</span>}
      </div>
      <ul className="space-y-2 mb-6">
        {meta.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-[#2B2424]">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[#8F1D2C]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link href="/register" className="block">
        <Button
          className={
            highlight || isWedding
              ? 'w-full !bg-[#8F1D2C] hover:!bg-[#741625] !text-white !border-0'
              : 'w-full !bg-[#FBEAF0] hover:!bg-[#E8B7C8] !text-[#8F1D2C] !border !border-[#E8B7C8]'
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
    <section id="pricing" className="py-20 sm:py-28 bg-[#FBEAF0]/40 border-t border-[#E8DED6]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#2B2424] mb-4">{t('landing.pricing.title')}</h2>
          <p className="text-[#6F6260]">{t('landing.pricing.subtitle')}</p>
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
            <h3 className="text-2xl sm:text-3xl font-bold text-[#2B2424] mb-3">{t('landing.pricing.or24h')}</h3>
            <p className="text-[#6F6260]">{t('landing.pricing.or24hDesc')}</p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-2xl p-8 bg-white border-2 border-[#E8B7C8] shadow-wedding-lg">
              <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-[#8F1D2C] text-white rounded-full px-3 py-1">
                {t('landing.pricing.tempAccess')}
              </span>

              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <p className="text-xs uppercase tracking-wider text-[#8F1D2C] mb-2">{t('landing.pricing.trial24h')}</p>
                  <h3 className="text-3xl font-bold text-[#2B2424] mb-3">{t('landing.pricing.weddingPass')}</h3>
                  <div className="flex items-baseline gap-2 mb-6">
                    <span className="text-5xl font-bold text-[#2B2424]">€7,99</span>
                    <span className="text-[#6F6260] text-sm">{t('landing.pricing.oneTime')}</span>
                  </div>
                  <p className="text-sm text-[#6F6260] mb-6">
                    {t('landing.pricing.weddingPassDesc')}
                  </p>
                  <Link href="/register" className="block">
                    <Button className="w-full !bg-[#8F1D2C] hover:!bg-[#741625] !text-white !border-0">
                      {t('landing.pricing.buyPass')}
                    </Button>
                  </Link>
                </div>

                <div className="bg-[#F7F4F3] rounded-xl p-6 border border-[#E8B7C8]/60">
                  <p className="text-xs uppercase tracking-wider text-[#8F1D2C] mb-4 font-semibold">{t('landing.pricing.includes')}</p>
                  <ul className="space-y-3">
                    {(['f1','f2','f3','f4','f5','f6'] as const).map((k) => (
                      <li key={k} className="flex items-start gap-2 text-sm text-[#2B2424]">
                        <CheckCircle2 className="h-4 w-4 text-[#8F1D2C] mt-0.5 shrink-0" />
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
    <footer className="border-t border-[#E8DED6] py-10 bg-[#FFFDFB]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#6F6260]">
        <p>© {new Date().getFullYear()} IOMIXO Live Hub</p>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-[#2B2424]">{t('landing.footer.privacy')}</Link>
          <Link href="/terms"   className="hover:text-[#2B2424]">{t('landing.footer.terms')}</Link>
        </div>
      </div>
    </footer>
  )
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#FFFDFB] text-[#2B2424]">
      <TopNav />
      <Hero />
      <Sections />
      <Pricing />
      <Footer />
    </main>
  )
}
