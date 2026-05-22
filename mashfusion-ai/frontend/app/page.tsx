'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  QrCode, MessageSquare, ListChecks, Share2, CalendarDays,
  CheckCircle2, ArrowRight, Music2, Radio,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { PLAN_METADATA, type Plan } from '@/types'
import { Logo } from '@/components/Logo'

// ── Top navigation ─────────────────────────────────────────────
function TopNav() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-black/40 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={32} />
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">IOMIXO</p>
            <p className="text-[10px] text-purple-400 font-medium -mt-0.5">Live Hub</p>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-white/70">
          <a href="#features" className="hover:text-white">Funzioni</a>
          <a href="#pricing"  className="hover:text-white">Piani</a>
          <Link href="/login" className="hover:text-white">Accedi</Link>
          <Link href="/register">
            <Button size="sm">Crea il tuo Live Hub</Button>
          </Link>
          <LanguageSwitcher />
        </nav>
        <Link href="/register" className="md:hidden">
          <Button size="sm">Inizia</Button>
        </Link>
      </div>
    </header>
  )
}

// ── Hero ───────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative overflow-hidden pt-20 pb-24 sm:pt-28 sm:pb-32">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-purple-950/40 via-black to-black" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-purple-600/10 blur-3xl -z-10" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-200 mb-6"
        >
          <Radio className="h-3 w-3" />
          Il Live Hub interattivo per DJ
        </motion.div>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white mb-6">
          IOMIXO <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Live Hub</span>
        </h1>
        <p className="text-base sm:text-lg text-purple-200/90 max-w-3xl mx-auto mb-4 font-medium">
          La regia interattiva per DJ, eventi e matrimoni.
        </p>
        <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-3">
          Il DJ comanda. Il pubblico interagisce.
        </p>
        <p className="text-sm sm:text-base text-white/50 max-w-3xl mx-auto mb-10">
          Cene spettacolo · Feste private · Compleanni · Matrimoni · Eventi aziendali · Club · Locali
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/register">
            <Button size="lg" className="w-full sm:w-auto">
              Crea il tuo Live Hub <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <a href="#pricing">
            <Button size="lg" variant="secondary" className="w-full sm:w-auto">
              Scopri i piani
            </Button>
          </a>
        </div>
      </div>
    </section>
  )
}

// ── Features ───────────────────────────────────────────────────
const FEATURES = [
  {
    icon: QrCode,
    title: 'Mostra il QR Code in console',
    body:  'Il pubblico scansiona il QR e accede alla tua pagina live.',
  },
  {
    icon: MessageSquare,
    title: 'Ricevi richieste senza essere interrotto',
    body:  'Niente più persone che ti parlano all’orecchio mentre mixi. Le richieste arrivano ordinate nella tua dashboard.',
  },
  {
    icon: ListChecks,
    title: 'Decidi tu cosa suonare',
    body:  'Approva, rifiuta o ignora ogni richiesta. Il controllo resta sempre al DJ.',
  },
  {
    icon: Share2,
    title: 'Promuovi i tuoi social',
    body:  'Aggiungi Instagram, TikTok, Spotify, SoundCloud e i tuoi link principali.',
  },
  {
    icon: CalendarDays,
    title: 'Mostra le prossime date',
    body:  'Trasforma ogni serata in un’occasione per farti seguire e portare pubblico ai prossimi eventi.',
  },
  {
    icon: Music2,
    title: 'Perfetto per DJ, club, matrimoni ed eventi privati',
    body:  'Una piattaforma pensata per chi vive la musica live: dal mobile DJ al locale, dal wedding all’agenzia eventi.',
  },
]

function Features() {
  return (
    <section id="features" className="py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Tutto quello che serve per gestire la serata
          </h2>
          <p className="text-white/60 max-w-2xl mx-auto">
            IOMIXO Live Hub è il ponte tra te e il tuo pubblico — senza distrarti dal mix.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="glass rounded-2xl p-6">
              <div className="h-10 w-10 rounded-xl bg-purple-500/15 flex items-center justify-center mb-4">
                <Icon className="h-5 w-5 text-purple-300" />
              </div>
              <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Pricing ────────────────────────────────────────────────────
function PricingCard({ plan, highlight }: { plan: Plan; highlight?: boolean }) {
  const meta = PLAN_METADATA[plan]

  return (
    <div
      className={`relative rounded-2xl p-6 ${
        highlight
          ? 'bg-gradient-to-b from-purple-500/15 to-purple-500/5 border border-purple-400/40'
          : plan === 'wedding'
          ? 'bg-gradient-to-b from-pink-500/15 to-rose-500/5 border border-pink-400/40'
          : 'glass'
      }`}
    >
      {highlight && (
        <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-purple-500 text-white rounded-full px-3 py-1">
          Più scelto
        </span>
      )}
      {plan === 'wedding' && (
        <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-full px-3 py-1">
          ✦ Premium
        </span>
      )}
      <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">{meta.tagline}</p>
      <h3 className="text-2xl font-bold text-white">{meta.name}</h3>
      <div className="my-4 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-white">
          {meta.priceMonthly === 0 ? 'Gratis' : `€${meta.priceMonthly.toFixed(2)}`}
        </span>
        {meta.priceMonthly > 0 && <span className="text-white/40 text-sm">/mese</span>}
      </div>
      <ul className="space-y-2 mb-6">
        {meta.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-white/70">
            <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${plan === 'wedding' ? 'text-pink-400' : 'text-purple-400'}`} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link href="/register" className="block">
        <Button
          variant={highlight || plan === 'wedding' ? 'primary' : 'secondary'}
          className={plan === 'wedding' ? 'w-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600' : 'w-full'}
        >
          {plan === 'free' ? 'Inizia gratis' : `Passa a ${meta.name}`}
        </Button>
      </Link>
    </div>
  )
}

function Pricing() {
  return (
    <section id="pricing" className="py-20 sm:py-28 border-t border-white/5">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Piani semplici, per ogni serata</h2>
          <p className="text-white/60">Scegli il piano che meglio si adatta al tuo modo di lavorare.</p>
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
            <h3 className="text-2xl sm:text-3xl font-bold text-white mb-3">Oppure prova per 24 ore</h3>
            <p className="text-white/60">Hai un evento singolo? Acquista l'accesso temporaneo senza abbonamento.</p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-2xl p-8 bg-gradient-to-br from-pink-600/20 to-rose-600/10 border-2 border-pink-500/40">
              <span className="absolute -top-3 right-6 text-[11px] font-semibold bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-full px-3 py-1">
                ⏱️ Accesso temporaneo
              </span>

              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <p className="text-xs uppercase tracking-wider text-pink-300 mb-2">Prova completa 24h</p>
                  <h3 className="text-3xl font-bold text-white mb-3">Wedding Pass</h3>
                  <div className="flex items-baseline gap-2 mb-6">
                    <span className="text-5xl font-bold text-white">€7,99</span>
                    <span className="text-white/40 text-sm">una tantum</span>
                  </div>
                  <p className="text-sm text-white/70 mb-6">
                    Accesso completo a tutte le funzioni Wedding Edition per 24 ore dal pagamento.
                    Perfetto per matrimoni, eventi singoli o per provare prima di abbonarti.
                  </p>
                  <Link href="/register" className="block">
                    <Button className="w-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600">
                      Acquista Wedding Pass 24H
                    </Button>
                  </Link>
                </div>

                <div className="bg-black/30 rounded-xl p-6 border border-pink-500/30">
                  <p className="text-xs uppercase tracking-wider text-pink-300 mb-4 font-semibold">Include</p>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-pink-400 mt-0.5 shrink-0" />
                      <span>Dediche romantiche live</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-pink-400 mt-0.5 shrink-0" />
                      <span>Roulette penitenze</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-pink-400 mt-0.5 shrink-0" />
                      <span>Gioco della scarpa</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-pink-400 mt-0.5 shrink-0" />
                      <span>Album foto ospiti con votazione</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-pink-400 mt-0.5 shrink-0" />
                      <span>Screen mode per videoproiettore</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-pink-400 mt-0.5 shrink-0" />
                      <span>Sondaggi interattivi</span>
                    </li>
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
  return (
    <footer className="border-t border-white/5 py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/40">
        <p>© {new Date().getFullYear()} IOMIXO Live Hub</p>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-white/70">Privacy</Link>
          <Link href="/terms"   className="hover:text-white/70">Termini</Link>
        </div>
      </div>
    </footer>
  )
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <TopNav />
      <Hero />
      <Features />
      <Pricing />
      <Footer />
    </main>
  )
}
