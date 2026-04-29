'use client'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { REMIX_STYLE_LABELS, type RemixStyle } from '@/types'

interface StylePresetSelectorProps {
  value: RemixStyle
  onChange: (style: RemixStyle) => void
}

const STYLES = Object.entries(REMIX_STYLE_LABELS) as [RemixStyle, typeof REMIX_STYLE_LABELS[RemixStyle]][]

export function StylePresetSelector({ value, onChange }: StylePresetSelectorProps) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-white/70">
        Sound Modernization Preset
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STYLES.map(([key, meta]) => {
          const selected = value === key
          return (
            <motion.button
              key={key}
              whileTap={{ scale: 0.97 }}
              onClick={() => onChange(key)}
              className={cn(
                'relative flex flex-col gap-1 rounded-xl border p-3 text-left transition-all duration-200',
                selected
                  ? 'border-purple-500/60 bg-purple-500/10 shadow-neon-purple'
                  : 'border-white/8 bg-white/3 hover:border-white/15 hover:bg-white/5'
              )}
            >
              <span className="text-xl leading-none">{meta.icon}</span>
              <span className={cn('text-xs font-semibold', selected ? 'text-purple-300' : 'text-white/80')}>
                {meta.label}
              </span>
              <span className="text-[10px] leading-snug text-white/30 hidden sm:block">
                {meta.description}
              </span>

              {selected && (
                <motion.span
                  layoutId="preset-check"
                  className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-purple-400"
                />
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
