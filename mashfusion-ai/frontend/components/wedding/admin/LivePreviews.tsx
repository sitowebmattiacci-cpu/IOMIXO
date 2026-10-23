'use client'
import { useEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ScreenBackgroundButton } from './ScreenBackgroundPicker'

/**
 * Faithful previews of a MIOLOVE album: they load the REAL public pages (/live/[slug] for the guest phone, /screen/[slug] for the monitor) inside a
 * non-interactive frame scaled down to fit. Nothing is re-implemented here, so what the owner sees is exactly what guests / the TV show (language,
 * occasion, branding, photos, trial state included) and it updates in real time through the same Firestore listeners.
 * The pages allow same-origin framing only (next.config.js); the frames are inert (no pointer events, not focusable, hidden from assistive tech).
 */
function ScaledFrame({ src, title, width, height, testId, className }: { src: string; title: string; width: number; height: number; testId: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setScale(el.clientWidth / width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={box} className={cn('relative w-full overflow-hidden', className)} style={{ aspectRatio: `${width} / ${height}` }} data-testid={testId}>
      {scale > 0 && (
        <iframe
          src={src} title={title} loading="lazy" tabIndex={-1} aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
          style={{ width, height, transform: `scale(${scale})` }}
        />
      )}
    </div>
  )
}

/** The guest's phone: the real /live/[slug] at 390×800. */
export function PhonePreview({ slug }: { slug: string }) {
  const { t } = useI18n()
  return (
    <div className="mx-auto w-[240px]" data-testid="wd-guest-preview">
      <div className="overflow-hidden rounded-[34px] border-[5px] border-wd-ink bg-wd-bg">
        <ScaledFrame src={`/live/${slug}`} title={t('wdAdmin.home.guestPreview')} width={390} height={800} testId="preview-phone-frame" />
      </div>
    </div>
  )
}

/** The big screen: the real /screen/[slug] at 1280×720. */
export function MonitorPreview({ slug, live, sessionId, screenConfig }: { slug: string; live: boolean; sessionId?: string; screenConfig?: unknown }) {
  const { t } = useI18n()
  return (
    <div className="min-w-0" data-testid="wd-screen-preview">
      <h2 className="text-base font-bold text-wd-ink">{t('wdAdmin.home.screenPreview')}</h2>
      <p className="mb-3 mt-1 text-[13px] text-wd-muted">{t('wdAdmin.home.screenPreviewDesc')}</p>
      <div className="relative overflow-hidden rounded-2xl bg-black shadow-[0_18px_40px_rgba(31,32,40,0.28)] ring-1 ring-black/10">
        <ScaledFrame src={`/screen/${slug}`} title={t('wdAdmin.home.screenPreview')} width={1280} height={720} testId="preview-monitor-frame" />
        {live && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">
            <span className="h-2 w-2 rounded-full bg-red-500" /> {t('wdAdmin.home.live')}
          </span>
        )}
      </div>
      <a href={`/screen/${slug}`} target="_blank" rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-wd-border bg-white px-3 py-1.5 text-xs font-semibold text-wd-ink hover:bg-wd-active">
        <Maximize2 className="h-3 w-3" /> {t('wdAdmin.home.fullscreen')}
      </a>
      {sessionId && <ScreenBackgroundButton sessionId={sessionId} screenConfig={screenConfig} />}
    </div>
  )
}
