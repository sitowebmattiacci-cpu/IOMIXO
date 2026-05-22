import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoProps {
  size?: number
  className?: string
}

export function Logo({ size = 32, className }: LogoProps) {
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <Image
        src="/logo.png"
        alt="IOMIXO Logo"
        width={size}
        height={size}
        className="object-contain"
        priority
      />
    </div>
  )
}
