'use client'
import type { ReactNode } from 'react'
import { Camera, Heart } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Soft "photo" tiles used by the illustrations (the home never shows fake guest photos or fake people). */
export const TILE_GRADIENTS = [
  'from-[#FFD6E4] to-[#F9A8C5]', 'from-[#FFE7D1] to-[#F7B98F]', 'from-[#E4EFE0] to-[#B6D2AE]',
  'from-[#EADFF7] to-[#C5AEE6]', 'from-[#FBEFD5] to-[#EBCB8B]', 'from-[#FFE0E0] to-[#F1A1A1]',
] as const

export function Tile({ i, className, icon = false }: { i: number; className?: string; icon?: boolean }) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-gradient-to-br', TILE_GRADIENTS[i % TILE_GRADIENTS.length], className)} aria-hidden>
      <div className="absolute -right-3 -top-3 h-10 w-10 rounded-full bg-white/30" />
      <div className="absolute -bottom-4 left-2 h-12 w-12 rounded-full bg-white/20" />
      {icon && <Heart className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 text-white/80" fill="currentColor" />}
    </div>
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

/** Illustrated phone showing an album grid + the camera button. Decorative: aria-hidden. */
export function PhoneMock({ title, className }: { title: string; className?: string }) {
  return (
    <div className={cn('relative aspect-[9/18.5] w-full rounded-[34px] border-[6px] border-wd-ink bg-white p-3 shadow-[0_30px_60px_rgba(240,106,155,0.28)]', className)} aria-hidden>
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-wd-ink/15" />
      <p className="mb-2 text-center font-album text-[15px] font-semibold text-wd-ink">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => <Tile key={i} i={i} className={i % 3 === 0 ? 'aspect-[4/5]' : 'aspect-square'} icon={i === 1} />)}
      </div>
      <div className="absolute inset-x-0 bottom-4 flex justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-wd-pink text-white shadow-lg"><Camera className="h-5 w-5" /></span>
      </div>
    </div>
  )
}
