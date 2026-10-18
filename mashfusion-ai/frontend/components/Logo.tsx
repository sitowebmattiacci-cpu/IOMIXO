import Image from 'next/image'
import { cn } from '@/lib/utils'

/** Official IOMIXO logo (final artwork, transparent corners). */
export const IOMIXO_LOGO = '/brand/iomixo/iomixo-logo.png'

interface LogoProps {
  size?: number
  className?: string
  /**
   * 'default' / 'party' → official IOMIXO logo (pink-yellow X on black, public/brand/iomixo/iomixo-logo.png), used everywhere in IOMIXO.
   * 'wedding' → legacy red logo, not used by the IOMIXO or MIOLOVE brands any more.
   */
  variant?: 'default' | 'wedding' | 'party'
}

export function Logo({ size = 32, className, variant = 'default' }: LogoProps) {
  const src = variant === 'wedding' ? '/logo.png' : IOMIXO_LOGO
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <Image
        src={src}
        alt="IOMIXO Logo"
        width={size}
        height={size}
        className="object-contain"
        priority
      />
    </div>
  )
}
