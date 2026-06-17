'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, Star } from 'lucide-react'
import { useSlideshow, SlideItem } from '@/lib/useSlideshow'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Party Mode · Live Booth slideshow (Screen Mode / TV)
// Slideshow professionale a foto singola: random "shuffle bag" senza
// ripetizioni ravvicinate, preload della prossima immagine e crossfade
// morbido. Nessun riquadro bianco: la foto cambia solo quando la
// successiva è già caricata (vedi lib/useSlideshow).
// ════════════════════════════════════════════════════════════════

export interface PartySlidePhoto extends SlideItem {
  caption?: string | null
  is_featured?: boolean
}

export interface PartyPhotoSlideshowProps {
  photos: PartySlidePhoto[]
  /** Intervallo di rotazione in ms (default 6000). */
  intervalMs?: number
  /** Nome evento mostrato nella cornice (solo Party Mode). */
  eventName?: string | null
  className?: string
}

export function PartyPhotoSlideshow({
  photos,
  intervalMs = 6000,
  eventName,
  className = '',
}: PartyPhotoSlideshowProps) {
  const { photo, hasPhotos } = useSlideshow(photos, intervalMs)

  // Nessuna foto approvata → placeholder elegante (Live Booth è attivo).
  if (!hasPhotos) {
    return (
      <div
        className={`rounded-2xl border-2 border-dashed border-[#FF3D8A]/30 bg-white/[0.02] h-full flex flex-col items-center justify-center text-center px-6 py-16 ${className}`}
      >
        <Camera className="h-14 w-14 text-[#FF3D8A]/40 mb-4" />
        <p className="text-2xl font-bold text-white mb-2">Photo Moment in arrivo!</p>
        <p className="text-sm text-white/50">
          Scansiona il QR e scatta la prima foto della serata
        </p>
      </div>
    )
  }

  // Le due immagini sono impilate nella stessa cella grid → crossfade morbido
  // senza riquadro bianco (la foto entrante è già decodificata dal preload).
  return (
    <div className={`relative grid place-items-center w-full h-full min-h-0 ${className}`}>
      <AnimatePresence>
        {photo && (
          <motion.div
            key={photo.id}
            style={{ gridArea: '1 / 1' }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 1.0, ease: 'easeInOut' }}
            className="relative w-full h-full flex items-center justify-center"
          >
            {/* Cornice evento: card scura con accento neon controllato + nome evento */}
            <div className="relative rounded-3xl bg-black/40 border border-white/10 p-3 sm:p-4 shadow-[0_0_40px_rgba(255,61,138,0.2)] flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url as string}
                alt={photo.caption ?? ''}
                className="w-auto h-auto max-w-[62vw] max-h-[40vh] sm:max-w-[36vw] md:max-w-[26vw] lg:max-h-[38vh] object-contain rounded-2xl"
              />
              {eventName && (
                <p className="mt-3 text-center text-sm sm:text-base font-black uppercase tracking-[0.3em] text-[#FF7AB6]">
                  {eventName}
                </p>
              )}
              {photo.is_featured && (
                <div className="absolute top-3 right-3 bg-[#FF3D8A] text-white px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-lg">
                  <Star className="h-3 w-3 fill-current" /> In evidenza
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
