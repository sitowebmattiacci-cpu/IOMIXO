'use client'
import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Gauge, Clock, Lightbulb, QrCode, Share2, Images } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { DEMO_PHOTOS } from '@/lib/miolove/demoMedia'
import { FAQ_KEYS, IDEAS, IDEA_OCCASIONS, IDEAS_BY_OCCASION } from '@/lib/miolove/ideas'
import { homePath } from '@/lib/miolove/paths'
import { isOccasionId, isPublished, pagePath } from '@/lib/miolove/pages'
import { reviewsEnv, reviewsToShow } from '@/lib/miolove/reviews'
import { cn } from '@/lib/utils'
import { Footer, Header, btnPrimary, btnSecondary } from '../home/MioloveHome'
import { UrlLocale } from '../UrlLocale'
import { DemoPhotoImg, Section, SectionHead } from '../home/parts'

/**
 * "Idee per usare MIOLOVE": public editorial guide (one H1, H2 per block, H3 per idea / occasion). No game engine: the ideas use what an album already does.
 * Header / footer are the home's, with their anchors pointing back to the home of the visitor's language.
 */
export function MioloveIdeas() {
  const { t, locale } = useI18n()
  const home = homePath(locale)
  const showReviews = reviewsToShow(reviewsEnv()).items.length > 0
  const steps = [{ k: 's1', Icon: Lightbulb }, { k: 's2', Icon: QrCode }, { k: 's3', Icon: Images }] as const
  const benefits = ['b1', 'b2', 'b3', 'b4'] as const
  return (
    <main className="min-h-screen bg-[#FFF9FB] font-sans text-wd-ink antialiased" data-portal="miolove" data-testid="miolove-ideas">
      <UrlLocale />
      <Header showReviews={showReviews} base={home} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF3F8] via-[#FFF9FB] to-white">
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-14 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="text-center lg:text-left">
            <nav aria-label="Breadcrumb" className="mb-5 text-[13px] font-medium text-wd-muted">
              <Link href={home} className="hover:text-wd-ink">{t('ideas.nav.breadcrumbHome')}</Link> <span aria-hidden>/</span> <span className="text-wd-ink">{t('ideas.nav.breadcrumbIdeas')}</span>
            </nav>
            <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-wd-pink-ink">{t('ideas.hero.eyebrow')}</p>
            <h1 className="mt-4 font-album text-[36px] font-semibold leading-[1.08] tracking-tight text-wd-ink sm:text-[52px] lg:text-[58px]" data-testid="ideas-h1">
              {t('ideas.hero.titleA')} <span className="italic text-wd-pink-ink">{t('ideas.hero.titleB')}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-wd-muted sm:text-[19px] lg:mx-0">{t('ideas.hero.sub')}</p>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link href="/register" className={btnPrimary} data-testid="ideas-cta-primary">{t('ideas.hero.ctaPrimary')} <ArrowRight className="h-5 w-5" /></Link>
              <a href="#ideas" className={btnSecondary}>{t('ideas.hero.ctaSecondary')}</a>
            </div>
            <p className="mt-5 inline-flex items-start gap-2 text-left text-[14px] font-medium text-wd-muted"><Check className="mt-0.5 h-4 w-4 shrink-0 text-wd-pink-ink" />{t('ideas.hero.note')}</p>
          </div>
          <div className="overflow-hidden rounded-[28px] border border-wd-border shadow-[0_24px_50px_rgba(31,32,40,0.14)]">
            <DemoPhotoImg photo={DEMO_PHOTOS.partyFriends} className="h-[260px] w-full sm:h-[340px]" sizes="(min-width:1024px) 520px, 100vw" priority />
          </div>
        </div>
      </section>

      {/* Concept */}
      <Section id="concept" tone="white">
        <SectionHead title={t('ideas.concept.title')} />
        <div className="mx-auto mt-6 max-w-3xl space-y-4 text-[16px] leading-relaxed text-wd-muted sm:text-[17px]">
          <p>{t('ideas.concept.p1')}</p>
          <p>{t('ideas.concept.p2')}</p>
          <p className="rounded-2xl bg-wd-active/60 px-5 py-4 text-[15px] font-medium text-wd-ink">{t('ideas.concept.note')}</p>
        </div>
      </Section>

      {/* How it works */}
      <Section id="steps">
        <SectionHead title={t('ideas.steps.title')} sub={t('ideas.steps.sub')} />
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {steps.map(({ k, Icon }, n) => (
            <li key={k} className="rounded-3xl border border-wd-border bg-white p-6" data-testid="ideas-step">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-wd-active text-wd-pink-ink"><Icon className="h-6 w-6" /></span>
              <h3 className="mt-4 text-[18px] font-bold text-wd-ink"><span className="mr-2 text-wd-pink-ink">{n + 1}.</span>{t(`ideas.steps.${k}.t`)}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-wd-muted">{t(`ideas.steps.${k}.d`)}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* The ideas */}
      <Section id="ideas" tone="blush">
        <SectionHead title={t('ideas.list.title')} sub={t('ideas.list.sub')} />
        <ul className="mt-12 grid gap-5 md:grid-cols-2" data-testid="ideas-list">
          {IDEAS.map((idea, n) => (
            <li key={idea.id} id={idea.id} className="scroll-mt-24 flex flex-col rounded-3xl border border-wd-border bg-white p-6 sm:p-7" data-testid="idea-card" data-idea={idea.id}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[21px] font-bold leading-tight text-wd-ink"><span className="mr-2 font-album text-wd-pink-ink">{String(n + 1).padStart(2, '0')}</span>{t(`ideas.items.${idea.id}.title`)}</h3>
                <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold', idea.difficulty === 'easy' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}
                  title={t('ideas.list.difficulty')} data-testid="idea-difficulty" data-level={idea.difficulty}>
                  <Gauge className="h-3.5 w-3.5" />{t('ideas.list.difficulty')}: {t(`ideas.list.${idea.difficulty}`)}
                </span>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-wd-ink/80">{t(`ideas.items.${idea.id}.text`)}</p>
              <dl className="mt-4 space-y-3 text-[14px] leading-relaxed">
                <div><dt className="flex items-center gap-1.5 font-bold text-wd-ink"><Clock className="h-4 w-4 text-wd-pink-ink" />{t('ideas.list.when')}</dt><dd className="mt-0.5 text-wd-muted">{t(`ideas.items.${idea.id}.when`)}</dd></div>
                <div><dt className="flex items-center gap-1.5 font-bold text-wd-ink"><Share2 className="h-4 w-4 text-wd-pink-ink" />{t('ideas.list.why')}</dt><dd className="mt-0.5 text-wd-muted">{t(`ideas.items.${idea.id}.why`)}</dd></div>
              </dl>
              <ul className="mt-auto flex flex-wrap items-center gap-1.5 pt-5" aria-label={t('ideas.list.fitsFor')}>
                {idea.occasions.map((o) => <li key={o} className="rounded-full bg-wd-active px-2.5 py-1 text-[12px] font-semibold text-wd-pink-ink">{t(`home.events.${o}.title`)}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      {/* By occasion */}
      <Section id="occasions" tone="white">
        <SectionHead title={t('ideas.occasions.title')} sub={t('ideas.occasions.sub')} />
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {IDEA_OCCASIONS.map((o) => (
            <article key={o} id={o} className="scroll-mt-24 rounded-3xl border border-wd-border bg-wd-bg p-6 sm:p-7" data-testid="idea-occasion" data-occasion={o}>
              <h3 className="font-album text-[24px] font-semibold leading-tight text-wd-ink">{t(`ideas.occasions.${o}.title`)}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-wd-muted">{t(`ideas.occasions.${o}.text`)}</p>
              <p className="mt-3 flex items-start gap-2 rounded-2xl bg-white px-4 py-3 text-[14px] font-medium text-wd-ink"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-wd-pink-ink" />{t(`ideas.occasions.${o}.tip`)}</p>
              {isOccasionId(o) && isPublished(o, locale as any) && (
                <Link href={pagePath(o, locale)} className="mt-4 inline-flex items-center gap-2 text-[15px] font-bold text-wd-pink-ink hover:underline" data-testid="idea-occasion-link">{t('occasions.common.seeOccasion')} <ArrowRight className="h-4 w-4" /></Link>
              )}
              <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.16em] text-wd-muted">{t('ideas.occasions.ideasLabel')}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {IDEAS_BY_OCCASION(o).slice(0, 5).map((id) => (
                  <li key={id}><a href={`#${id}`} className="inline-flex min-h-[40px] items-center rounded-full border border-wd-border bg-white px-4 text-[14px] font-semibold text-wd-ink transition hover:bg-wd-active">{t(`ideas.items.${id}.title`)}</a></li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      {/* Benefits */}
      <Section id="benefits">
        <SectionHead title={t('ideas.benefits.title')} />
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((k) => (
            <li key={k} className="rounded-3xl border border-wd-border bg-white p-6">
              <h3 className="text-[17px] font-bold text-wd-ink">{t(`ideas.benefits.${k}.t`)}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-wd-muted">{t(`ideas.benefits.${k}.d`)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* FAQ */}
      <Section id="faq" tone="white">
        <SectionHead title={t('ideas.faq.title')} />
        <div className="mx-auto mt-10 max-w-3xl space-y-3" data-testid="ideas-faq">
          {FAQ_KEYS.map((k) => (
            <details key={k} className="group rounded-2xl border border-wd-border bg-white px-5 py-1 open:shadow-[0_10px_30px_rgba(240,106,155,0.10)]">
              <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-wd-ink [&::-webkit-details-marker]:hidden">
                <h3 className="text-[16px] font-semibold">{t(`ideas.faq.${k}.q`)}</h3>
                <ChevronDown className="h-5 w-5 shrink-0 text-wd-pink-ink transition group-open:rotate-180" />
              </summary>
              <p className="pb-4 pr-8 text-[15px] leading-relaxed text-wd-muted">{t(`ideas.faq.${k}.a`)}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Final CTA */}
      <section className="px-5 pb-16 pt-4 sm:px-8 sm:pb-24">
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[36px] bg-gradient-to-br from-wd-pink to-[#F59AB9] px-6 py-14 text-center text-white sm:px-12 sm:py-20">
          <h2 className="relative font-album text-[30px] font-semibold leading-tight sm:text-[44px]">{t('ideas.cta.title')}</h2>
          <p className="relative mx-auto mt-4 max-w-md text-[17px] text-white/90">{t('ideas.cta.text')}</p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-white px-8 text-[16px] font-bold text-wd-pink-ink shadow-lg transition hover:bg-wd-bg" data-testid="ideas-final-cta">
              {t('ideas.cta.button')} <ArrowRight className="h-5 w-5" />
            </Link>
            <Link href={home} className="inline-flex min-h-[54px] items-center justify-center rounded-2xl border border-white/60 px-8 text-[16px] font-semibold text-white transition hover:bg-white/10">{t('ideas.cta.home')}</Link>
          </div>
        </div>
      </section>

      <Footer base={home} />
    </main>
  )
}
