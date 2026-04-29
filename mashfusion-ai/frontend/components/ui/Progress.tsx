'use client'
import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number          // 0-100
  className?: string
  color?: 'purple' | 'pink' | 'cyan' | 'green'
  animated?: boolean
  showLabel?: boolean
  height?: 'xs' | 'sm' | 'md'
}

export function Progress({
  value,
  className,
  color = 'purple',
  animated = true,
  showLabel = false,
  height = 'sm',
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value))

  const tracks = {
    purple: 'from-purple-600 to-violet-500',
    pink:   'from-pink-600 to-rose-500',
    cyan:   'from-cyan-500 to-sky-400',
    green:  'from-green-500 to-emerald-400',
  }

  const heights = { xs: 'h-1', sm: 'h-1.5', md: 'h-2' }

  return (
    <div className={cn('w-full', className)}>
      <div className={cn('w-full rounded-full overflow-hidden', heights[height], 'bg-white/5')}>
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r transition-all duration-500 ease-out',
            tracks[color],
            animated && pct > 0 && pct < 100 && 'relative overflow-hidden'
          )}
          style={{ width: `${pct}%` }}
        >
          {animated && pct > 0 && pct < 100 && (
            <span className="absolute inset-0 shimmer" />
          )}
        </div>
      </div>
      {showLabel && (
        <p className="mt-1 text-right text-xs text-white/40">{pct}%</p>
      )}
    </div>
  )
}
