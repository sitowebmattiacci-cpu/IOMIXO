'use client'
import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Lightbulb, QrCode, Images, Share2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { OCCASION_COVERS } from '@/lib/miolove/demoMedia'
import { INCLUDE_KEYS, MOMENT_KEYS, STEP_KEYS, occasionText } from '@/lib/miolove/occasions'
import { OCCASION_IDS, isPublished, pagePath, type OccasionId } from '@/lib/miolove/pages'
import { homePath, ideasPath } from '@/lib/miolove/paths'
import { reviewsEnv, reviewsToShow } from '@/lib/miolove/reviews'
import { Footer, Header, btnPrimary, btnSecondary } from '../home/MioloveHome'
import { UrlLocale } from '../UrlLocale'
import { DemoPhotoImg, Section, SectionHead } from '../home/parts'

const STEP_ICONS = [Lightbulb, QrCode, Share2, Images] as const

/**
 * Public page of one occasion (wedding, birthday, baptism): one H1, H2 per block, the occasion's own steps, moments, FAQ and price. The texts are the
 * occasion's (`occasions.<id>.*`); the price and the trial limit are filled in from plans.ts. Header / footer are the home's. Only the occasions published in
 * the visitor's language are linked.
 */
export function MioloveOccasion({ occasion, faqKeys }: { occasion: OccasionId; faqKeys: readonly string[] }) {
  const { t, locale } = useI18n()
  const home = homePath(locale)
  const showReviews = reviewsToShow(reviewsEnv()).items.length > 0
  const k = (path: string) => `occasions.${occasion}.${path}`
  const c = (path: string) => `occasions.common.${path}`
  const x = (path: string) => occasionText(t(k(path)), locale)
  const others = OCCASION_IDS.filter((o) => o !== occasion && isPublished(o, locale as any))
  return (
    <main className="min-h-screen bg-[#FFF9FB] font-sans text-wd-ink antialiased" data-portal="miolove" data-testid="miolove-occasion" data-occasion={occasion}>
      <UrlLocale />
      <Header showReviews={showReviews} base={home} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF3F8] via-[#FFF9FB] to-white">
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-14 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="text-center lg:text-left">
            <nav aria-label="Breadcrumb" className="mb-5 text-[13px] font-medium text-wd-muted">
              <Link href={home} className="hover:text-wd-ink">{t(c('breadcrumbHome'))}</Link> <span aria-hidden>/</span> <span className="text-wd-ink">{t(k('name'))}</span>
            </nav>
            <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-wd-pink-ink">{t(k('hero.eyebrow'))}</p>
            <h1 className="mt-4 font-album text-[36px] font-semibold leading-[1.08] tracking-tight text-wd-ink sm:text-[52px] lg:text-[58px]" data-testid="occasion-h1">
              {t(k('hero.titleA'))} <span className="italic text-wd-pink-ink">{t(k('hero.titleB'))}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-wd-muted sm:text-[19px] lg:mx-0">{t(k('hero.sub'))}</p>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link href="/register" className={btnPrimary} data-testid="occasion-cta-primary">{t(c('ctaPrimary'))} <ArrowRight className="h-5 w-5" /></Link>
              <a href="#steps" className={btnSecondary}>{t(k('hero.ctaSecondary'))}</a>
            </div>
            <p className="mt-5 inline-flex items-start gap-2 text-left text-[14px] font-medium text-wd-muted"><Check className="mt-0.5 h-4 w-4 shrink-0 text-wd-pink-ink" />{t(k('hero.note'))}</p>
          </div>
          <div className="overflow-hidden rounded-[28px] border border-wd-border shadow-[0_24px_50px_rgba(31,32,40,0.14)]">
            <DemoPhotoImg photo={OCCASION_COVERS[occasion]} className="h-[300px] w-full sm:h-[420px]" sizes="(min-width:1024px) 520px, 100vw" priority />
          </div>
        </div>
      </section>

      {/* Why */}
      <Section id="why" tone="white">
        <SectionHead title={t(k('why.title'))} />
        <div className="mx-auto mt-6 max-w-3xl space-y-4 text-[16px] leading-relaxed text-wd-muted sm:text-[17px]">
          <p>{t(k('why.p1'))}</p>
          <p>{t(k('why.p2'))}</p>
        </div>
      </Section>

      {/* Steps */}
      <Section id="steps">
        <SectionHead title={t(k('steps.title'))} sub={t(k('steps.sub'))} />
        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEP_KEYS.map((s, n) => {
            const Icon = STEP_ICONS[n]
            return (
              <li key={s} className="rounded-3xl border border-wd-border bg-white p-6" data-testid="occasion-step">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-wd-active text-wd-pink-ink"><Icon className="h-6 w-6" /></span>
                <h3 className="mt-4 text-[18px] font-bold text-wd-ink"><span className="mr-2 text-wd-pink-ink">{n + 1}.</span>{t(k(`steps.${s}.t`))}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-wd-muted">{t(k(`steps.${s}.d`))}</p>
              </li>
            )
          })}
        </ol>
      </Section>

      {/* Moments */}
      <Section id="moments" tone="blush">
        <SectionHead title={t(k('moments.title'))} sub={t(k('moments.sub'))} />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {MOMENT_KEYS.map((m) => (
            <article key={m} className="rounded-3xl border border-wd-border bg-white p-6 sm:p-7" data-testid="occasion-moment">
              <h3 className="text-[19px] font-bold text-wd-ink">{t(k(`moments.${m}.t`))}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-wd-muted">{t(k(`moments.${m}.d`))}</p>
            </article>
          ))}
        </div>
      </Section>

      {/* What you get */}
      <Section id="include" tone="white">
        <SectionHead title={t(c('includeTitle'))} />
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {INCLUDE_KEYS.map((i) => (
            <li key={i} className="rounded-3xl border border-wd-border bg-wd-bg p-6" data-testid="occasion-include">
              <h3 className="flex items-start gap-2 text-[17px] font-bold text-wd-ink"><Check className="mt-1 h-4 w-4 shrink-0 text-wd-pink-ink" />{t(k(`include.${i}.t`))}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-wd-muted">{t(k(`include.${i}.d`))}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* Price (from plans.ts) */}
      <Section id="price">
        <SectionHead title={t(c('priceTitle'))} />
        <p className="mx-auto mt-6 max-w-3xl rounded-2xl bg-wd-active/60 px-5 py-4 text-[16px] leading-relaxed text-wd-ink" data-testid="occasion-price">{x('price.text')}</p>
      </Section>

      {/* FAQ */}
      <Section id="faq" tone="white">
        <SectionHead title={t(c('faqTitle'))} />
        <div className="mx-auto mt-10 max-w-3xl space-y-3" data-testid="occasion-faq">
          {faqKeys.map((q) => (
            <details key={q} className="group rounded-2xl border border-wd-border bg-white px-5 py-1 open:shadow-[0_10px_30px_rgba(240,106,155,0.10)]">
              <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-wd-ink [&::-webkit-details-marker]:hidden">
                <h3 className="text-[16px] font-semibold">{x(`faq.${q}.q`)}</h3>
                <ChevronDown className="h-5 w-5 shrink-0 text-wd-pink-ink transition group-open:rotate-180" />
              </summary>
              <p className="pb-4 pr-8 text-[15px] leading-relaxed text-wd-muted">{x(`faq.${q}.a`)}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Related: the guide and the other published occasions */}
      <Section id="more">
        <div className="grid gap-5 md:grid-cols-2">
          <Link href={`${ideasPath(locale)}#${occasion}`} className="rounded-3xl border border-wd-border bg-white p-6 transition hover:bg-wd-active" data-testid="occasion-guide-link">
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-wd-pink-ink">{t(c('guideTitle'))}</p>
            <p className="mt-2 inline-flex items-center gap-2 text-[17px] font-bold text-wd-ink">{t(c('guideLink'))} <ArrowRight className="h-4 w-4" /></p>
          </Link>
          {others.length > 0 && (
            <nav aria-label={t(c('otherTitle'))} className="rounded-3xl border border-wd-border bg-white p-6" data-testid="occasion-others">
              <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-wd-pink-ink">{t(c('otherTitle'))}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {others.map((o) => <li key={o}><Link href={pagePath(o, locale)} className="inline-flex min-h-[40px] items-center rounded-full border border-wd-border bg-white px-4 text-[14px] font-semibold text-wd-ink transition hover:bg-wd-active">{t(`occasions.${o}.name`)}</Link></li>)}
              </ul>
            </nav>
          )}
        </div>
      </Section>

      {/* Final CTA */}
      <section className="px-5 pb-16 pt-4 sm:px-8 sm:pb-24">
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[36px] bg-gradient-to-br from-wd-pink to-[#F59AB9] px-6 py-14 text-center text-white sm:px-12 sm:py-20">
          <h2 className="relative font-album text-[30px] font-semibold leading-tight sm:text-[44px]">{t(k('cta.title'))}</h2>
          <p className="relative mx-auto mt-4 max-w-md text-[17px] text-white/90">{t(k('cta.text'))}</p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-white px-8 text-[16px] font-bold text-wd-pink-ink shadow-lg transition hover:bg-wd-bg" data-testid="occasion-final-cta">
              {t(c('ctaPrimary'))} <ArrowRight className="h-5 w-5" />
            </Link>
            <Link href={home} className="inline-flex min-h-[54px] items-center justify-center rounded-2xl border border-white/60 px-8 text-[16px] font-semibold text-white transition hover:bg-white/10">{t(c('homeLink'))}</Link>
          </div>
        </div>
      </section>

      <Footer base={home} />
    </main>
  )
}
