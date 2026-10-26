'use client'
import { useEffect, useState } from 'react'
import { WEDDING_BRAND_LOGO_CROP, WEDDING_BRAND_LOGO_OPT, WEDDING_BRAND_NAME } from '@/lib/brand/wedding'
import { cn } from '@/lib/utils'
import { useEventBrandName, useWhiteLabel } from './eventBrandContext'

/** Official MIOLOVE ALBUM logo, never stretched (height driven, width auto). Falls back to the plain brand name if the asset is missing. */
export function MioloveLogo({ height = 32, variant = 'default', className }: {
  height?: number
  variant?: keyof typeof WEDDING_BRAND_LOGO_OPT
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className={cn('whitespace-nowrap font-bold tracking-tight', className)} style={{ fontSize: Math.max(14, height * 0.5) }}>{WEDDING_BRAND_NAME}</span>
  }
  const crop = WEDDING_BRAND_LOGO_CROP[variant]
  const width = (height * crop.w) / crop.h
  const opt = WEDDING_BRAND_LOGO_OPT[variant]
  return (
    <span
      role="img"
      aria-label={WEDDING_BRAND_NAME}
      className={cn('relative block max-w-full shrink-0 overflow-hidden', className)}
      style={{ height, width, aspectRatio: `${crop.w} / ${crop.h}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* The optimised copy is already cropped to the logo area (same aspect ratio as this box), so it simply fills it. */}
      <img
        src={`${opt}.webp`}
        srcSet={`${opt}-636.webp 636w, ${opt}.webp 1060w`}
        sizes={`${Math.round(width)}px`}
        alt=""
        onError={() => setFailed(true)}
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
      />
    </span>
  )
}

/** Sets the tab title for Wedding pages (MIOLOVE ALBUM, or IOMIXO for a Wedding DJ event) and restores the previous one on unmount. */
export function useWeddingTitle(prefix?: string) {
  const brandName = useEventBrandName()
  const whiteLabel = useWhiteLabel()
  useEffect(() => {
    const prev = document.title
    document.title = whiteLabel ? (prefix ?? prev) : prefix ? `${prefix} · ${brandName}` : brandName
    return () => { document.title = prev }
  }, [prefix, brandName, whiteLabel])
}
