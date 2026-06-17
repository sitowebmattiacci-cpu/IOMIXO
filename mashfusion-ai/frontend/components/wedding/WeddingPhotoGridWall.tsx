'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useI18n } from '@/lib/i18n'
import { useGridSlideshow } from '@/lib/useGridSlideshow'
import { WeddingPhotoSlideshow, SlideshowPhoto } from './WeddingPhotoFrame'
import type { LiveBoothLayout } from '@/components/party/PartyPhotoGridWall'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Wedding Edition · Live Booth photo WALL (Screen Mode / TV)
// Griglia elegante stile album matrimonio: tessere avorio con bordo
// rosa/tortora/oro, animazioni lente e raffinate. Cambia una cella
// alla volta con la logica anti-ripetizione condivisa.
// ════════════════════════════════════════════════════════════════

const WEDDING_CELLS = 6

function formatWeddingDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

function FrameOrnament() {
  return (
    <div className="flex items-center justify-center gap-2 w-full" aria-hidden>
      <span className="h-px flex-1 max-w-[80px]" style={{ background: 'linear-gradient(to right, transparent, rgba(196,154,91,0.5))' }} />
      <span className="rotate-45 inline-block" style={{ width: 6, height: 6, background: '#C49A5B', opacity: 0.8 }} />
      <span className="h-px flex-1 max-w-[80px]" style={{ background: 'linear-gradient(to left, transparent, rgba(196,154,91,0.5))' }} />
    </div>
  )
}

export interface WeddingPhotoGridWallProps {
  photos: SlideshowPhoto[]
  coupleNames?: string | null
  weddingDate?: string | null
  /** Numero massimo di celle (default 6 → 3x2). */
  cells?: number
  /** Intervallo di cambio cella in ms (default 5000, più lento e raffinato). */
  intervalMs?: number
  className?: string
}

export function WeddingPhotoGridWall({
  photos,
  coupleNames,
  weddingDate,
  cells = WEDDING_CELLS,
  intervalMs = 5000,
  className = '',
}: WeddingPhotoGridWallProps) {
  const { t } = useI18n()
  const { grid, hasPhotos } = useGridSlideshow(photos, cells, intervalMs)
  const date = formatWeddingDate(weddingDate)

  if (!hasPhotos) {
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

  return (
    <div
      className={`flex flex-col w-full rounded-2xl border p-5 sm:p-6 ${className}`}
      style={{ background: '#FFFAF5', borderColor: '#E8B7C8', boxShadow: '0 18px 50px rgba(143,29,44,0.18)' }}
    >
      <div className="flex flex-col items-center gap-1.5 mb-4 shrink-0">
        <FrameOrnament />
        <p className="font-wedding-cinzel font-semibold uppercase text-[#8F1D2C] text-sm sm:text-base tracking-[0.36em] leading-none text-center">
          {t('wedding.photoGridTitle')}
        </p>
        {coupleNames && (
          <p className="font-wedding text-[#741625] font-semibold text-lg sm:text-xl leading-tight text-center mt-0.5">
            {coupleNames}
          </p>
        )}
        {date && (
          <p className="uppercase text-[#B8A89A] tabular-nums text-[10px] sm:text-xs tracking-[0.3em]">
            {date}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-3">
        {grid.map((photo, i) => (
          <div
            key={i}
            className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-[#F3ECE4]"
            style={{ borderColor: '#E8DED6' }}
          >
            <AnimatePresence>
              <motion.img
                key={photo.id}
                src={photo.url as string}
                alt={photo.caption ?? ''}
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.01 }}
                transition={{ duration: 1.1, ease: 'easeInOut' }}
                className="absolute inset-0 w-full h-full object-cover"
              />
            </AnimatePresence>
          </div>
        ))}
      </div>

      <div className="mt-4 shrink-0">
        <FrameOrnament />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// WeddingPhotoAuto — mix automatico raffinato: alterna cornice singola
// "Oggi Sposi" e griglia album. Transizioni lente.
// ════════════════════════════════════════════════════════════════

const AUTO_SINGLE_MS = 24_000
const AUTO_GRID_MS = 20_000

export function WeddingPhotoAuto({
  photos,
  coupleNames,
  weddingDate,
}: {
  photos: SlideshowPhoto[]
  coupleNames?: string | null
  weddingDate?: string | null
}) {
  const [mode, setMode] = useState<'single' | 'grid'>('single')

  useEffect(() => {
    const dur = mode === 'single' ? AUTO_SINGLE_MS : AUTO_GRID_MS
    const id = setTimeout(() => setMode((m) => (m === 'single' ? 'grid' : 'single')), dur)
    return () => clearTimeout(id)
  }, [mode])

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mode}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.9 }}
        className="w-full flex items-center justify-center"
      >
        {mode === 'single' ? (
          <WeddingPhotoSlideshow photos={photos} coupleNames={coupleNames} weddingDate={weddingDate} />
        ) : (
          <WeddingPhotoGridWall photos={photos} coupleNames={coupleNames} weddingDate={weddingDate} className="max-w-3xl" />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

// ════════════════════════════════════════════════════════════════
// WeddingPhotoDisplay — dispatcher in base a screen_config.live_booth_layout.
// Default 'single' per retrocompatibilità.
// ════════════════════════════════════════════════════════════════
export function WeddingPhotoDisplay({
  photos,
  coupleNames,
  weddingDate,
  layout = 'single',
}: {
  photos: SlideshowPhoto[]
  coupleNames?: string | null
  weddingDate?: string | null
  layout?: LiveBoothLayout
}) {
  if (layout === 'grid')
    return <WeddingPhotoGridWall photos={photos} coupleNames={coupleNames} weddingDate={weddingDate} className="max-w-3xl" />
  if (layout === 'auto')
    return <WeddingPhotoAuto photos={photos} coupleNames={coupleNames} weddingDate={weddingDate} />
  return <WeddingPhotoSlideshow photos={photos} coupleNames={coupleNames} weddingDate={weddingDate} />
}
