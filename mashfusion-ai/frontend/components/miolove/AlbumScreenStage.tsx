'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { SlideVideo } from '@/components/media/SlideVideo'
import { useSlideshow } from '@/lib/useSlideshow'
import type { SlideshowPhoto } from '@/components/wedding/WeddingPhotoFrame'

/**
 * The big screen of a MIOLOVE album: ONE photo or video fills the whole display (no card inside a card), a soft blurred copy of the same picture
 * fills what a portrait photo leaves empty, and the only overlay is the event title and date in the lower corner (plus the MIOLOVE mark while the
 * album is on the free trial). Used by the real /screen/[slug] and, through it, by the owner's screen preview.
 */
export function AlbumScreenSlide({ url, poster, mediaType, onVideoDone }: { url: string; poster?: string | null; mediaType?: string; onVideoDone?: () => void }) {
  const video = mediaType === 'video'
  return (
    <div className="absolute inset-0 overflow-hidden bg-black" data-testid="album-screen-slide">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={(video ? poster : url) ?? ''} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />
      {video
        ? <SlideVideo src={url} poster={poster} onDone={onVideoDone ?? (() => {})} className="relative h-full w-full object-contain" />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={url} alt="" className="relative h-full w-full object-contain" />}
    </div>
  )
}

export function AlbumScreenOverlay({ title, date, mark }: { title: string; date?: string | null; mark?: string }) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[26vh] bg-gradient-to-t from-black/70 via-black/25 to-transparent" aria-hidden />
      <div className="pointer-events-none absolute bottom-[3.2vmin] left-[3.6vmin] right-[3.6vmin] flex items-end justify-between gap-6" data-testid="album-screen-overlay">
        <div className="min-w-0">
          <p className="truncate font-wedding text-[4.4vmin] font-semibold leading-none text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]">{title}</p>
          {date && <p className="mt-[0.9vmin] text-[1.9vmin] font-medium uppercase tracking-[0.22em] text-white/80">{date}</p>}
        </div>
        {mark && <p className="shrink-0 text-[1.7vmin] font-semibold uppercase tracking-[0.3em] text-white/70">{mark}</p>}
      </div>
    </>
  )
}

export function AlbumScreenStage({ photos, title, date, mark, intervalMs = 8000 }: { photos: SlideshowPhoto[]; title: string; date?: string | null; mark?: string; intervalMs?: number }) {
  const { photo, next, cycle } = useSlideshow(photos, intervalMs)
  return (
    <div className="fixed inset-0 z-20 bg-black" data-testid="album-screen">
      <AnimatePresence>
        {photo && (
          <motion.div key={photo.media_type === 'video' ? `${photo.id}:${cycle}` : photo.id} className="absolute inset-0"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.1, ease: 'easeInOut' }}>
            <AlbumScreenSlide url={photo.url as string} poster={photo.thumb_url} mediaType={photo.media_type} onVideoDone={next} />
          </motion.div>
        )}
      </AnimatePresence>
      <AlbumScreenOverlay title={title} date={date} mark={mark} />
    </div>
  )
}
