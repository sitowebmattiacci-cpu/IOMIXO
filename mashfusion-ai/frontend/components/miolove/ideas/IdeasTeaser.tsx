'use client'
import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { DEMO_PHOTOS } from '@/lib/miolove/demoMedia'
import { IDEAS } from '@/lib/miolove/ideas'
import { ideasPath } from '@/lib/miolove/paths'
import { DemoPhotoImg, Section } from '../home/parts'

/** Home teaser of the "Idee per usare MIOLOVE" guide: a photo, a line of pitch, three example ideas and the way in. */
export function IdeasTeaser() {
  const { t, locale } = useI18n()
  const href = ideasPath(locale)
  return (
    <Section id="ideas" tone="white">
      <div className="grid items-center gap-8 overflow-hidden rounded-[32px] border border-wd-border bg-wd-bg lg:grid-cols-[1fr_1.05fr]" data-testid="ideas-teaser">
        <DemoPhotoImg photo={DEMO_PHOTOS.partyFriends} className="h-64 w-full sm:h-80 lg:h-full lg:min-h-[360px]" sizes="(min-width:1024px) 520px, 100vw" />
        <div className="px-6 pb-8 pt-2 sm:px-10 lg:py-10 lg:pl-2">
          <p className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.22em] text-wd-pink-ink"><Sparkles className="h-3.5 w-3.5" />{t('ideas.teaser.eyebrow')}</p>
          <h2 className="mt-3 font-album text-[30px] font-semibold leading-[1.12] tracking-tight text-wd-ink sm:text-[38px]">{t('ideas.teaser.title')}</h2>
          <p className="mt-4 text-[16px] leading-relaxed text-wd-muted sm:text-[17px]">{t('ideas.teaser.text')}</p>
          <ul className="mt-5 flex flex-wrap gap-2" aria-label={t('ideas.list.title')}>
            {IDEAS.slice(0, 4).map((i) => (
              <li key={i.id}><Link href={`${href}#${i.id}`} className="inline-flex min-h-[40px] items-center rounded-full border border-wd-border bg-white px-4 text-[14px] font-semibold text-wd-ink transition hover:bg-wd-active">{t(`ideas.items.${i.id}.title`)}</Link></li>
            ))}
          </ul>
          <Link href={href} data-testid="ideas-teaser-cta" aria-label={t('ideas.teaser.moreAria')}
            className="mt-7 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-wd-pink px-7 text-[16px] font-semibold text-wd-ink shadow-[0_10px_30px_rgba(240,106,155,0.35)] transition hover:bg-wd-pink-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/50">
            {t('ideas.teaser.button')} <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </Section>
  )
}
