import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoProps {
  size?: number
  className?: string
  /**
   * 'default' → official IOMIXO logo (used everywhere).
   * 'wedding' → legacy red logo, kept only inside the Wedding Edition.
   * 'party'   → same mark on the Party/DJ pink palette.
   */
  variant?: 'default' | 'wedding' | 'party'
}

export function Logo({ size = 32, className, variant = 'default' }: LogoProps) {
  const src = variant === 'wedding' ? '/logo.png' : variant === 'party' ? '/iomixo-logo-party.png' : '/iomixo-logo.png'
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
