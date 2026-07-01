'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera } from 'lucide-react'
import { useGridSlideshow } from '@/lib/useGridSlideshow'
import { PartyPhotoSlideshow, PartySlidePhoto } from './PartyPhotoSlideshow'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Party Mode · Live Booth photo WALL (Screen Mode / TV)
// Griglia foto stile "wall da evento": 3x2 su desktop/TV, 2 colonne su
// schermi stretti. Cambia UNA cella alla volta (fade/scale) con la
// logica anti-ripetizione condivisa (vedi lib/useGridSlideshow).
// Stile Party: nero + cornice magenta/neon.
// ════════════════════════════════════════════════════════════════

export type LiveBoothLayout = 'single' | 'grid' | 'auto'

const PARTY_CELLS = 6

export interface PartyPhotoGridWallProps {
  photos: PartySlidePhoto[]
  /** Numero massimo di celle (default 6 → 3x2). */
  cells?: number
  /** Intervallo di cambio cella in ms (default 3500). */
  intervalMs?: number
  /** Nome evento mostrato nella cornice (solo Party Mode). */
  eventName?: string | null
  className?: string
}

export function PartyPhotoGridWall({
  photos,
  cells = PARTY_CELLS,
  intervalMs = 3500,
  eventName,
  className = '',
}: PartyPhotoGridWallProps) {
  const { grid, hasPhotos } = useGridSlideshow(photos, cells, intervalMs)

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

  // Colonne adattive: poche foto restano portrait senza deformarsi né allargarsi.
  const cols = grid.length <= 1 ? 1 : grid.length === 2 ? 2 : 3
  const gridColsClass = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'
  const maxWidthClass = cols === 1 ? 'max-w-[340px]' : cols === 2 ? 'max-w-[680px]' : 'max-w-[1020px]'

  return (
    <div className={`flex flex-col h-full min-h-0 items-center justify-center ${className}`}>
      {/* Cornice evento: card scura neutra + nome evento */}
      <div className={`rounded-3xl bg-black/40 border border-white/10 p-5 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)] w-full ${maxWidthClass} mx-auto`}>
        <div className="flex flex-col items-center gap-1.5 mb-5">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[#FF3D8A]" />
            <span className="text-[11px] font-black uppercase tracking-[0.4em] text-[#FF7AB6]">
              Live Booth
            </span>
          </div>
          {eventName && (
            <p className="text-lg sm:text-2xl font-black uppercase tracking-[0.16em] text-white text-center leading-tight">
              {eventName}
            </p>
          )}
        </div>
        <div className={`grid ${gridColsClass} gap-3.5`}>
          {grid.map((photo, i) => (
            <div
              key={i}
              className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-black/40"
            >
              <AnimatePresence>
                <motion.img
                  key={photo.id}
                  src={photo.url as string}
                  alt={photo.caption ?? ''}
                  initial={{ opacity: 0, scale: 1.06 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  transition={{ duration: 0.7, ease: 'easeInOut' }}
                  className="absolute inset-0 w-full h-full object-cover [object-position:center_35%]"
                />
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// PartyPhotoAuto — mix automatico intelligente: alterna momenti con
// foto singola grande e momenti con griglia Live Booth. Ogni sotto-
// componente mantiene la propria logica anti-ripetizione.
// ════════════════════════════════════════════════════════════════

const AUTO_SINGLE_MS = 20_000 // ~3 foto singole
const AUTO_GRID_MS = 16_000

export function PartyPhotoAuto({ photos, eventName }: { photos: PartySlidePhoto[]; eventName?: string | null }) {
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
        transition={{ duration: 0.6 }}
        className="w-full h-full min-h-0"
      >
        {mode === 'single' ? (
          <PartyPhotoSlideshow photos={photos} eventName={eventName} />
        ) : (
          <PartyPhotoGridWall photos={photos} eventName={eventName} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

// ════════════════════════════════════════════════════════════════
// PartyPhotoRow — Live Booth "griglia" pulita per lo Screen Mode Party.
// Mostra FINO A 3 foto affiancate DENTRO il box Live Booth esistente
// (nessuna cornice/titolo: il contenitore ha già il suo wrapper). Ruota
// automaticamente riusando la logica anti-ripetizione di useGridSlideshow
// (cambia una cella alla volta, preload prima dell'inserimento).
//   3+ foto → 3 affiancate · 2 foto → 2 · 1 foto → centrata · 0 → placeholder
// ════════════════════════════════════════════════════════════════
function PartyPhotoRow({ photos }: { photos: PartySlidePhoto[] }) {
  const cells = Math.min(3, photos.filter((p) => !!p.url).length || 1)
  const { grid, hasPhotos } = useGridSlideshow(photos, cells, 4000)

  if (!hasPhotos) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-center px-6">
        <Camera className="h-14 w-14 text-[#FF3D8A]/40 mb-4" />
        <p className="text-2xl font-bold text-white">Le foto degli ospiti appariranno qui</p>
      </div>
    )
  }

  const cols = grid.length <= 1 ? 'grid-cols-1' : grid.length === 2 ? 'grid-cols-2' : 'grid-cols-3'

  return (
    <div className={`grid ${cols} gap-3 w-full h-full p-2 place-items-center`}>
      {grid.map((photo, i) => (
        <div key={i} className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-xl bg-black/30">
          <AnimatePresence>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <motion.img
              key={photo.id}
              src={photo.url as string}
              alt={photo.caption ?? ''}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.7, ease: 'easeInOut' }}
              className="max-w-full max-h-full w-auto h-auto object-contain rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
            />
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// PartyPhotoDisplay — Live Booth Screen Mode. Rispetta la modalità
// scelta dal DJ (screen_config.live_booth_layout):
//   • 'grid'   → fino a 3 foto affiancate (PartyPhotoRow) dentro lo stesso box
//   • 'single' / 'auto' → slideshow a foto singola (comportamento invariato)
// Il contenitore esterno (card Live Booth) resta identico.
// ════════════════════════════════════════════════════════════════
export function PartyPhotoDisplay({
  photos,
  layout = 'single',
}: {
  photos: PartySlidePhoto[]
  layout?: LiveBoothLayout
  eventName?: string | null
}) {
  if (layout === 'grid') return <PartyPhotoRow photos={photos} />
  return <PartyPhotoSlideshow photos={photos} />
}
