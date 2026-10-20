'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowRight, Camera, Check, ChevronDown, Globe2, Languages, Menu, MonitorPlay, Printer, QrCode, Quote, ShieldCheck,
  Smartphone, Sparkles, UserCheck, Users, X, Heart, PartyPopper, Baby, CalendarHeart, SlidersHorizontal,
} from 'lucide-react'
import { MioloveLogo } from '@/components/brand/MioloveLogo'
import { MioloveLanguageSwitcher } from '@/components/wedding/MioloveLanguageSwitcher'
import { WeddingGuestHome, buildWeddingGuestActions } from '@/components/wedding/guest/WeddingGuestUI'
import { PublicPlanCards } from '@/components/miolove/PlanCards'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useI18n, type Locale } from '@/lib/i18n'
import { isFeatureAvailable, type FeatureId } from '@/lib/miolove/plans'
import { reviewsEnv, reviewsToShow } from '@/lib/miolove/reviews'
import { occasionEyebrow } from '@/lib/occasion'
import { PORTAL_CONFIG } from '@/lib/portal'
import { cn } from '@/lib/utils'
import { PhoneMock, Section, SectionHead, Tile } from './parts'

const btnPrimary = 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-wd-pink px-7 text-[16px] font-semibold text-white shadow-[0_10px_30px_rgba(240,106,155,0.35)] transition hover:bg-wd-pink-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/50'
const btnSecondary = 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-wd-border bg-white px-7 text-[16px] font-semibold text-wd-ink transition hover:bg-wd-active focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40'

// ── Header ───────────────────────────────────────────────────────────────────
function Header({ showReviews }: { showReviews: boolean }) {
  const { t } = useI18n()
  const { user, isAnonymous } = useAuth()
  const signedIn = !!user && !isAnonymous
  const [open, setOpen] = useState(false)
  useEffect(() => { if (open) { const f = () => setOpen(false); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) } }, [open])
  const links = [
    ['#how', t('home.nav.how')], ['#features', t('home.nav.features')], ['#pricing', t('home.nav.pricing')],
    ...(showReviews ? [['#reviews', t('home.nav.reviews')]] : []), ['#faq', t('home.nav.faq')],
  ] as const
  return (
    <header className="sticky top-0 z-50 border-b border-wd-border bg-white/90 backdrop-blur" data-testid="home-header">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
        <Link href="/" aria-label="MIOLOVE ALBUM" className="shrink-0"><MioloveLogo height={34} /></Link>
        <nav className="hidden items-center gap-7 text-[15px] font-medium text-wd-muted lg:flex" aria-label="Home">
          {links.map(([href, label]) => <a key={href} href={href} className="transition hover:text-wd-ink">{label}</a>)}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <MioloveLanguageSwitcher />
          {signedIn ? (
            <Link href="/sessions" className="hidden min-h-[44px] items-center rounded-full bg-wd-pink px-5 text-sm font-semibold text-white hover:bg-wd-pink-hover sm:inline-flex" data-testid="nav-my-albums">{t('home.nav.myAlbums')}</Link>
          ) : (<>
            <Link href="/login" className="hidden min-h-[44px] items-center px-2 text-[15px] font-semibold text-wd-ink hover:text-wd-pink md:inline-flex" data-testid="nav-login">{t('home.nav.login')}</Link>
            <Link href="/register" className="hidden min-h-[44px] items-center rounded-full bg-wd-pink px-5 text-sm font-semibold text-white hover:bg-wd-pink-hover sm:inline-flex" data-testid="nav-try-free">{t('home.nav.tryFree')}</Link>
          </>)}
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={t('home.nav.menu')} aria-expanded={open} data-testid="nav-menu"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-wd-border bg-white text-wd-ink lg:hidden">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-wd-border bg-white px-5 pb-5 pt-2 lg:hidden" data-testid="nav-drawer">
          {links.map(([href, label]) => <a key={href} href={href} onClick={() => setOpen(false)} className="flex min-h-[48px] items-center text-[16px] font-medium text-wd-ink">{label}</a>)}
          <div className="mt-3 grid gap-3">
            {signedIn ? <Link href="/sessions" className={btnPrimary}>{t('home.nav.myAlbums')}</Link> : (<>
              <Link href="/register" className={btnPrimary}>{t('home.nav.tryFree')}</Link>
              <Link href="/login" className={btnSecondary}>{t('home.nav.login')}</Link>
            </>)}
          </div>
        </div>
      )}
    </header>
  )
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  const { t } = useI18n()
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF3F8] via-[#FFF9FB] to-white">
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-wd-pink/15 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-[#F7B98F]/20 blur-3xl" aria-hidden />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        <div className="text-center lg:text-left">
          <p className="mx-auto inline-flex max-w-full items-center gap-2 rounded-full border border-wd-border bg-white px-4 py-1.5 text-[13px] font-semibold text-wd-pink-hover lg:mx-0">
            <Sparkles className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{t('home.hero.badge')}</span>
          </p>
          <h1 className="mt-6 font-album text-[40px] font-semibold leading-[1.05] tracking-tight text-wd-ink sm:text-[56px] lg:text-[64px]" data-testid="home-h1">
            {t('home.hero.titleA')} <span className="italic text-wd-pink">{t('home.hero.titleB')}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-wd-muted sm:text-[19px] lg:mx-0">{t('home.hero.sub')}</p>
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link href="/register" className={btnPrimary} data-testid="hero-cta-primary">{t('home.hero.ctaPrimary')} <ArrowRight className="h-5 w-5" /></Link>
            <a href="#how" className={btnSecondary} data-testid="hero-cta-secondary">{t('home.hero.ctaSecondary')}</a>
          </div>
          <p className="mt-5 inline-flex items-center gap-2 text-[14px] font-medium text-wd-muted" data-testid="hero-note"><Check className="h-4 w-4 text-wd-pink" />{t('home.hero.note')}</p>
        </div>

        {/* photo / phone / QR composition */}
        <div className="relative mx-auto h-[420px] w-full max-w-[420px] sm:h-[500px]" aria-hidden data-testid="hero-visual">
          <div className="absolute left-1/2 top-0 w-[210px] -translate-x-1/2 sm:w-[250px]"><PhoneMock title={t('home.hero.album')} /></div>
          <div className="absolute bottom-6 left-0 w-[132px] -rotate-6 rounded-3xl border border-wd-border bg-white p-3 shadow-[0_18px_40px_rgba(31,32,40,0.14)] sm:bottom-10 sm:w-[156px]">
            <QRCodeSVG value={PORTAL_CONFIG.miolove.baseUrl} size={120} level="M" className="h-auto w-full" />
            <p className="mt-2 text-center text-[11px] font-semibold text-wd-ink">{t('home.hero.qrLabel')}</p>
          </div>
          <div className="absolute right-0 top-10 flex items-center gap-2 rounded-2xl border border-wd-border bg-white px-3 py-2 shadow-[0_14px_30px_rgba(31,32,40,0.12)] sm:top-16">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-wd-active text-wd-pink"><Camera className="h-4 w-4" /></span>
            <span className="text-[12px] font-semibold text-wd-ink">{t('home.hero.newPhoto')}</span>
          </div>
          <Tile i={2} className="absolute -left-1 top-24 h-20 w-16 -rotate-12 shadow-lg sm:h-24 sm:w-20" icon />
          <Tile i={4} className="absolute bottom-24 right-0 h-20 w-20 rotate-6 shadow-lg sm:bottom-28 sm:h-24 sm:w-24" icon />
        </div>
      </div>
    </section>
  )
}

// ── How it works ─────────────────────────────────────────────────────────────
function How() {
  const { t } = useI18n()
  const icons = [Sparkles, QrCode, Smartphone, MonitorPlay]
  return (
    <Section id="how" tone="white">
      <SectionHead eyebrow={t('home.how.eyebrow')} title={t('home.how.title')} sub={t('home.how.sub')} />
      <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {(['s1', 's2', 's3', 's4'] as const).map((k, i) => {
          const Icon = icons[i]
          return (
            <li key={k} className="relative rounded-3xl border border-wd-border bg-wd-bg p-6" data-testid="how-step">
              <span className="font-album text-[44px] font-semibold leading-none text-wd-pink/30">{i + 1}</span>
              <span className="mt-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-wd-pink shadow-sm"><Icon className="h-6 w-6" /></span>
              <h3 className="mt-4 text-[18px] font-bold text-wd-ink">{t(`home.how.${k}.title`)}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-wd-muted">{t(`home.how.${k}.text`)}</p>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

// ── What is included ─────────────────────────────────────────────────────────
const FEATURE_ITEMS: Array<{ key: string; icon: typeof QrCode; feature?: FeatureId }> = [
  { key: 'qr', icon: QrCode, feature: 'qrLink' }, { key: 'guests', icon: Users, feature: 'guests' }, { key: 'noApp', icon: Smartphone, feature: 'noApp' },
  { key: 'slideshow', icon: MonitorPlay, feature: 'slideshow' }, { key: 'booth', icon: Camera, feature: 'photos' }, { key: 'privacy', icon: ShieldCheck, feature: 'photos' },
  { key: 'custom', icon: SlidersHorizontal, feature: 'basicCustom' }, { key: 'poster', icon: Printer, feature: 'posterCard' }, { key: 'languages', icon: Languages },
]
function Features() {
  const { t } = useI18n()
  return (
    <Section id="features">
      <SectionHead eyebrow={t('home.features.eyebrow')} title={t('home.features.title')} sub={t('home.features.sub')} />
      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_ITEMS.filter((f) => isFeatureAvailable(f.feature)).map(({ key, icon: Icon }) => (
          <li key={key} className="rounded-3xl border border-wd-border bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(240,106,155,0.14)]" data-testid="feature-card">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-wd-active text-wd-pink"><Icon className="h-6 w-6" /></span>
            <h3 className="mt-4 text-[18px] font-bold text-wd-ink">{t(`home.features.${key}.title`)}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-wd-muted">{t(`home.features.${key}.text`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ── Benefits ─────────────────────────────────────────────────────────────────
function Benefits() {
  const { t } = useI18n()
  const icons = [Heart, UserCheck, MonitorPlay, CalendarHeart]
  return (
    <Section tone="blush">
      <div className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-wd-pink">{t('home.benefits.eyebrow')}</p>
          <h2 className="mt-3 font-album text-[32px] font-semibold leading-[1.1] tracking-tight text-wd-ink sm:text-[42px]">{t('home.benefits.title')}</h2>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {(['b1', 'b2', 'b3', 'b4'] as const).map((k, i) => {
            const Icon = icons[i]
            return (
              <li key={k} className="rounded-3xl bg-white p-6 shadow-[0_8px_24px_rgba(240,106,155,0.10)]" data-testid="benefit-card">
                <Icon className="h-6 w-6 text-wd-pink" />
                <h3 className="mt-3 text-[17px] font-bold text-wd-ink">{t(`home.benefits.${k}.title`)}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-wd-muted">{t(`home.benefits.${k}.text`)}</p>
              </li>
            )
          })}
        </ul>
      </div>
    </Section>
  )
}

// ── Why not WhatsApp ─────────────────────────────────────────────────────────
function WhyNotWhatsapp() {
  const { t } = useI18n()
  return (
    <Section id="whatsapp" tone="white">
      <SectionHead eyebrow={t('home.whatsapp.eyebrow')} title={t('home.whatsapp.title')} sub={t('home.whatsapp.sub')} />
      <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-[28px] border border-wd-border" data-testid="whatsapp-compare">
        <div className="grid grid-cols-2 bg-wd-bg text-[13px] font-bold uppercase tracking-wide sm:text-sm">
          <p className="px-4 py-3 text-wd-muted sm:px-6">{t('home.whatsapp.colA')}</p>
          <p className="bg-wd-active px-4 py-3 text-wd-pink-hover sm:px-6">{t('home.whatsapp.colB')}</p>
        </div>
        {(['r1', 'r2', 'r3', 'r4', 'r5'] as const).map((k) => (
          <div key={k} className="grid grid-cols-2 border-t border-wd-border">
            <p className="flex items-start gap-2 px-4 py-4 text-[14px] leading-snug text-wd-muted sm:gap-3 sm:px-6 sm:text-[15px]"><X className="mt-0.5 h-4 w-4 shrink-0 text-wd-muted/70" />{t(`home.whatsapp.${k}.a`)}</p>
            <p className="flex items-start gap-2 bg-wd-active/50 px-4 py-4 text-[14px] font-medium leading-snug text-wd-ink sm:gap-3 sm:px-6 sm:text-[15px]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-wd-pink" strokeWidth={3} />{t(`home.whatsapp.${k}.b`)}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Event types ──────────────────────────────────────────────────────────────
function EventTypes() {
  const { t } = useI18n()
  const items = [
    { k: 'wedding', icon: Heart, tone: 'from-[#FFD6E4] to-[#F9A8C5]' }, { k: 'birthday', icon: PartyPopper, tone: 'from-[#FFE7D1] to-[#F7B98F]' },
    { k: 'baptism', icon: Baby, tone: 'from-[#EADFF7] to-[#C5AEE6]' }, { k: 'other', icon: Sparkles, tone: 'from-[#E4EFE0] to-[#B6D2AE]' },
  ] as const
  return (
    <Section id="events">
      <SectionHead eyebrow={t('home.events.eyebrow')} title={t('home.events.title')} sub={t('home.events.sub')} />
      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ k, icon: Icon, tone }) => (
          <li key={k} className="overflow-hidden rounded-3xl border border-wd-border bg-white" data-testid="event-type">
            <div className={cn('flex h-32 items-center justify-center bg-gradient-to-br', tone)}><Icon className="h-10 w-10 text-white drop-shadow" /></div>
            <div className="p-5">
              <h3 className="text-[18px] font-bold text-wd-ink">{t(`home.events.${k}.title`)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-wd-muted">{t(`home.events.${k}.text`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ── Product preview ──────────────────────────────────────────────────────────
function Preview() {
  const { t } = useI18n()
  // The REAL guest-page components (not a screenshot): same visuals as /live/[slug], rendered at 390px and scaled down. Illustrative sample data only.
  const items = buildWeddingGuestActions(['photos'], t)
  return (
    <Section id="preview" tone="blush">
      <SectionHead eyebrow={t('home.preview.eyebrow')} title={t('home.preview.title')} sub={t('home.preview.sub')} />
      <div className="mt-12 grid items-start gap-10 lg:grid-cols-[250px_1fr_1fr]" data-testid="home-preview">
        <figure className="mx-auto w-[250px]">
          <div className="relative h-[520px] overflow-hidden rounded-[34px] border-[6px] border-wd-ink bg-wd-bg shadow-[0_24px_50px_rgba(240,106,155,0.22)]" aria-hidden>
            <div className="pointer-events-none absolute left-0 top-0 w-[390px] origin-top-left select-none px-5 pb-8 pt-5" style={{ transform: `scale(${238 / 390})` }}>
              <WeddingGuestHome names={t('home.preview.sampleName')} date={null} items={items} eyebrow={occasionEyebrow(t, 'birthday')} />
            </div>
          </div>
          <figcaption className="mt-4 text-center text-sm font-semibold text-wd-ink">{t('home.preview.guest')}</figcaption>
        </figure>

        <figure className="min-w-0">
          <div className="relative aspect-video overflow-hidden rounded-2xl border-[6px] border-wd-ink bg-gradient-to-br from-[#3A2630] to-[#6B3A4F] shadow-[0_24px_50px_rgba(31,32,40,0.25)]" aria-hidden>
            <div className="absolute inset-0 grid grid-cols-4 gap-2 p-3 opacity-90 sm:gap-3 sm:p-5">
              {[0, 1, 2, 3, 4, 5, 3, 1].map((i, n) => <Tile key={n} i={i} className="h-full w-full" />)}
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-black/35">
              <p className="px-4 text-center font-album text-[22px] font-semibold text-white sm:text-[34px]">{t('home.preview.sampleName')}</p>
            </div>
          </div>
          <figcaption className="mt-4 text-center text-sm font-semibold text-wd-ink">{t('home.preview.screen')}</figcaption>
        </figure>

        <figure className="min-w-0">
          <div className="rounded-2xl border border-wd-border bg-white p-4 shadow-[0_24px_50px_rgba(240,106,155,0.14)] sm:p-5" aria-hidden>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-album text-[17px] font-semibold text-wd-ink">{t('home.preview.sampleName')}</p>
              <Globe2 className="h-4 w-4 text-wd-pink" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => <Tile key={i} i={i} className="aspect-square" />)}
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-wd-bg p-3">
              <QRCodeSVG value={PORTAL_CONFIG.miolove.baseUrl} size={64} level="M" />
              <p className="text-[12px] font-semibold text-wd-ink">{t('home.hero.qrLabel')}</p>
            </div>
          </div>
          <figcaption className="mt-4 text-center text-sm font-semibold text-wd-ink">{t('home.preview.album')}</figcaption>
        </figure>
      </div>
      <p className="mt-8 text-center text-xs text-wd-muted">{t('home.preview.sample')}</p>
    </Section>
  )
}

// ── Reviews (hidden in production until real ones exist) ─────────────────────
function Reviews({ items, demo }: { items: ReturnType<typeof reviewsToShow>['items']; demo: boolean }) {
  const { t, locale } = useI18n()
  return (
    <Section id="reviews" tone="white">
      <SectionHead eyebrow={t('home.reviews.eyebrow')} title={t('home.reviews.title')} sub={t('home.reviews.sub')} />
      {demo && (
        <p className="mx-auto mt-6 flex max-w-xl items-center justify-center gap-2 rounded-full border border-dashed border-wd-pink/60 bg-wd-active px-4 py-2 text-center text-xs font-bold text-wd-pink-hover" data-testid="reviews-demo-badge">
          {t('home.reviews.demoBadge')} · {t('home.reviews.demoNote')}
        </p>
      )}
      <ul className="mt-10 grid gap-5 md:grid-cols-3" data-testid="reviews-list" data-demo={demo ? 'true' : 'false'}>
        {items.map((r) => (
          <li key={r.id} className="relative flex flex-col rounded-3xl border border-wd-border bg-wd-bg p-7" data-review-placeholder={r.placeholder ? 'true' : 'false'}>
            <Quote className="h-8 w-8 text-wd-pink/50" />
            <p className="mt-4 flex-1 font-album text-[18px] leading-relaxed text-wd-ink">{r.text[locale as Locale]}</p>
            <footer className="mt-6 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-wd-active font-bold text-wd-pink">{r.author[0]}</span>
              <span><span className="block text-sm font-bold text-wd-ink">{r.author}</span><span className="block text-xs text-wd-muted">{r.context[locale as Locale]}</span></span>
            </footer>
            {r.placeholder && <span className="absolute right-4 top-4 rounded-full bg-wd-ink px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">DEMO</span>}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ── Pricing ──────────────────────────────────────────────────────────────────
function Pricing() {
  const { t } = useI18n()
  return (
    <Section id="pricing" tone="blush">
      <SectionHead eyebrow={t('home.pricing.eyebrow')} title={t('home.pricing.title')} sub={t('home.pricing.sub')} />
      <div className="mx-auto mt-12 max-w-5xl"><PublicPlanCards /></div>
    </Section>
  )
}

// ── FAQ ──────────────────────────────────────────────────────────────────────
function Faq() {
  const { t } = useI18n()
  return (
    <Section id="faq">
      <SectionHead eyebrow={t('home.faq.eyebrow')} title={t('home.faq.title')} />
      <div className="mx-auto mt-10 max-w-3xl space-y-3" data-testid="faq-list">
        {(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'] as const).map((k) => (
          <details key={k} className="group rounded-2xl border border-wd-border bg-white px-5 py-1 open:shadow-[0_10px_30px_rgba(240,106,155,0.10)]">
            <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-wd-ink [&::-webkit-details-marker]:hidden">
              {t(`home.faq.${k}.q`)}
              <ChevronDown className="h-5 w-5 shrink-0 text-wd-pink transition group-open:rotate-180" />
            </summary>
            <p className="pb-4 pr-8 text-[15px] leading-relaxed text-wd-muted">{t(`home.faq.${k}.a`)}</p>
          </details>
        ))}
      </div>
    </Section>
  )
}

// ── Final CTA + footer ───────────────────────────────────────────────────────
function FinalCta() {
  const { t } = useI18n()
  return (
    <section className="px-5 pb-16 sm:px-8 sm:pb-24">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[36px] bg-gradient-to-br from-wd-pink to-[#F59AB9] px-6 py-14 text-center text-white sm:px-12 sm:py-20">
        <div className="pointer-events-none absolute -left-10 -top-10 h-48 w-48 rounded-full bg-white/15" aria-hidden />
        <div className="pointer-events-none absolute -bottom-12 -right-8 h-56 w-56 rounded-full bg-white/10" aria-hidden />
        <h2 className="relative font-album text-[32px] font-semibold leading-tight sm:text-[46px]">{t('home.cta.title')}</h2>
        <p className="relative mx-auto mt-4 max-w-md text-[17px] text-white/90">{t('home.cta.text')}</p>
        <Link href="/register" className="relative mt-8 inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-white px-8 text-[16px] font-bold text-wd-pink-hover shadow-lg transition hover:bg-wd-bg" data-testid="final-cta">
          {t('home.cta.button')} <ArrowRight className="h-5 w-5" />
        </Link>
      </div>
    </section>
  )
}

function Footer() {
  const { t } = useI18n()
  const col = 'space-y-3 text-[15px]'
  const link = 'text-wd-muted transition hover:text-wd-ink'
  return (
    <footer className="border-t border-wd-border bg-white" data-testid="home-footer">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <MioloveLogo height={38} />
          <p className="mt-4 max-w-xs font-album text-[17px] leading-snug text-wd-ink">{t('home.footer.tagline')}</p>
        </div>
        <nav className={col} aria-label={t('home.footer.product')}>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-wd-ink">{t('home.footer.product')}</p>
          <a className={cn(link, 'block')} href="#how">{t('home.nav.how')}</a>
          <a className={cn(link, 'block')} href="#features">{t('home.nav.features')}</a>
          <a className={cn(link, 'block')} href="#pricing">{t('home.nav.pricing')}</a>
          <a className={cn(link, 'block')} href="#faq">{t('home.nav.faq')}</a>
        </nav>
        <nav className={col} aria-label={t('home.footer.account')}>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-wd-ink">{t('home.footer.account')}</p>
          <Link className={cn(link, 'block')} href="/login">{t('home.nav.login')}</Link>
          <Link className={cn(link, 'block')} href="/register">{t('home.nav.tryFree')}</Link>
        </nav>
        <nav className={col} aria-label={t('home.footer.legal')}>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-wd-ink">{t('home.footer.legal')}</p>
          <Link className={cn(link, 'block')} href="/privacy">{t('home.footer.privacy')}</Link>
          <Link className={cn(link, 'block')} href="/terms">{t('home.footer.terms')}</Link>
          <div className="pt-2"><p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-wd-ink">{t('home.footer.language')}</p><MioloveLanguageSwitcher /></div>
        </nav>
      </div>
      <div className="border-t border-wd-border px-5 py-5 text-center text-xs text-wd-muted sm:px-8">© {new Date().getFullYear()} MIOLOVE ALBUM · {t('home.footer.rights')}</div>
    </footer>
  )
}

export function MioloveHome() {
  const reviews = reviewsToShow(reviewsEnv())
  const showReviews = reviews.items.length > 0
  return (
    <main className="min-h-screen bg-[#FFF9FB] font-sans text-wd-ink antialiased" data-portal="miolove" data-testid="miolove-home">
      <Header showReviews={showReviews} />
      <Hero />
      <How />
      <Features />
      <Benefits />
      <WhyNotWhatsapp />
      <EventTypes />
      <Preview />
      {showReviews && <Reviews items={reviews.items} demo={reviews.demo} />}
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  )
}
