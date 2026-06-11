'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useI18n } from '@/lib/i18n'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Wedding Edition · "Oggi Sposi" photo frame
// Renderizza una foto ospite dentro una cornice photobooth matrimonio
// elegante (sfondo avorio, bordo rosa/tortora, titolo OGGI SPOSI, nomi
// degli sposi e data). NON modifica la foto originale: la cornice è solo
// resa UI/CSS al momento della visualizzazione.
// ════════════════════════════════════════════════════════════════

function formatWeddingDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

/** Piccolo ornamento decorativo: linea sottile + diamante centrale. */
function FrameOrnament({ color = '#8F1D2C' }: { color?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 w-full" aria-hidden>
      <span className="h-px flex-1 max-w-[40%]" style={{ background: `linear-gradient(to right, transparent, ${color}55)` }} />
      <span className="rotate-45 inline-block" style={{ width: 6, height: 6, background: color, opacity: 0.7 }} />
      <span className="h-px flex-1 max-w-[40%]" style={{ background: `linear-gradient(to left, transparent, ${color}55)` }} />
    </div>
  )
}

export interface WeddingPhotoFrameProps {
  url: string | null | undefined
  caption?: string | null
  /** Nomi sposi (couple_names) oppure, in fallback, il nome evento. */
  coupleNames?: string | null
  /** Data matrimonio in formato ISO. */
  weddingDate?: string | null
  /** Evidenzia la foto come "in evidenza". */
  featured?: boolean
  /** screen = TV/proiettore (grande) · compact = dashboard/album. */
  variant?: 'screen' | 'compact'
  className?: string
}

export function WeddingPhotoFrame({
  url,
  caption,
  coupleNames,
  weddingDate,
  featured = false,
  variant = 'screen',
  className = '',
}: WeddingPhotoFrameProps) {
  const { t } = useI18n()
  const date = formatWeddingDate(weddingDate)
  const isScreen = variant === 'screen'

  const titleClass = isScreen
    ? 'text-sm sm:text-base tracking-[0.42em]'
    : 'text-[10px] tracking-[0.32em]'
  const namesClass = isScreen
    ? 'text-2xl sm:text-3xl'
    : 'text-base'
  const dateClass = isScreen
    ? 'text-xs sm:text-sm tracking-[0.3em]'
    : 'text-[10px] tracking-[0.22em]'
  const pad = isScreen ? 'p-5 sm:p-6' : 'p-3'
  const gap = isScreen ? 'gap-4 sm:gap-5' : 'gap-2.5'

  return (
    <figure
      className={`relative flex flex-col items-center ${gap} rounded-2xl border ${pad} ${
        featured ? 'ring-2 ring-[#C49A5B]/50' : ''
      } ${className}`}
      style={{
        background: '#FFFAF5',
        borderColor: featured ? '#C49A5B' : '#E8B7C8',
        boxShadow: isScreen
          ? '0 18px 50px rgba(143,29,44,0.18), 0 3px 10px rgba(143,29,44,0.10)'
          : '0 4px 16px rgba(143,29,44,0.08)',
      }}
    >
      {featured && (
        <div className="absolute -top-2.5 right-3 bg-[#C49A5B] text-white px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] shadow-md">
          ★
        </div>
      )}

      {/* Titolo OGGI SPOSI con ornamenti */}
      <div className="w-full flex flex-col items-center gap-1.5">
        <FrameOrnament />
        <p
          className={`font-wedding-cinzel font-semibold uppercase text-[#8F1D2C] ${titleClass} leading-none text-center`}
        >
          {t('wedding.photoFrameTitle')}
        </p>
      </div>

      {/* Foto al centro con bordo interno leggero */}
      <div
        className="w-full overflow-hidden rounded-lg border"
        style={{ borderColor: '#E8DED6' }}
      >
        {url ? (
          <img
            src={url}
            alt={caption ?? ''}
            className={`w-full object-cover ${isScreen ? 'aspect-[4/3]' : 'aspect-square'}`}
          />
        ) : (
          <div className={`w-full ${isScreen ? 'aspect-[4/3]' : 'aspect-square'} flex items-center justify-center text-[#B8A89A]`}>
            ◌
          </div>
        )}
      </div>

      {/* Nomi sposi + data */}
      <figcaption className="w-full flex flex-col items-center gap-1 text-center">
        {coupleNames && (
          <p className={`font-wedding text-[#741625] font-semibold leading-tight ${namesClass}`}>
            {coupleNames}
          </p>
        )}
        {date && (
          <p className={`uppercase text-[#B8A89A] tabular-nums ${dateClass}`}>
            {date}
          </p>
        )}
        <FrameOrnament color="#B8A89A" />
        {caption && isScreen && (
          <p className="font-wedding italic text-[#6F6260] text-sm mt-1 line-clamp-2">“{caption}”</p>
        )}
      </figcaption>
    </figure>
  )
}

// ════════════════════════════════════════════════════════════════
// WeddingPhotoSlideshow — Screen Mode (TV / LED Wall / proiettore)
// Mostra UNA foto approvata alla volta, grande e centrale, dentro la
// cornice "Oggi Sposi", con rotazione automatica random e crossfade
// elegante. Nessuna UI tecnica, nessun titolo "Ultime foto".
// ════════════════════════════════════════════════════════════════

export interface SlideshowPhoto {
  id: string
  url?: string | null
  caption?: string | null
  is_featured?: boolean
}

export interface WeddingPhotoSlideshowProps {
  photos: SlideshowPhoto[]
  coupleNames?: string | null
  weddingDate?: string | null
  /** Intervallo di rotazione in ms (default 8000). */
  intervalMs?: number
  className?: string
}

export function WeddingPhotoSlideshow({
  photos,
  coupleNames,
  weddingDate,
  intervalMs = 8000,
  className = '',
}: WeddingPhotoSlideshowProps) {
  const { t } = useI18n()
  const [currentIndex, setCurrentIndex] = useState(0)
  const count = photos.length

  // Se l'elenco si accorcia (foto rimossa), mantieni l'indice valido.
  useEffect(() => {
    if (currentIndex >= count && count > 0) setCurrentIndex(0)
  }, [count, currentIndex])

  // Rotazione automatica: random senza ripetere subito la stessa foto.
  useEffect(() => {
    if (count <= 1) return
    const timer = setInterval(() => {
      setCurrentIndex((prev) => {
        let next = prev
        while (next === prev) {
          next = Math.floor(Math.random() * count)
        }
        return next
      })
    }, intervalMs)
    return () => clearInterval(timer)
  }, [count, intervalMs])

  // Placeholder elegante quando non ci sono foto approvate.
  if (count === 0) {
    return (
      <div className={`flex flex-col items-center justify-center text-center px-8 ${className}`}>
        <div className="rounded-full border border-wedding-gold/30 px-10 py-12 bg-black/20 backdrop-blur-sm">
          <p className="font-wedding text-3xl sm:text-4xl italic text-wedding-ivory/70 leading-snug max-w-xl">
            {t('wedding.photoSlideshowEmpty')}
          </p>
        </div>
      </div>
    )
  }

  const safeIndex = Math.min(currentIndex, count - 1)
  const photo = photos[safeIndex]

  return (
    <div className={`relative flex items-center justify-center w-full ${className}`}>
      <AnimatePresence mode="wait">
        <motion.div
          key={photo.id}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 1.1, ease: 'easeInOut' }}
          className="w-full max-w-[20rem] sm:max-w-[26rem]"
        >
          <WeddingPhotoFrame
            url={photo.url}
            caption={photo.caption}
            coupleNames={coupleNames}
            weddingDate={weddingDate}
            featured={photo.is_featured}
            variant="screen"
          />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

