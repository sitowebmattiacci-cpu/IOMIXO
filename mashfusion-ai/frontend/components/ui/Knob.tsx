'use client'

import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  colour: string
  onChange: (v: number) => void
  logScale?: boolean
  size?: 'sm' | 'md'
  neutral?: number
}

export function Knob({
  label,
  value,
  min,
  max,
  step,
  unit,
  colour,
  onChange,
  logScale = false,
  size = 'md',
  neutral,
}: KnobProps) {
  const dragRef = useRef<{
    startValue: number
    startX: number
    startY: number
  } | null>(null)

  const toSlider = (v: number) => {
    if (!logScale) return v
    const logMin = Math.log(Math.max(1, min))
    const logMax = Math.log(Math.max(1, max))
    return ((Math.log(Math.max(1, v)) - logMin) / (logMax - logMin)) * (max - min) + min
  }

  const fromSlider = (s: number) => {
    if (!logScale) return s
    const logMin = Math.log(Math.max(1, min))
    const logMax = Math.log(Math.max(1, max))
    return Math.exp(logMin + ((s - min) / (max - min)) * (logMax - logMin))
  }

  const displayValue = value >= 1000
    ? `${(value / 1000).toFixed(1)}k`
    : (step >= 1 ? Math.round(value).toString() : value.toFixed(2))

  const normalized = clamp((toSlider(value) - min) / (max - min), 0, 1)
  const angle = -135 + normalized * 270
  const isNeutral = neutral != null ? Math.abs(value - neutral) < Math.max(step * 0.5, 0.0005) : false

  const stopDrag = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopDrag)
    document.body.style.cursor = ''
  }

  const onPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = drag.startY - e.clientY
    const range = max - min
    const delta = (dy + dx * 0.35) * (range / 220)
    const raw = drag.startValue + delta
    const snapped = Math.round(raw / step) * step
    onChange(clamp(snapped, min, max))
  }

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    dragRef.current = { startValue: value, startX: e.clientX, startY: e.clientY }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
    document.body.style.cursor = 'ns-resize'
  }

  return (
    <div className={cn('knob', size === 'sm' && 'sm')} style={{ '--knob-color': colour, '--knob-angle': `${angle}deg` } as CSSProperties}>
      <div className="knob-label" style={{ color: isNeutral ? 'rgba(255,255,255,0.35)' : 'var(--knob-color)' }}>
        {label}
      </div>
      <div className="knob-body">
        <div className="knob-ring" />
        <div className="knob-core" />
        <div
          className="knob-indicator"
          style={{
            transform: `translate(-50%, -85%) rotate(${angle}deg)`
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={toSlider(value)}
          onChange={(e) => onChange(Number(fromSlider(parseFloat(e.target.value)).toFixed(4)))}
          onPointerDown={startDrag}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>
      <div className="knob-value">
        {displayValue}{unit && <span className="text-white/40 ml-0.5">{unit}</span>}
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
