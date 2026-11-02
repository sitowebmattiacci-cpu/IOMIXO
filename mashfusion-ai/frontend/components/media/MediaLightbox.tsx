'use client'
import { useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { livePhotos, type LivePhoto } from '@/lib/api'
import { displayGuestName } from '@/lib/media/guestName'
import { isVideoMedia } from '@/lib/media/mediaTypes'

/**
 * Full-size viewer of an album media: the optimized image of a photo, a real video player (controls, inline on mobile) for a video.
 * Keyboard: Esc closes, arrows move. The download button gives the ORIGINAL (the caller decides how).
 */
export function MediaLightbox({ items, index, onIndex, onClose, onDownload, resolveUrl }: {
  items: LivePhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void; onDownload?: (p: LivePhoto) => void
  /** How the big file is resolved when only its path is known (default: the owner's). The guest gallery passes its own. */
  resolveUrl?: (path: string) => Promise<string>
}) {
  const { t } = useI18n()
  const item = items[index]
  const [failed, setFailed] = useState(false)
  // The owner gallery resolves the big file only now (lib/firebase/repositories/photoRepository.ts → `url_path`): the grid never paid for it.
  const [shown, setShown] = useState<string | null>(item?.url ?? null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    setFailed(false); setShown(item?.url ?? null)
    if (!item || item.url || !item.url_path) return
    let alive = true
    const load = resolveUrl ?? livePhotos.originalUrl
    load(item.url_path).then((u) => alive && setShown(u)).catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [item?.id])    // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [index, items.length, onIndex, onClose])
  // Phones: a horizontal swipe moves to the next / previous media (a mostly vertical or short gesture is ignored, so scrolling a video's controls still works).
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { const t0 = e.touches[0]; touch.current = e.touches.length === 1 && t0 ? { x: t0.clientX, y: t0.clientY } : null }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s0 = touch.current, t1 = e.changedTouches[0]; touch.current = null
    if (!s0 || !t1) return
    const dx = t1.clientX - s0.x, dy = t1.clientY - s0.y
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0 && index < items.length - 1) onIndex(index + 1)
    else if (dx > 0 && index > 0) onIndex(index - 1)
  }
  if (!item) return null
  const video = isVideoMedia(item)
  const btn = 'flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white'
  return (
    <div role="dialog" aria-modal="true" aria-label={item.filename ?? item.guest_name ?? ''} data-testid="media-lightbox" data-media={video ? 'video' : 'photo'}
      className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 p-3 sm:p-4" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 truncate text-sm font-semibold text-white/90">{displayGuestName(item.guest_name, t('weddingPanels.anonymous'))}</p>
        <div className="flex items-center gap-2">
          {onDownload && (
            <button type="button" onClick={() => onDownload(item)} data-testid="media-download-original" className={`${btn} !w-auto gap-2 px-4 text-sm font-semibold`}>
              <Download className="h-4 w-4" /><span className="hidden sm:inline">{t('media.gallery.downloadOriginal')}</span>
            </button>
          )}
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('media.gallery.close')} data-testid="media-lightbox-close" className={btn}><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-14" onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {index > 0 && <button type="button" onClick={() => onIndex(index - 1)} aria-label={t('media.gallery.prev')} className={`${btn} absolute left-2 top-1/2 z-10 -translate-y-1/2`}><ChevronLeft className="h-5 w-5" /></button>}
        {video ? (
          failed ? (
            <div className="max-w-sm rounded-2xl bg-white/10 p-6 text-center text-sm text-white" data-testid="media-video-unsupported">
              <p className="mb-4">{t('media.gallery.videoUnsupported')}</p>
              {onDownload && <button type="button" onClick={() => onDownload(item)} className="rounded-full bg-white px-5 py-2.5 font-semibold text-black">{t('media.gallery.downloadOriginal')}</button>}
            </div>
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video key={`${item.id}:${shown ? 'r' : 'w'}`} data-testid="media-video" src={shown ?? undefined} poster={item.thumb_url ?? undefined} controls playsInline autoPlay preload="auto"
              onError={() => setFailed(true)} className="max-h-full max-w-full rounded-lg bg-black object-contain" />
          )
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={item.id} data-testid="media-photo" src={shown ?? item.thumb_url ?? undefined} alt={item.caption ?? ''} className="max-h-full max-w-full rounded-lg object-contain" />
        )}
        {index < items.length - 1 && <button type="button" onClick={() => onIndex(index + 1)} aria-label={t('media.gallery.next')} className={`${btn} absolute right-2 top-1/2 z-10 -translate-y-1/2`}><ChevronRight className="h-5 w-5" /></button>}
      </div>
    </div>
  )
}
