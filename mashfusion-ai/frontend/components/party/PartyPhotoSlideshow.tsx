'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera } from 'lucide-react'
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
  className = '',
}: PartyPhotoSlideshowProps) {
  const { photo, hasPhotos } = useSlideshow(photos, intervalMs)

  // Nessuna foto approvata → placeholder elegante (Live Booth è attivo).
  if (!hasPhotos) {
    return (
      <div
        className={`rounded-2xl border-2 border-dashed border-[#FF3D8A]/20 bg-white/[0.02] h-full flex flex-col items-center justify-center text-center px-6 py-16 ${className}`}
      >
        <Camera className="h-14 w-14 text-[#FF3D8A]/40 mb-4" />
        <p className="text-2xl font-bold text-white">Le foto degli ospiti appariranno qui</p>
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
            className="flex items-center justify-center"
          >
            {/* Foto protagonista: contenuta, centrata, intera. Nessuna cornice/overlay,
                dimensione massima controllata così non diventa gigante su TV/proiettore. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url as string}
              alt={photo.caption ?? ''}
              className="w-auto h-auto max-w-[68vw] md:max-w-[340px] lg:max-w-[380px] max-h-[42vh] lg:max-h-[380px] object-contain rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
