'use client'
import { cn } from '@/lib/utils'

type BadgeVariant = 'processing' | 'complete' | 'failed' | 'queued' | 'default'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  pulse?: boolean
}

const variants: Record<BadgeVariant, string> = {
  processing: 'badge-processing',
  complete:   'badge-complete',
  failed:     'badge-failed',
  queued:     'badge-queued',
  default:    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white/5 text-white/60 border border-white/10',
}

export function Badge({ variant = 'default', children, className, pulse }: BadgeProps) {
  return (
    <span className={cn(variants[variant], className)}>
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      {children}
    </span>
  )
}
