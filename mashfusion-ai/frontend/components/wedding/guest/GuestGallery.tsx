'use client'
import { useEffect, useRef, useState } from 'react'
import { Play, ImagePlus, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { livePhotos } from '@/lib/api'
import { useGuestGallery } from '@/lib/events/useGuestGallery'
import { isVideoMedia, formatDuration } from '@/lib/media/mediaTypes'
import { MediaLightbox } from '@/components/media/MediaLightbox'

/**
 * MIOLOVE "Galleria condivisa" on the guest page: a two-column grid of thumbnails (small copies only: the 1920 px image / the video file is fetched when a
 * media is opened), loaded progressively as the guest scrolls. Tap = full screen, swipe or arrows = the other media, videos play in the viewer.
 * The add button stays pinned at the bottom of the screen. Rendered only while the owner's switch is on; the server enforces the same switch.
 */
export function GuestGallery({ slug, uploadHref }: { slug: string; uploadHref: string | null }) {
  const { t } = useI18n()
  const { items, state, done, loadingMore, more } = useGuestGallery(slug, true)
  const [open, setOpen] = useState<number | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  // Next page when the end of the grid comes near.
  useEffect(() => {
    const el = sentinel.current
    if (!el || done || state !== 'ready') return
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) void more() }, { rootMargin: '600px 0px' })
    io.observe(el); return () => io.disconnect()
  }, [done, state, more, items.length])

  if (state === 'denied') return null                      // switched off while the page was open: nothing to show

  return (
    <section className={uploadHref ? 'mt-10 pb-28' : 'mt-10'} aria-label={t('guestAlbum.gallery.title')} data-testid="guest-gallery">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-wd-muted">{t('guestAlbum.gallery.title')}</h2>
      {state === 'loading' && <div className="flex justify-center py-10 text-wd-pink" role="status" aria-label={t('common.loading')}><Loader2 className="h-6 w-6 animate-spin" /></div>}
      {state === 'error' && (
        <div className="rounded-[18px] border border-wd-border bg-white p-4 text-center text-[14px] text-wd-muted" data-testid="guest-gallery-error">
          <p>{t('guestAlbum.gallery.error')}</p>
          <button type="button" onClick={() => void more()} className="mt-2 min-h-[44px] rounded-xl px-4 text-[14px] font-semibold text-wd-pink hover:bg-wd-active">{t('media.guest.retry')}</button>
        </div>
      )}
      {state === 'ready' && items.length === 0 && <p className="rounded-[18px] border border-wd-border bg-white p-5 text-center text-[14px] text-wd-muted" data-testid="guest-gallery-empty">{t('guestAlbum.gallery.empty')}</p>}
      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2" data-testid="guest-gallery-grid">
          {items.map((p, i) => {
            const video = isVideoMedia(p)
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setOpen(i)} data-testid="guest-gallery-item" data-kind={video ? 'video' : 'photo'}
                  aria-label={t(video ? 'media.gallery.openVideo' : 'media.gallery.openPhoto')}
                  className="relative block aspect-square w-full overflow-hidden rounded-xl bg-wd-active focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink">
                  {(p.thumb_url ?? p.url) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={(p.thumb_url ?? p.url)!} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
                  )}
                  {video && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white"><Play className="h-5 w-5 translate-x-px" fill="currentColor" /></span>
                      {p.duration_sec ? <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">{formatDuration(p.duration_sec)}</span> : null}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {!done && state === 'ready' && <div ref={sentinel} className="flex h-16 items-center justify-center text-wd-pink">{loadingMore && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}</div>}

      {uploadHref && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-wd-bg via-wd-bg/95 to-transparent px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6" data-testid="guest-gallery-addbar">
          <a href={uploadHref} data-testid="guest-gallery-add"
            className="pointer-events-auto mx-auto flex min-h-[56px] w-full max-w-[520px] items-center justify-center gap-3 rounded-[20px] bg-wd-pink px-6 text-[17px] font-semibold text-white shadow-[0_12px_30px_rgba(240,106,155,0.4)] transition active:scale-[0.99] hover:bg-wd-pink-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/50">
            <ImagePlus className="h-5 w-5" />{t('guestAlbum.gallery.add')}
          </a>
        </div>
      )}
      {open !== null && <MediaLightbox items={items} index={Math.min(open, items.length - 1)} onIndex={setOpen} onClose={() => setOpen(null)} resolveUrl={livePhotos.galleryMediaUrl} />}
    </section>
  )
}
