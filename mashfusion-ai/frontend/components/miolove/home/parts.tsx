'use client'
import type { ReactNode } from 'react'
import { Camera } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { DEMO_EVENT, demoFallbackSrc, demoSrcSet, type DemoPhoto } from '@/lib/miolove/demoMedia'
import { cn } from '@/lib/utils'

/**
 * A demo photograph (see lib/miolove/demoMedia.ts): AVIF, then WebP, from the pre-generated copies (the Next.js image optimizer is not available on App
 * Hosting). `sizes` tells the browser how wide it is drawn, so it never downloads more than needed. Below the fold it is lazy; `eager` loads it at once
 * (normal priority), `priority` also marks it high priority: only for an image that is the largest thing on screen.
 */
export function DemoPhotoImg({ photo, className, sizes, priority = false, eager = false }: { photo: DemoPhoto; className?: string; sizes: string; priority?: boolean; eager?: boolean }) {
  const { t } = useI18n()
  return (
    <picture>
      <source type="image/avif" srcSet={demoSrcSet(photo, 'avif')} sizes={sizes} />
      <source type="image/webp" srcSet={demoSrcSet(photo, 'webp')} sizes={sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={demoFallbackSrc(photo)} width={photo.width} height={photo.height} alt={t(photo.altKey)} draggable={false} decoding="async"
        loading={priority || eager ? 'eager' : 'lazy'} {...(priority ? { fetchPriority: 'high' as const } : {})}
        style={{ objectPosition: photo.focus }} className={cn('select-none object-cover', className)} />
    </picture>
  )
}

export function SectionHead({ eyebrow, title, sub, center = true }: { eyebrow?: string; title: string; sub?: string; center?: boolean }) {
  return (
    <header className={cn('mx-auto max-w-2xl', center && 'text-center')}>
      {eyebrow && <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-wd-pink">{eyebrow}</p>}
      <h2 className="mt-3 font-album text-[30px] font-semibold leading-[1.12] tracking-tight text-wd-ink sm:text-[40px]">{title}</h2>
      {sub && <p className="mt-4 text-[16px] leading-relaxed text-wd-muted sm:text-[17px]">{sub}</p>}
    </header>
  )
}

export function Section({ id, children, tone = 'plain', className }: { id?: string; children: ReactNode; tone?: 'plain' | 'white' | 'blush'; className?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-20 py-16 sm:py-24', tone === 'white' && 'bg-white', tone === 'blush' && 'bg-wd-active/60', className)}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">{children}</div>
    </section>
  )
}

/**
 * The guest's phone for the sample event: cover photo, event title + date, the upload button and a strip of the gallery. Same structure as the real
 * guest page (title, date, one clear action), built from the demo photos.
 */
export function PhoneMock({ title, date, cta, className, photos = DEMO_EVENT.photos, eager = false }: { title: string; date: string; cta: string; className?: string; photos?: readonly DemoPhoto[]; eager?: boolean }) {
  return (
    <div className={cn('relative aspect-[9/18.5] w-full overflow-hidden rounded-[34px] border-[6px] border-wd-ink bg-wd-bg shadow-[0_30px_60px_rgba(240,106,155,0.28)]', className)}>
      <div className="relative h-[56%] w-full">
        <DemoPhotoImg photo={photos[0]} className="h-full w-full" sizes="250px" eager={eager} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="absolute left-1/2 top-2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-white/60" />
      </div>
      <div className="-mt-6 relative rounded-t-[26px] bg-wd-bg px-3 pt-4">
        <p className="text-center font-album text-[17px] font-semibold leading-tight text-wd-ink">{title}</p>
        <p className="mt-0.5 text-center text-[11px] font-medium text-wd-muted">{date}</p>
        <span className="mt-3 flex h-10 items-center justify-center gap-1.5 rounded-xl bg-wd-pink text-[12px] font-semibold text-white shadow-[0_8px_18px_rgba(240,106,155,0.35)]"><Camera className="h-4 w-4" />{cta}</span>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {photos.slice(1, 4).map((p, i) => <DemoPhotoImg key={i} photo={p} className="aspect-[3/4] w-full rounded-lg" sizes="80px" />)}
        </div>
      </div>
    </div>
  )
}

/** The big screen of the sample event: one photo full-bleed, event title small in the corner (same layout as the real /screen of an album). */
export function ScreenMock({ photo, title, date, className }: { photo: DemoPhoto; title: string; date?: string; className?: string }) {
  return (
    <div className={cn('relative aspect-video overflow-hidden rounded-xl border-[6px] border-wd-ink bg-black shadow-[0_24px_50px_rgba(31,32,40,0.25)]', className)}>
      <DemoPhotoImg photo={photo} className="absolute inset-0 h-full w-full" sizes="(min-width:1024px) 400px, 90vw" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-4 pb-3 pt-10 sm:px-6 sm:pb-4">
        <p className="font-album text-[15px] font-semibold leading-none text-white sm:text-[22px]">{title}</p>
        {date && <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/75 sm:text-[12px]">{date}</p>}
      </div>
    </div>
  )
}
