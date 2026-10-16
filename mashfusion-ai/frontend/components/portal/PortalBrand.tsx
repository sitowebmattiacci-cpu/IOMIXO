'use client'
import { MioloveLogo } from '@/components/brand/MioloveLogo'
import { Logo } from '@/components/Logo'
import { usePortal } from '@/components/portal/PortalProvider'

/** Brand mark of the CURRENT portal: IOMIXO Live Hub (dark, Party) or MIOLOVE ALBUM (light, Wedding). Never mixes the two. */
export function PortalBrand({ size = 40, textClass = 'text-xl', className = '', onDark = false }: { size?: number; textClass?: string; className?: string; /** on a dark surface the light MIOLOVE logo sits on a white chip */ onDark?: boolean }) {
  const { config } = usePortal()
  if (config.id === 'miolove') {
    // Transparent logo on light backgrounds (the ivory canvas shows as a box on tinted gradients); the white chip on dark keeps the ivory one.
    const logo = <MioloveLogo height={Math.round(size * 0.9)} variant={onDark ? 'onLight' : 'default'} className={className} />
    return onDark ? <span className="inline-flex rounded-xl bg-white px-3 py-1.5">{logo}</span> : logo
  }
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <Logo variant="party" size={size} />
      <span className={`${textClass} font-black tracking-tight text-white`}>IOMIXO <span className="text-[#FF2D8D]">Live Hub</span></span>
    </span>
  )
}
