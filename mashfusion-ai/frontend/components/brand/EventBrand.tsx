'use client'
import { Logo } from '@/components/Logo'
import { MioloveLogo } from '@/components/brand/MioloveLogo'
import { EVENT_BRAND_NAME } from '@/lib/brand/eventBrand'
import { useEventBrand } from './eventBrandContext'
import { WEDDING_BRAND_LOGO } from '@/lib/brand/wedding'
import { cn } from '@/lib/utils'

export { EventBrandProvider, useEventBrand, useEventBrandName } from './eventBrandContext'

/** IOMIXO mark for the light Wedding theme: app icon + wordmark in the page ink colour. */
export function IomixoWeddingMark({ height = 32, className }: { height?: number; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2', className)} aria-label={EVENT_BRAND_NAME.iomixo} role="img">
      <Logo variant="party" size={height} />
      <span className="whitespace-nowrap font-black tracking-tight" style={{ fontSize: Math.max(14, Math.round(height * 0.5)) }}>
        IOMIXO <span className="text-wd-pink">Live Hub</span>
      </span>
    </span>
  )
}

/** Brand logo of the Wedding UI: MIOLOVE ALBUM for a Sposi album, IOMIXO for a Wedding DJ event. */
export function WeddingBrandLogo({ height = 32, variant = 'default', className }: {
  height?: number
  variant?: keyof typeof WEDDING_BRAND_LOGO
  className?: string
}) {
  const brand = useEventBrand()
  if (brand === 'iomixo') return <IomixoWeddingMark height={height} className={className} />
  return <MioloveLogo height={height} variant={variant} className={className} />
}
