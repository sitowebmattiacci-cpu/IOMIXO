'use client'
import Link from 'next/link'
import { motion, useScroll, useTransform } from 'framer-motion'
import { useRef } from 'react'
import {
  Sparkles, Music2, Wand2, ArrowRight, CheckCircle2,
  Activity, Zap, Mic, Layers, Download, Globe,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PLAN_METADATA } from '@/types'

// ── Animated waveform decoration ─────────────────────────────
function WaveformDeco() {
  return (
    <div className="flex items-end gap-0.5 h-12" aria-hidden>
      {Array.from({ length: 20 }).map((_, i) => (
        <span
          key={i}
          className="waveform-bar"
          style={{
            height: `${Math.random() * 70 + 20}%`,
            animationDelay: `${i * 0.07}s`,
          }}
        />
      ))}
    </div>
  )
}

// ── Feature card ──────────────────────────────────────────────
function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="glass glass-hover rounded-2xl p-6 space-y-3"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/15 text-purple-400">
        {icon}
      </div>
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
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
          {meta.monthlyCredits} mashup{meta.monthlyCredits !== 1 ? 's' : ''} per month
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
  const heroY   = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
  const heroOpa = useTransform(scrollYProgress, [0, 0.6], [1, 0])

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
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how"      className="hover:text-white transition-colors">How it works</a>
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
      <section ref={heroRef} className="relative z-10 flex flex-col items-center text-center px-6 pt-20 pb-32">
        <motion.div style={{ y: heroY, opacity: heroOpa }}>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-1.5 text-xs font-semibold text-purple-300 mb-8">
              <Zap className="h-3 w-3" />
              AI-Powered Music Fusion Studio
            </div>

            {/* Title */}
            <h1 className="text-5xl md:text-7xl font-black leading-tight tracking-tighter max-w-4xl mx-auto mb-6">
              Turn <span className="text-gradient">Two Songs</span><br />
              Into One{' '}
              <span className="text-gradient-gold">Masterpiece</span>
            </h1>

            {/* Sub */}
            <p className="max-w-xl mx-auto text-lg text-white/50 mb-10 leading-relaxed">
              Upload any two songs. Our AI separates stems, matches keys &amp; BPM, composes a
              professional arrangement, and delivers a DJ-quality mashup in minutes.
            </p>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button variant="primary" size="lg" icon={<Sparkles className="h-4 w-4" />}>
                  Create your first mashup free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="#how">
                <Button variant="ghost" size="lg">See how it works</Button>
              </Link>
            </div>

            {/* Waveform deco */}
            <div className="mt-16 flex items-center justify-center gap-6">
              <div className="opacity-60"><WaveformDeco /></div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-neon-purple animate-float">
                <Music2 className="h-7 w-7 text-white" />
              </div>
              <div className="opacity-60 scale-x-[-1]"><WaveformDeco /></div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section id="features" className="relative z-10 max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">
            Professional-grade AI audio engine
          </h2>
          <p className="text-white/40 max-w-lg mx-auto">
            Everything a professional DJ and producer would do — automated by AI.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard
            icon={<Layers className="h-6 w-6" />}
            title="Deep Stem Separation"
            desc="Powered by Demucs and MDX-Net — isolates vocals, drums, bass, melody, harmony, and FX with studio precision."
          />
          <FeatureCard
            icon={<Activity className="h-6 w-6" />}
            title="BPM & Key Detection"
            desc="Librosa + Essentia analyze tempo maps, beat grids, key signatures, and phrase boundaries automatically."
          />
          <FeatureCard
            icon={<Wand2 className="h-6 w-6" />}
            title="Harmonic Matching"
            desc="Calculates optimal transposition intervals to avoid harmonic clashes and blend songs naturally in the same key."
          />
          <FeatureCard
            icon={<Music2 className="h-6 w-6" />}
            title="AI Mashup Composer"
            desc="Intelligent arranger builds intros, buildups, drops, chorus overlaps, and transitions like a real DJ producer."
          />
          <FeatureCard
            icon={<Mic className="h-6 w-6" />}
            title="Sound Modernizer"
            desc="Optionally replace kick, snare, bass synth, pads, and risers with 6 preset styles: EDM, House, Cinematic, and more."
          />
          <FeatureCard
            icon={<Zap className="h-6 w-6" />}
            title="Pro Mastering Engine"
            desc="Multi-band compression, EQ, stereo widening, limiting, and LUFS normalization for a release-ready final render."
          />
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section id="how" className="relative z-10 max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">How it works</h2>
          <p className="text-white/40">From upload to download in 4 simple steps.</p>
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          {[
            { step: '01', title: 'Upload', desc: 'Drag & drop two songs. Any format, up to 100 MB each.', icon: <Download className="h-6 w-6 rotate-180" /> },
            { step: '02', title: 'Analyze', desc: 'AI separates stems, detects BPM, key, and song structure.', icon: <Activity className="h-6 w-6" /> },
            { step: '03', title: 'Compose', desc: 'Mashup composer builds a custom arrangement with transitions.', icon: <Wand2 className="h-6 w-6" /> },
            { step: '04', title: 'Download', desc: 'Preview and download your professional mashup in WAV/MP3.', icon: <Download className="h-6 w-6" /> },
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
                <div className="hidden md:block absolute top-8 left-[calc(50%+2rem)] right-0 h-px bg-gradient-to-r from-purple-500/40 to-transparent" />
              )}
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 mb-4">
                {item.icon}
              </div>
              <div className="text-xs font-mono text-purple-500 mb-2">{item.step}</div>
              <h3 className="font-semibold text-white mb-2">{item.title}</h3>
              <p className="text-sm text-white/40">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section id="pricing" className="relative z-10 max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">Simple pricing</h2>
          <p className="text-white/40">Start free. Scale when you need more.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <PricingCard plan="free" />
          <PricingCard plan="pro" highlighted />
          <PricingCard plan="studio" />
        </div>
      </section>

      {/* ── CTA Banner ─────────────────────────────────────── */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 pb-32">
        <div className="glass rounded-3xl p-12 text-center border border-purple-500/20 shadow-neon-purple">
          <Globe className="h-10 w-10 text-purple-400 mx-auto mb-4 animate-spin-slow" />
          <h2 className="text-3xl font-black text-white mb-4">
            Ready to make your first mashup?
          </h2>
          <p className="text-white/40 mb-8">
            Join thousands of producers and DJs already using IOMIXO.
          </p>
          <Link href="/register">
            <Button variant="primary" size="lg" icon={<Sparkles className="h-4 w-4" />}>
              Start for free — no credit card required
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/6 px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-bold text-white/60">IOMIXO</span>
          </div>
          <p className="text-xs text-white/25">© 2026 IOMIXO. All rights reserved.</p>
          <div className="flex gap-4 text-xs text-white/25">
            <a href="#" className="hover:text-white/50 transition-colors">Privacy</a>
            <a href="#" className="hover:text-white/50 transition-colors">Terms</a>
            <a href="#" className="hover:text-white/50 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
