'use client'
import Link from 'next/link'
import { motion, useScroll, useTransform } from 'framer-motion'
import { useRef } from 'react'
import {
  Sparkles, Music2, Wand2, ArrowRight, CheckCircle2,
  Activity, Zap, Layers, Globe, Play, Shuffle, Combine,
  SlidersHorizontal, ShieldCheck, Headphones, AudioWaveform,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PLAN_METADATA } from '@/types'

// ── Animated waveform decoration ─────────────────────────────
function WaveformDeco({ bars = 24, intensity = 1 }: { bars?: number; intensity?: number }) {
  return (
    <div className="flex items-end gap-0.5 h-12" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="waveform-bar"
          style={{
            height: `${(Math.random() * 70 + 20) * intensity}%`,
            animationDelay: `${i * 0.06}s`,
          }}
        />
      ))}
    </div>
  )
}

// ── Static, deterministic mini waveform (looks like a real track) ──
function MiniWaveform({ seed = 1, accent = 'purple' }: { seed?: number; accent?: 'purple' | 'pink' | 'gold' }) {
  // pseudo-random but deterministic so SSR matches client
  const heights = Array.from({ length: 56 }).map((_, i) => {
    const v = Math.sin(i * 0.6 + seed) * 0.5 + Math.cos(i * 0.21 + seed * 2) * 0.4
    return Math.max(12, Math.min(100, Math.abs(v) * 110 + 18))
  })
  const colorClass =
    accent === 'gold'   ? 'bg-gradient-to-t from-amber-400/80 via-amber-300/90 to-yellow-200'
  : accent === 'pink'   ? 'bg-gradient-to-t from-pink-500/70 via-pink-400/80 to-purple-300/90'
  :                       'bg-gradient-to-t from-purple-600/60 via-purple-400/70 to-purple-200/80'
  return (
    <div className="flex items-end justify-between gap-[2px] h-16 w-full">
      {heights.map((h, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full ${colorClass}`}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  )
}

// ── Audio source / output card (hero showcase) ─────────────────
function AudioShowcaseCard({
  label, title, accent, highlighted, badge,
}: {
  label: string
  title: string
  accent: 'purple' | 'pink' | 'gold'
  highlighted?: boolean
  badge?: string
}) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={`relative rounded-2xl p-5 flex flex-col gap-4 backdrop-blur-xl ${
        highlighted
          ? 'bg-gradient-to-br from-purple-600/25 via-purple-500/10 to-pink-500/15 border border-purple-400/40 shadow-neon-purple'
          : 'glass'
      }`}
    >
      {badge && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-gradient-brand px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            {badge}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{label}</span>
        <button
          aria-label="Play preview"
          className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
            highlighted
              ? 'bg-gradient-brand text-white shadow-neon-purple'
              : 'bg-white/5 text-white/70 hover:bg-white/10'
          }`}
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </button>
      </div>
      <p className="text-sm font-semibold text-white truncate">{title}</p>
      <MiniWaveform seed={accent === 'gold' ? 7 : accent === 'pink' ? 3 : 1} accent={accent} />
      <div className="flex items-center justify-between text-[10px] text-white/30 font-mono">
        <span>0:00</span>
        <span>{highlighted ? 'AI · 03:24' : '03:12'}</span>
      </div>
    </motion.div>
  )
}

// ── Output type card (glassmorphism) ───────────────────────────
function OutputTypeCard({
  icon, title, desc,
}: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: 'spring', stiffness: 240, damping: 20 }}
      className="group relative rounded-2xl p-6 overflow-hidden backdrop-blur-xl bg-white/[0.03] border border-white/10 hover:border-purple-400/40 transition-colors"
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-purple-600/10 via-transparent to-pink-500/10 pointer-events-none" />
      <div className="relative space-y-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/10 border border-purple-400/20 text-purple-300">
          {icon}
        </div>
        <h3 className="font-bold text-white text-lg tracking-tight">{title}</h3>
        <p className="text-sm text-white/50 leading-relaxed">{desc}</p>
      </div>
    </motion.div>
  )
}

// ── Feature (technology) card ──────────────────────────────────
function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="glass glass-hover rounded-2xl p-6 space-y-3"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300">
        {icon}
      </div>
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="text-sm text-white/50 leading-relaxed">{desc}</p>
    </motion.div>
  )
}

// ── Pricing card ─────────────────────────────────────────────
function PricingCard({
  plan, highlighted,
}: {
  plan: keyof typeof PLAN_METADATA
  highlighted?: boolean
}) {
  const meta = PLAN_METADATA[plan]
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className={`relative rounded-2xl p-6 flex flex-col gap-5 ${
        highlighted
          ? 'bg-gradient-to-b from-purple-600/20 to-pink-600/10 border border-purple-500/40 shadow-neon-purple'
          : 'glass'
      }`}
    >
      {highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-gradient-brand px-3 py-1 text-xs font-semibold text-white">
            Most Popular
          </span>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-white/60">{meta.name}</p>
        <p className="mt-1 text-4xl font-black text-white">
          {meta.priceMonthly === 0 ? 'Free' : `$${meta.priceMonthly}`}
          {meta.priceMonthly > 0 && <span className="text-sm font-normal text-white/30">/mo</span>}
        </p>
      </div>

      <ul className="space-y-2 flex-1">
        <li className="flex items-center gap-2 text-sm text-white/70">
          <CheckCircle2 className="h-4 w-4 text-purple-400 flex-shrink-0" />
          {meta.monthlyCredits} AI transformation{meta.monthlyCredits !== 1 ? 's' : ''} per month
        </li>
        {meta.quality.map((q) => (
          <li key={q} className="flex items-center gap-2 text-sm text-white/70">
            <CheckCircle2 className="h-4 w-4 text-purple-400 flex-shrink-0" />
            {q}
          </li>
        ))}
      </ul>

      <Link href="/register">
        <Button
          variant={highlighted ? 'primary' : 'secondary'}
          className="w-full"
        >
          Get started
        </Button>
      </Link>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const heroY   = useTransform(scrollYProgress, [0, 1], ['0%', '24%'])
  const heroOpa = useTransform(scrollYProgress, [0, 0.7], [1, 0])

  return (
    <div className="relative min-h-screen bg-surface-400 overflow-hidden">
      {/* ── Background orbs ─────────────────────────────────── */}
      <div className="pointer-events-none select-none" aria-hidden>
        <div className="bg-orb w-[800px] h-[800px] bg-purple-600 top-[-200px] left-[-200px]" />
        <div className="bg-orb w-[600px] h-[600px] bg-pink-600 top-[200px] right-[-150px]" />
        <div className="bg-orb w-[400px] h-[400px] bg-cyan-600 bottom-[0px] left-[30%]" />
        <div className="bg-grid absolute inset-0" />
      </div>

      {/* ── Navbar ──────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-pink-600">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-black tracking-tight text-white">IOMIXO<span className="text-purple-400"> AI</span></span>
        </div>

        <nav className="hidden md:flex items-center gap-8 text-sm text-white/50">
          <a href="#studio"   className="hover:text-white transition-colors">Studio</a>
          <a href="#outputs"  className="hover:text-white transition-colors">Outputs</a>
          <a href="#how"      className="hover:text-white transition-colors">How it works</a>
          <a href="#tech"     className="hover:text-white transition-colors">Technology</a>
          <a href="#pricing"  className="hover:text-white transition-colors">Pricing</a>
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/register">
            <Button variant="primary" size="sm" icon={<Sparkles className="h-3.5 w-3.5" />}>
              Get started free
            </Button>
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section ref={heroRef} className="relative z-10 flex flex-col items-center text-center px-6 pt-24 pb-16">
        <motion.div style={{ y: heroY, opacity: heroOpa }} className="w-full">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-purple-500/10 px-4 py-1.5 text-xs font-semibold text-purple-200 mb-10 backdrop-blur-sm">
              <Zap className="h-3 w-3" />
              AI-Powered Music Transformation Studio
            </div>

            {/* Title */}
            <h1 className="text-5xl md:text-7xl font-black leading-[1.05] tracking-tighter max-w-5xl mx-auto mb-8">
              Transform <span className="text-gradient">Raw Audio</span> Into<br className="hidden md:block" />{' '}
              Professional <span className="text-gradient-gold">Mashups</span>, Remixes &amp; Fusion Edits
            </h1>

            {/* Sub */}
            <p className="max-w-2xl mx-auto text-lg md:text-xl text-white/55 mb-12 leading-relaxed">
              Upload your source audio files and let IOMIXO analyze stems, harmonics, rhythm, and structure
              to generate polished DJ-grade arrangements in minutes.
            </p>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button variant="primary" size="lg" icon={<Sparkles className="h-4 w-4" />}>
                  Create your first AI remix free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="#studio">
                <Button variant="ghost" size="lg" icon={<Headphones className="h-4 w-4" />}>
                  Hear demo transformations
                </Button>
              </Link>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Hero Audio Demo Showcase ────────────────────────── */}
      <section id="studio" className="relative z-10 max-w-6xl mx-auto px-6 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7 }}
          className="relative"
        >
          {/* Ambient glow behind showcase */}
          <div className="absolute -inset-10 bg-gradient-to-r from-purple-600/10 via-pink-500/10 to-purple-600/10 blur-3xl rounded-[3rem] pointer-events-none" aria-hidden />

          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 items-center">
            <AudioShowcaseCard
              label="Source Audio A"
              title="source_track_a.wav"
              accent="purple"
            />

            {/* Center: AI output, elevated */}
            <div className="relative md:scale-[1.04]">
              <AudioShowcaseCard
                label="AI Output"
                title="iomixo_transformation.wav"
                accent="gold"
                highlighted
                badge="AI Generated"
              />
            </div>

            <AudioShowcaseCard
              label="Source Audio B"
              title="source_track_b.wav"
              accent="pink"
            />
          </div>

          {/* Flow arrows / waveform connector */}
          <div className="hidden md:flex items-center justify-center mt-8 gap-4 text-white/30">
            <AudioWaveform className="h-4 w-4" />
            <span className="text-[11px] font-mono uppercase tracking-[0.3em]">
              input sources → ai analysis → transformed output
            </span>
            <AudioWaveform className="h-4 w-4" />
          </div>
        </motion.div>
      </section>

      {/* ── Output Types ────────────────────────────────────── */}
      <section id="outputs" className="relative z-10 max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-5">
            Creative Outputs
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-white mb-4 tracking-tight">
            One Engine. <span className="text-gradient">Multiple Creative Results.</span>
          </h2>
          <p className="text-white/45 max-w-xl mx-auto">
            A single transformation pipeline, four distinct creative directions.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <OutputTypeCard
            icon={<Combine className="h-6 w-6" />}
            title="AI Mashup"
            desc="Blend vocal and instrumental sections into a coherent new arrangement."
          />
          <OutputTypeCard
            icon={<Shuffle className="h-6 w-6" />}
            title="AI Remix"
            desc="Restructure pacing, drops, transitions, and energy for a fresh listening experience."
          />
          <OutputTypeCard
            icon={<Wand2 className="h-6 w-6" />}
            title="Fusion Edit"
            desc="Merge harmonic, rhythmic, and melodic layers into a hybrid production."
          />
          <OutputTypeCard
            icon={<Layers className="h-6 w-6" />}
            title="Stem Rebuild"
            desc="Isolate and recompose vocals, drums, bass, and musical elements into new forms."
          />
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section id="how" className="relative z-10 max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-5">
            Workflow
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-white mb-4 tracking-tight">
            From source files to <span className="text-gradient">studio-ready output</span>
          </h2>
          <p className="text-white/45">Four orchestrated stages, fully automated by AI.</p>
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          {[
            { step: '01', title: 'Upload Audio Sources',          desc: 'Import two audio files for AI analysis and reconstruction.',                 icon: <Music2 className="h-6 w-6" /> },
            { step: '02', title: 'Deep Stem & Harmonic Analysis', desc: 'IOMIXO separates vocals, drums, bass, melody, BPM, key, and phrase structure.', icon: <Activity className="h-6 w-6" /> },
            { step: '03', title: 'AI Arrangement Composition',    desc: 'Our engine generates a musically aligned remix, mashup, or fusion edit.',     icon: <Wand2 className="h-6 w-6" /> },
            { step: '04', title: 'Preview & Export',              desc: 'Listen, compare, and export your generated transformation.',                  icon: <Headphones className="h-6 w-6" /> },
          ].map((item, i) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative text-center"
            >
              {i < 3 && (
                <div className="hidden md:block absolute top-8 left-[calc(50%+2.25rem)] right-0 h-px bg-gradient-to-r from-purple-500/40 to-transparent" />
              )}
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/15 to-pink-500/10 border border-purple-400/20 text-purple-300 mb-4 shadow-[0_0_30px_-10px_rgba(168,85,247,0.6)]">
                {item.icon}
              </div>
              <div className="text-xs font-mono text-purple-400 mb-2">{item.step}</div>
              <h3 className="font-semibold text-white mb-2">{item.title}</h3>
              <p className="text-sm text-white/45 leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Technology / Features ───────────────────────────── */}
      <section id="tech" className="relative z-10 max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-5">
            Technology
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-white mb-4 tracking-tight">
            Professional-Grade AI <span className="text-gradient">Audio Production Pipeline</span>
          </h2>
          <p className="text-white/45 max-w-xl mx-auto">
            The same building blocks a senior producer would reach for — orchestrated end-to-end.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <FeatureCard
            icon={<Layers className="h-6 w-6" />}
            title="Deep Stem Reconstruction"
            desc="Studio-grade source separation of vocals, drums, bass, melodic layers, and FX."
          />
          <FeatureCard
            icon={<Activity className="h-6 w-6" />}
            title="Harmonic & Tempo Intelligence"
            desc="Automatic BPM alignment, key correction, and phrase synchronization."
          />
          <FeatureCard
            icon={<Wand2 className="h-6 w-6" />}
            title="AI Arrangement Composer"
            desc="Builds intros, transitions, drops, chorus overlays, and full structured edits."
          />
          <FeatureCard
            icon={<SlidersHorizontal className="h-6 w-6" />}
            title="Sonic Enhancement"
            desc="Applies modern FX, stereo polish, loudness balancing, and mastering."
          />
        </div>

        {/* Trust micro-bar */}
        <div className="mt-14 flex items-center justify-center">
          <div className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-xs text-white/50 backdrop-blur-sm">
            <ShieldCheck className="h-3.5 w-3.5 text-purple-300" />
            <span>Private processing</span>
            <span className="text-white/15">•</span>
            <span>Auto-deleted source uploads</span>
            <span className="text-white/15">•</span>
            <span>Secure generation</span>
          </div>
        </div>
      </section>

      {/* ── Pricing (moved lower, after emotional build) ────── */}
      <section id="pricing" className="relative z-10 max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-5">
            Pricing
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-white mb-4 tracking-tight">
            Start free. <span className="text-gradient">Scale when ready.</span>
          </h2>
          <p className="text-white/45">No credit card to begin. Upgrade only when you need more transformations.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <PricingCard plan="free" />
          <PricingCard plan="pro" highlighted />
          <PricingCard plan="studio" />
        </div>
      </section>

      {/* ── Final CTA Banner ────────────────────────────────── */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 pb-32">
        <div className="relative glass rounded-3xl p-12 text-center border border-purple-500/30 shadow-neon-purple overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-600/10 via-transparent to-pink-500/10 pointer-events-none" />
          <div className="relative">
            <Globe className="h-10 w-10 text-purple-300 mx-auto mb-4 animate-spin-slow" />
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4 tracking-tight">
              Ready to compose your first AI transformation?
            </h2>
            <p className="text-white/50 mb-8 max-w-md mx-auto">
              Bring your source audio. IOMIXO handles stems, harmonics, arrangement, and mastering.
            </p>
            <Link href="/register">
              <Button variant="primary" size="lg" icon={<Sparkles className="h-4 w-4" />}>
                Start for free — no credit card required
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/[0.06] px-6 py-10">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <span className="text-sm font-bold text-white/70">IOMIXO<span className="text-purple-400"> AI</span></span>
            </div>
            <p className="text-xs text-white/25">© 2026 IOMIXO. All rights reserved.</p>
            <div className="flex gap-4 text-xs text-white/30">
              <a href="#" className="hover:text-white/60 transition-colors">Privacy</a>
              <a href="#" className="hover:text-white/60 transition-colors">Terms</a>
              <a href="#" className="hover:text-white/60 transition-colors">Contact</a>
            </div>
          </div>
          <p className="text-[11px] text-white/30 leading-relaxed max-w-3xl mx-auto text-center border-t border-white/[0.04] pt-6">
            IOMIXO provides private AI audio transformation tools. Users are responsible for ensuring they
            hold appropriate rights or permissions for uploaded materials.
          </p>
        </div>
      </footer>
    </div>
  )
}
