'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { getPeaks, sliceMinMax, type PeaksData } from '@/lib/audio/peaks'
import { useEditorStore } from '@/lib/stores/useEditorStore'

type Variant = 'browser' | 'clip'

interface Props {
  url:        string
  width:      number
  height:     number
  colour?:    string
  startSec?:  number
  endSec?:    number
  totalSec?:  number
  highlight?: boolean
  className?: string
  /** "browser" — bold envelope for sidebar/preview lists.
   *  "clip"    — compact, precise waveform drawn over a coloured clip,
   *              like Ableton/Logic timeline clips. Defaults to "clip". */
  variant?:        Variant
  /** Vertical scale (0..1) applied to peak values before drawing. Shrinks
   *  the envelope without changing the canvas size, leaving headroom around
   *  the waveform like a real DAW clip. Defaults vary by variant. */
  amplitudeScale?: number
  /** Final-pass alpha multiplier on the rendered waveform. Defaults vary
   *  by variant. */
  opacity?:        number
}

// 32767 is the safe canvas-dimension ceiling on Chrome/Safari/Firefox
// desktop. Going higher than this risks the canvas being silently dropped
// to 0×0 by the browser. With dpr=2 this covers ~16383 css px — about
// 5–6 minutes of audio at default zoom. When the cap is hit the dev
// console gets a warning so we know to investigate (tiling/virtualisation
// is the next architectural step beyond this cap).
const MAX_BACKING_WIDTH = 32767

function getDpr(): number {
  if (typeof window === 'undefined') return 1
  return Math.min(window.devicePixelRatio || 1, 2)
}

function WaveformImpl({
  url, width, height, colour = '#a855f7',
  startSec, endSec, totalSec, highlight, className,
  variant = 'clip', amplitudeScale, opacity,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData]     = useState<PeaksData | null>(null)
  const [failed, setFailed] = useState(false)

  // Subscribe to zoom state: while isZooming, we skip canvas redraws entirely.
  // The existing canvas (slightly stretched/squeezed by CSS) stays visible.
  // When isZooming goes false the draw effect re-runs and paints at correct size.
  const isZooming = useEditorStore((s) => s.isZooming)

  // A monotonic counter we bump whenever something external invalidates
  // the canvas: ResizeObserver, dpr change, font load, mount-after-layout
  // rAF. Bumping it forces the draw effect to re-run, which re-reads the
  // canvas's REAL bounding rect — the authoritative size the browser
  // actually rendered, not the (possibly-stale-at-mount) width prop.
  const [revision, setRevision] = useState(0)
  const [dpr, setDpr] = useState<number>(getDpr)

  // Load peaks for this URL.
  useEffect(() => {
    let cancelled = false
    setFailed(false)
    setData(null)
    getPeaks(url)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [url])

  // ResizeObserver — bumps revision when the canvas's real rendered size
  // changes. Re-attaches once the canvas element exists in the DOM.
  // Suppressed during active zoom: the draw effect will re-run naturally
  // when isZooming clears, so the RO bump would just cause a double draw.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      // Reading from the store directly (not React state) avoids a closure
      // over a stale `isZooming` value in the subscriber.
      if (!useEditorStore.getState().isZooming) {
        setRevision((r) => r + 1)
      }
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [data])

  // First-mount layout-settled redraw. React's useEffect runs after commit
  // but the browser may not have computed final layout for the canvas yet
  // — especially inside async-loading parents. A double-rAF guarantees we
  // run AFTER the next paint, when getBoundingClientRect() is authoritative.
  useEffect(() => {
    if (!data) return
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRevision((r) => r + 1))
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [data])

  // Listen for devicePixelRatio changes and force a redraw.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    let mq: MediaQueryList | null = null
    let onChange: (() => void) | null = null
    const attach = () => {
      const cur = window.devicePixelRatio || 1
      mq = window.matchMedia(`(resolution: ${cur}dppx)`)
      onChange = () => {
        setDpr(getDpr())
        // Re-attach to a fresh MQ at the new dpr for the next change.
        mq?.removeEventListener('change', onChange!)
        attach()
      }
      mq.addEventListener('change', onChange)
    }
    attach()
    return () => {
      if (mq && onChange) mq.removeEventListener('change', onChange)
    }
  }, [])

  // Draw effect — runs whenever ANYTHING that affects the rendered output
  // changes: peaks data, revision (RO/dpr/post-mount rAF), or visual props.
  // We always read the canvas's REAL bounding rect at draw time as the
  // authoritative source of size — never trust the width prop alone, since
  // CSS layout (border-box, flex shrinking, sub-pixel rounding) can
  // legitimately produce a different rendered size.
  //
  // Performance: skipped entirely while isZooming is true. The canvas is
  // visually scaled by CSS during zoom (imperceptible at speed). When zoom
  // settles, isZooming flips to false, this effect re-runs, and paints at
  // the final correct size.
  useEffect(() => {
    // Fast exit during zoom — no canvas work at all.
    if (isZooming) return

    const canvas = canvasRef.current
    if (!canvas || !data) return

    const rect  = canvas.getBoundingClientRect()
    const propW = Math.max(1, Math.floor(width))
    const propH = Math.max(1, Math.floor(height))
    // Prefer the real rect; fall back to the prop if rect is 0 (canvas
    // not yet laid out — the post-mount rAF will redraw shortly).
    const cssW = rect.width  > 0 ? Math.floor(rect.width)  : propW
    const cssH = rect.height > 0 ? Math.floor(rect.height) : propH

    if (cssW <= 0 || cssH <= 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Waveform] skipping draw — non-positive size', { cssW, cssH, url })
      }
      return
    }

    const idealBackW = Math.floor(cssW * dpr)
    const backW      = Math.min(MAX_BACKING_WIDTH, idealBackW)
    const backH      = Math.floor(cssH * dpr)

    if (process.env.NODE_ENV !== 'production' && backW < idealBackW) {
      // When this fires, the canvas image is being upscaled by the browser
      // and the waveform will look softer than at smaller sizes. The fix
      // is viewport-clipped rendering (only draw the visible portion of
      // the clip into a canvas sized to the viewport, not the full clip).
      console.warn('[Waveform] backing width capped — visual upscale will blur strokes', {
        idealBackW, backW, cssW, dpr, url,
      })
    }

    if (canvas.width  !== backW) canvas.width  = backW
    if (canvas.height !== backH) canvas.height = backH

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    ctx.clearRect(0, 0, backW, backH)
    ctx.imageSmoothingEnabled = true

    const isClip = variant === 'clip'
    const amp    = amplitudeScale ?? (isClip ? 0.6 : 0.85)
    const alpha  = opacity        ?? (isClip ? 1 : 0.92)
    const fillShade   = isClip ? 0.22 : 0.42
    const strokeShade = isClip ? 0.28 : 0.24
    const strokePx    = Math.max(1, Math.round(dpr))

    const mid      = backH / 2
    const halfBody = Math.max(1, mid * amp)

    ctx.globalAlpha = alpha

    if (isClip) {
      // Resolution architecture: cols are derived from the BACKING canvas,
      // never from cssW. cols * strokePx ≤ backW so every rectangle lands
      // inside the canvas and tiles fill the backing exactly. Visual
      // quality stays constant across clip lengths and zoom levels (up to
      // the MAX_BACKING_WIDTH cap, beyond which the dev warn above fires).
      const cols = Math.max(1, Math.floor(backW / strokePx))
      const colMinMax = sliceMinMax(
        data,
        startSec ?? 0,
        endSec   ?? data.durationSec,
        cols,
      )
      const cmin = colMinMax.min
      const cmax = colMinMax.max

      // Per-clip VISUAL normalisation. peaks.ts keeps raw [-1, 1] values,
      // so a quiet stem (peak ≈ 0.05) needs amplification to be readable.
      // We use the 95th-percentile column amplitude (NOT the max) so a
      // single drum transient doesn't suppress the rest of the envelope.
      // NORM_FLOOR caps amplification on near-silent regions.
      const amps = new Float32Array(cols)
      for (let i = 0; i < cols; i++) {
        amps[i] = Math.max(-cmin[i], cmax[i])
      }
      const sorted = Array.from(amps).sort((a, b) => a - b)
      const pIdx   = Math.floor(sorted.length * 0.95)
      const localPeak = sorted[Math.min(pIdx, sorted.length - 1)] ?? 0
      const NORM_FLOOR = 0.05
      const norm = localPeak > 0
        ? 1 / Math.max(localPeak, NORM_FLOOR)
        : 1

      const w = strokePx
      ctx.fillStyle = brighten(colour, highlight ? 0.65 : 0.55)
      for (let i = 0; i < cols; i++) {
        const top    = mid - cmax[i] * norm * halfBody
        const bottom = mid - cmin[i] * norm * halfBody
        const h      = Math.max(1, bottom - top)
        ctx.fillRect(i * w, top, w, h)
      }
    } else {
      // Browser variant: filled envelope + contour.
      const cols = backW
      const { min, max } = sliceMinMax(
        data,
        startSec ?? 0,
        endSec   ?? data.durationSec,
        cols,
      )
      ctx.beginPath()
      ctx.moveTo(0, mid - max[0] * halfBody)
      for (let x = 1; x < cols; x++) {
        ctx.lineTo(x, mid - max[x] * halfBody)
      }
      for (let x = cols - 1; x >= 0; x--) {
        ctx.lineTo(x, mid - min[x] * halfBody)
      }
      ctx.closePath()

      ctx.fillStyle = darken(colour, highlight ? fillShade - 0.08 : fillShade)
      ctx.fill()

      ctx.lineWidth   = strokePx
      ctx.lineJoin    = 'round'
      ctx.lineCap     = 'round'
      ctx.strokeStyle = brighten(colour, highlight ? 0.8 : 0.7)
      ctx.stroke()
    }

    ctx.globalAlpha = 1
  }, [
    data, revision, width, height, dpr,
    colour, startSec, endSec, totalSec, highlight,
    variant, amplitudeScale, opacity, url, isZooming,
  ])

  if (failed) {
    return <div className={className} style={{ width, height }} aria-hidden />
  }

  if (!data) {
    return (
      <div
        className={`${className ?? ''} animate-pulse bg-white/5`}
        style={{ width, height }}
        aria-hidden
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height, display: 'block' }}
      aria-hidden
    />
  )
}

function darken(hex: string, factor: number): string {
  if (hex.startsWith('rgb')) return hex
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6) return hex
  const r = Math.round(parseInt(h.slice(0, 2), 16) * factor)
  const g = Math.round(parseInt(h.slice(2, 4), 16) * factor)
  const b = Math.round(parseInt(h.slice(4, 6), 16) * factor)
  return `rgb(${r},${g},${b})`
}

function brighten(hex: string, amount: number): string {
  if (hex.startsWith('rgb')) return hex
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lift = (v: number) => Math.round(v + (255 - v) * amount)
  return `rgb(${lift(r)},${lift(g)},${lift(b)})`
}

export const Waveform = memo(WaveformImpl)
