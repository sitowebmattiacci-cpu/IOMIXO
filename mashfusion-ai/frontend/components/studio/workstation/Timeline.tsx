'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Volume2, VolumeX, Headphones, X, Plus } from 'lucide-react'
import { useArrangementStore } from '@/lib/stores/useArrangementStore'
import { useEditorStore, gridStepSec, snapSec, MIN_PX_PER_SEC, MAX_PX_PER_SEC } from '@/lib/stores/useEditorStore'
import { useAssetUrls } from '@/lib/stores/useAssetUrls'
import type { Clip, Track, ProjectStem } from '@/types/arrangement'
import { Waveform } from './Waveform'

const LANE_HEIGHT   = 52
const HEADER_WIDTH  = 136

const RULER_HEIGHT  = 24
// Render this many CSS px beyond the visible viewport so a small scroll
// or auto-scroll during playback doesn't pop clips in/out.
const VIEWPORT_MARGIN = 600

interface Props {
  stems: ProjectStem[]
  /** Function reading current playhead seconds — kept as a getter so the
   *  Timeline does NOT re-render on every rAF tick. The Playhead overlay
   *  reads from it directly via its own rAF loop. */
  playheadRef:   React.MutableRefObject<number>
  isPlayingRef:  React.MutableRefObject<boolean>
  /** Optional real-time meter source (e.g. WebAudio analyser by track id). */
  getTrackLevel?: (trackId: string) => number | undefined
  /** Click on the ruler to seek (visually for now). */
  onSeek?: (sec: number) => void
}

interface DragPayload {
  stem_id?:   string
  asset_kind: 'stem' | 'soundbank' | 'user_sample'
  asset_ref:  string
  signed_url: string
  duration:   number | null
  label:      string
}

interface Viewport { left: number; right: number }

export function Timeline({ stems, playheadRef, isPlayingRef, getTrackLevel, onSeek }: Props) {
  const arrangement = useArrangementStore((s) => s.arrangement)
  const bpm         = arrangement?.bpm ?? 120
  const addTrack    = useArrangementStore((s) => s.addTrack)
  const ensureStemTracks = useArrangementStore((s) => s.ensureStemTracks)
  const snap        = useEditorStore((s) => s.snap)
  const resolution  = useEditorStore((s) => s.resolution)
  const pxPerSec    = useEditorStore((s) => s.pxPerSec)
  const clearSelection = useEditorStore((s) => s.clearSelection)
  const loopStartSec = useEditorStore((s) => s.loopStartSec)
  const loopEndSec   = useEditorStore((s) => s.loopEndSec)
  const loopOn       = useEditorStore((s) => s.loopOn)
  const setLoopRegion = useEditorStore((s) => s.setLoopRegion)

  const assetUrls = useAssetUrls((s) => s.urls)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Zoom accumulator refs — no React state, no re-renders per event ──
  // Wheel/trackpad events can fire 100+/sec. We batch them into one RAF
  // frame per repaint cycle and commit a single setPxPerSec call per frame.
  // A 200 ms settle timer then clears isZooming → triggers HD waveform redraws.
  const pendingZoomRef   = useRef<{ nextPx: number; timeAtCursor: number; screenX: number } | null>(null)
  const zoomRafRef       = useRef(0)
  const zoomSettleRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Viewport tracking — updated via rAF on scroll/resize and quantised so
  // small motions don't trigger React re-renders. The whole point of viewport
  // culling is paid for here: a smooth scroll fires hundreds of events; we
  // collapse them into ≤1 setState per frame, and skip even that when the
  // motion is below the quantum.
  const [viewport, setViewport] = useState<Viewport>({ left: 0, right: 1600 })
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const left  = el.scrollLeft
      const right = left + el.clientWidth
      setViewport((v) => {
        // Re-render only when the visible band shifted by a noticeable amount.
        if (Math.abs(v.left - left) < 64 && Math.abs(v.right - right) < 64) return v
        return { left, right }
      })
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    update()
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // Auto-scroll to keep the playhead visible during playback.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const tick = () => {
      if (isPlayingRef.current) {
        const x = HEADER_WIDTH + playheadRef.current * pxPerSec
        const view = el.scrollLeft + el.clientWidth
        if (x > view - 80 || x < el.scrollLeft + HEADER_WIDTH + 40) {
          el.scrollLeft = Math.max(0, x - el.clientWidth * 0.4)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pxPerSec, isPlayingRef, playheadRef])

  // Cmd/Ctrl + wheel zoom, anchored to the cursor — like Ableton/Logic.
  // Browsers translate trackpad pinch into wheel events with ctrlKey set,
  // so this naturally covers both mouse-wheel-with-modifier AND pinch.
  // Plain wheel (no modifier) keeps the browser's normal scroll behaviour.
  //
  // Performance: wheel events fire at 60–120 Hz on trackpads. Instead of
  // calling setPxPerSec synchronously (→ React re-render per event), we
  // accumulate the desired zoom into a ref and commit once per rAF frame.
  // This caps React renders at the display refresh rate regardless of input speed.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()

      const { pxPerSec: cur } = useEditorStore.getState()
      // Base for accumulation: use the pending value if a RAF is already
      // queued so multiple events within one frame compound correctly.
      const base   = pendingZoomRef.current?.nextPx ?? cur
      const factor = Math.exp(-e.deltaY * 0.01)
      const next   = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, base * factor))
      if (next === base && pendingZoomRef.current) return

      // Anchor: time under the cursor at the CURRENT committed zoom level.
      // Using `cur` (not `base`) keeps the anchor stable even while batching —
      // the scroll pin compensates for the full accumulated delta at commit time.
      const rect         = el.getBoundingClientRect()
      const screenX      = e.clientX - rect.left
      const contentX     = screenX + el.scrollLeft
      const timeAtCursor = Math.max(0, (contentX - HEADER_WIDTH) / cur)

      pendingZoomRef.current = { nextPx: next, timeAtCursor, screenX }

      // One RAF per batch of wheel events — no double-scheduling.
      if (!zoomRafRef.current) {
        zoomRafRef.current = requestAnimationFrame(() => {
          zoomRafRef.current = 0
          const p = pendingZoomRef.current
          if (!p) return
          pendingZoomRef.current = null

          const { setPxPerSec, setIsZooming } = useEditorStore.getState()
          setPxPerSec(p.nextPx)
          setIsZooming(true)

          // Pin time-under-cursor: run AFTER layout so scrollLeft is correct.
          requestAnimationFrame(() => {
            const newContentX = HEADER_WIDTH + p.timeAtCursor * p.nextPx
            el.scrollLeft = Math.max(0, newContentX - p.screenX)
          })
        })
      }

      // 200 ms idle → zoom settled → restore HD waveform rendering.
      if (zoomSettleRef.current) clearTimeout(zoomSettleRef.current)
      zoomSettleRef.current = setTimeout(() => {
        zoomSettleRef.current = null
        useEditorStore.getState().setIsZooming(false)
      }, 200)
    }

    // passive:false is required for preventDefault on wheel.
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (zoomRafRef.current) { cancelAnimationFrame(zoomRafRef.current); zoomRafRef.current = 0 }
      if (zoomSettleRef.current) { clearTimeout(zoomSettleRef.current); zoomSettleRef.current = null }
      // Clear isZooming in case component unmounts while zooming.
      useEditorStore.getState().setIsZooming(false)
    }
  }, [])

  useEffect(() => {
    if (!arrangement || stems.length === 0) return
    ensureStemTracks(stems)
  }, [arrangement, stems, ensureStemTracks])

  const sortedTracks = useMemo(
    () => arrangement ? [...(arrangement.lanes ?? arrangement.tracks)].sort((a, b) => a.lane - b.lane) : [],
    [arrangement],
  )

  if (!arrangement) return null

  const widthPx = Math.max(800, arrangement.duration_sec * pxPerSec)
  const tracks  = sortedTracks
  const stepSec = gridStepSec(resolution, bpm)
  const beatSec = 60 / bpm
  const barSec  = beatSec * 4
  const isEmpty = tracks.every((t) => t.clips.length === 0)
  const anySolo = tracks.some((t) => t.solo)
  const loopValid = loopStartSec != null && loopEndSec != null && loopEndSec > loopStartSec

  // Lane-relative viewport (clips' x are measured from the start of the lane,
  // not the scroll content) — pass into TrackLane so it can cull clips off
  // screen with a single arithmetic comparison per clip.
  const laneViewport: Viewport = {
    left:  Math.max(0, viewport.left  - HEADER_WIDTH - VIEWPORT_MARGIN),
    right: Math.max(0, viewport.right - HEADER_WIDTH + VIEWPORT_MARGIN),
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto daw-panel">
      <div className="relative" style={{ minWidth: HEADER_WIDTH + widthPx }}>
        <Ruler
          durationSec={arrangement.duration_sec}
          widthPx={widthPx}
          pxPerSec={pxPerSec}
          barSec={barSec}
          onSeek={onSeek}
          onAddTrack={() => addTrack()}
          loopStartSec={loopStartSec}
          loopEndSec={loopEndSec}
          loopOn={loopOn}
          onLoopChange={(startSec, endSec) => setLoopRegion(startSec, endSec)}
          scrollRef={scrollRef}
        />
        <div
          className="border-t border-white/10 relative"
          onMouseDown={(e) => { if (e.target === e.currentTarget) clearSelection() }}
        >
          {loopValid && (
            <LoopRegionShade
              startSec={loopStartSec}
              endSec={loopEndSec}
              pxPerSec={pxPerSec}
              heightPx={LANE_HEIGHT * Math.max(tracks.length, 1)}
              active={loopOn}
            />
          )}
          {tracks.map((track) => (
            <TrackLane
              key={track.id}
              track={track}
              widthPx={widthPx}
              stems={stems}
              assetUrls={assetUrls}
              snap={snap}
              stepSec={stepSec}
              pxPerSec={pxPerSec}
              viewport={laneViewport}
              playheadRef={playheadRef}
              isPlayingRef={isPlayingRef}
              anySolo={anySolo}
              getTrackLevel={getTrackLevel}
            />
          ))}
          {/* Beat/bar grid is rendered ABOVE clips (pointer-events:none)
              so subdivisions stay visible even where clips would otherwise
              occlude them. Translucent clip bg + grid-on-top is what gives
              the DAW look where you can read beats through every region. */}
          <BeatGrid
            widthPx={widthPx}
            barSec={barSec}
            beatSec={beatSec}
            stepSec={snap ? stepSec : 0}
            laneCount={Math.max(tracks.length, 1)}
            pxPerSec={pxPerSec}
            resolution={resolution}
          />
          {isEmpty && (
            <EmptyHint width={widthPx} />
          )}
          <PlayheadOverlay
            playheadRef={playheadRef}
            isPlayingRef={isPlayingRef}
            heightPx={LANE_HEIGHT * Math.max(tracks.length, 1)}
            pxPerSec={pxPerSec}
            scrollRef={scrollRef}
            onSeek={onSeek}
          />
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Ruler: bars + beats. Click anywhere to seek.
// ──────────────────────────────────────────────────────────────────────
function Ruler({
  durationSec, widthPx, pxPerSec, barSec, onSeek, onAddTrack,
  loopStartSec, loopEndSec, loopOn, onLoopChange, scrollRef,
}: {
  durationSec: number
  widthPx: number
  pxPerSec: number
  barSec: number
  onSeek?: (sec: number) => void
  onAddTrack: () => void
  loopStartSec: number | null
  loopEndSec: number | null
  loopOn: boolean
  onLoopChange: (startSec: number, endSec: number) => void
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
}) {
  const totalBars = Math.ceil(durationSec / barSec) + 1
  const barPx     = barSec * pxPerSec
  const labelStep = barPx < 40 ? Math.ceil(40 / barPx) : 1

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return
    const scroller = scrollRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const scrollLeft = scroller.scrollLeft
    const xInScroller = scrollLeft + (e.clientX - rect.left)
    const sec  = Math.max(0, (xInScroller - HEADER_WIDTH) / pxPerSec)
    onSeek(sec)
  }

  // Tick lines drawn via a single repeating-linear-gradient instead of N
  // div elements — one DOM node, GPU-accelerated, no layout cost on zoom.
  const tickGradient = `repeating-linear-gradient(
    to right,
    rgba(255,255,255,0.2) 0px,
    rgba(255,255,255,0.2) 1px,
    transparent 1px,
    transparent ${barPx}px
  )`
  const subTickGradient = pxPerSec >= 36
    ? `, repeating-linear-gradient(
        to right,
        rgba(255,255,255,0.14) 0px,
        rgba(255,255,255,0.14) 1px,
        transparent 1px,
        transparent ${barPx / 4}px
      )`
    : ''

  return (
    <div
      className="sticky top-0 z-30 flex daw-panel-header"
      style={{ height: RULER_HEIGHT }}
    >
      <div
        style={{ width: HEADER_WIDTH }}
        className="shrink-0 border-r border-black/50 flex items-center justify-between px-2 text-[10px] font-mono uppercase tracking-wider text-white/50"
      >
        <span>Tracks</span>
        <button
          onClick={onAddTrack}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold normal-case tracking-normal text-white/70 hover:text-white btn-led"
          title="Add empty lane"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>
      <div
        className="relative cursor-text"
        style={{
          width: widthPx,
          backgroundImage: tickGradient + subTickGradient,
          // Sub-ticks render only as bottom 4px of the ruler.
          backgroundSize: pxPerSec >= 36
            ? `${barPx}px ${RULER_HEIGHT}px, ${barPx / 4}px 4px`
            : undefined,
          backgroundRepeat: 'repeat',
          backgroundPosition: pxPerSec >= 36 ? 'left top, left bottom' : undefined,
        }}
        onClick={onClick}
        title="Click to set playhead"
      >
        {loopStartSec != null && loopEndSec != null && loopEndSec > loopStartSec && (
          <LoopRegionRuler
            startSec={loopStartSec}
            endSec={loopEndSec}
            durationSec={durationSec}
            pxPerSec={pxPerSec}
            widthPx={widthPx}
            beatSec={barSec / 4}
            active={loopOn}
            onChange={onLoopChange}
          />
        )}
        {/* Bar labels — only visible bars, with stride to avoid overlap. */}
        {Array.from({ length: totalBars }, (_, i) => {
          if (i % labelStep !== 0) return null
          return (
            <div
              key={i}
              className="absolute pl-1.5 pt-1 text-[10px] text-white/45 font-mono select-none pointer-events-none"
              style={{ left: i * barPx }}
            >
              {i + 1}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LoopRegionRuler({
  startSec,
  endSec,
  durationSec,
  pxPerSec,
  widthPx,
  beatSec,
  active,
  onChange,
}: {
  startSec: number
  endSec: number
  durationSec: number
  pxPerSec: number
  widthPx: number
  beatSec: number
  active: boolean
  onChange: (startSec: number, endSec: number) => void
}) {
  const minLen = beatSec > 0 ? beatSec : 0.1
  const leftPx = startSec * pxPerSec
  const regionWidth = Math.max(6, (endSec - startSec) * pxPerSec)

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'start' | 'end') => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const baseStart = startSec
    const baseEnd = endSec
    const length = baseEnd - baseStart

    const onMove = (ev: PointerEvent) => {
      const deltaSec = (ev.clientX - startX) / pxPerSec
      if (mode === 'move') {
        const nextStart = clampSec(baseStart + deltaSec, 0, Math.max(0, durationSec - length))
        const snappedStart = snapToBeat(nextStart, beatSec)
        const snappedEnd = Math.min(durationSec, snappedStart + length)
        onChange(snappedStart, snappedEnd)
        return
      }
      if (mode === 'start') {
        const nextStart = clampSec(baseStart + deltaSec, 0, Math.max(0, baseEnd - minLen))
        const snappedStart = snapToBeat(nextStart, beatSec)
        onChange(Math.min(snappedStart, baseEnd - minLen), baseEnd)
        return
      }
      const nextEnd = clampSec(baseEnd + deltaSec, baseStart + minLen, Math.max(minLen, durationSec))
      const snappedEnd = snapToBeat(nextEnd, beatSec, true)
      onChange(baseStart, Math.min(durationSec, snappedEnd))
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className="absolute top-1 bottom-1"
      style={{
        left: leftPx,
        width: Math.min(regionWidth, widthPx - leftPx),
      }}
    >
      <div
        onPointerDown={(e) => startDrag(e, 'move')}
        className={`absolute inset-0 rounded-sm border ${active ? 'border-emerald-300/70 bg-emerald-400/15' : 'border-white/25 bg-white/10'} cursor-ew-resize`}
        title="Drag to move loop region"
      >
        <div className="absolute left-2 top-0.5 text-[9px] font-mono text-white/70 select-none">
          Loop
        </div>
      </div>
      <div
        onPointerDown={(e) => startDrag(e, 'start')}
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
        style={{ background: active ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.3)' }}
        title="Resize loop start"
      />
      <div
        onPointerDown={(e) => startDrag(e, 'end')}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
        style={{ background: active ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.3)' }}
        title="Resize loop end"
      />
    </div>
  )
}

function LoopRegionShade({
  startSec,
  endSec,
  pxPerSec,
  heightPx,
  active,
}: {
  startSec: number
  endSec: number
  pxPerSec: number
  heightPx: number
  active: boolean
}) {
  const left = startSec * pxPerSec
  const width = Math.max(2, (endSec - startSec) * pxPerSec)
  return (
    <div
      className="absolute pointer-events-none z-10"
      style={{
        left: HEADER_WIDTH + left,
        top: 0,
        width,
        height: heightPx,
        background: active ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.06)',
        borderLeft: '1px solid rgba(255,255,255,0.2)',
        borderRight: '1px solid rgba(255,255,255,0.2)',
      }}
    />
  )
}

function clampSec(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function snapToBeat(sec: number, beatSec: number, ceil?: boolean): number {
  if (beatSec <= 0) return Math.max(0, sec)
  const q = sec / beatSec
  const snapped = ceil ? Math.ceil(q) * beatSec : Math.floor(q) * beatSec
  return Math.max(0, snapped)
}

// ──────────────────────────────────────────────────────────────────────
// Multi-tier beat grid — single absolute div, three CSS gradients stacked.
//
// Replaces the old per-line div approach (~hundreds of nodes for a 4-min
// song at 1/16 resolution) with a single GPU-painted background. Zero
// layout cost on zoom — the gradients re-render in compositor only.
// ──────────────────────────────────────────────────────────────────────
const BeatGrid = memo(function BeatGrid({
  widthPx, barSec, beatSec, stepSec, laneCount, pxPerSec, resolution,
}: {
  widthPx: number
  barSec: number
  beatSec: number
  stepSec: number
  laneCount: number
  pxPerSec: number
  resolution: import('@/lib/stores/useEditorStore').GridResolution
}) {
  const heightPx = LANE_HEIGHT * laneCount
  const barPx    = barSec * pxPerSec
  const beatPx   = beatSec * pxPerSec
  const subPx    = stepSec > 0 ? stepSec * pxPerSec : 0

  // Layers shown depend on the SELECTED resolution, not just the zoom.
  // 1 Bar     → bars only
  // 1/2, 1/4  → bars + beats
  // 1/8, 1/16 → bars + beats + subs
  const showBeats = beatPx >= 14 && resolution !== 'bar' && resolution !== 'off'
  const showSubs  = subPx >= 8 && stepSec > 0 && stepSec < beatSec
                  && (resolution === 'eighth' || resolution === 'sixteenth')

  const layers: string[] = []
  if (showSubs) {
    layers.push(
      `repeating-linear-gradient(to right, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.09) 1px, transparent 1px, transparent ${subPx}px)`,
    )
  }
  if (showBeats) {
    layers.push(
      `repeating-linear-gradient(to right, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, transparent 1px, transparent ${beatPx}px)`,
    )
  }
  layers.push(
    `repeating-linear-gradient(to right, rgba(255,255,255,0.28) 0px, rgba(255,255,255,0.28) 1px, transparent 1px, transparent ${barPx}px)`,
  )

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left:   HEADER_WIDTH,
        top:    0,
        width:  widthPx,
        height: heightPx,
        backgroundImage: layers.join(', '),
      }}
    />
  )
})

// ──────────────────────────────────────────────────────────────────────
// Playhead overlay — DOM-mutating. Does NOT re-render the timeline.
// Reads from a getter ref every animation frame and writes transform
// directly. This is the cheapest possible playhead.
// ──────────────────────────────────────────────────────────────────────
function PlayheadOverlay({
  playheadRef, isPlayingRef, heightPx, pxPerSec, scrollRef, onSeek,
}: {
  playheadRef:  React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  heightPx:     number
  pxPerSec:     number
  scrollRef:    React.MutableRefObject<HTMLDivElement | null>
  onSeek?: (sec: number) => void
}) {
  const lineRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)

  const seekFromClientX = (clientX: number) => {
    if (!onSeek) return
    const scroller = scrollRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const contentX = clientX - rect.left + scroller.scrollLeft
    const sec = Math.max(0, (contentX - HEADER_WIDTH) / pxPerSec)
    onSeek(sec)
  }

  useEffect(() => {
    let raf = 0
    let lastX = -1
    const tick = () => {
      const lineEl = lineRef.current
      const handleEl = handleRef.current
      if (lineEl) {
        const x = playheadRef.current * pxPerSec
        if (Math.abs(x - lastX) > 0.25) {
          lineEl.style.transform = `translate3d(${x}px,0,0)`
          lineEl.style.opacity = isPlayingRef.current || playheadRef.current > 0 ? '1' : '0'
          if (handleEl) {
            handleEl.style.transform = `translate3d(${x - 6}px,0,0)`
            handleEl.style.opacity = lineEl.style.opacity
          }
          lastX = x
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pxPerSec, playheadRef, isPlayingRef])

  return (
    <>
      <div
        ref={lineRef}
        className="absolute top-0 z-20 pointer-events-none"
        style={{
          left:   HEADER_WIDTH,
          height: heightPx,
          width:  2,
          background: '#22c55e',
          boxShadow:  '0 0 12px rgba(34,197,94,0.55)',
          opacity: 0,
          willChange: 'transform',
        }}
      />
      <div
        ref={handleRef}
        className="absolute top-0 z-30"
        style={{
          left: HEADER_WIDTH,
          height: RULER_HEIGHT,
          width: 12,
          opacity: 0,
          willChange: 'transform',
        }}
      >
        <div
          className="absolute inset-0 cursor-ew-resize"
          onPointerDown={(e) => {
            if (!onSeek) return
            e.preventDefault()
            e.stopPropagation()
            const lineEl = lineRef.current
            const handleEl = handleRef.current
            if (lineEl) lineEl.style.opacity = '1'
            if (handleEl) handleEl.style.opacity = '1'
            seekFromClientX(e.clientX)
            const onMove = (ev: PointerEvent) => seekFromClientX(ev.clientX)
            const onUp = () => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
          title="Drag to scrub playhead"
        />
      </div>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Empty-state hint
// ──────────────────────────────────────────────────────────────────────
function EmptyHint({ width }: { width: number }) {
  return (
    <div
      className="absolute pointer-events-none flex items-center justify-center text-center"
      style={{ left: HEADER_WIDTH, top: 0, width, height: LANE_HEIGHT * 1 }}
    >
      <div className="text-[11px] text-white/45">
        Drag stems or samples here to start building your remix
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Track lane (drop target + lane controls).
// ──────────────────────────────────────────────────────────────────────
function TrackLane({
  track, widthPx, stems, assetUrls, snap, stepSec, pxPerSec, viewport,
  playheadRef, isPlayingRef, anySolo, getTrackLevel,
}: {
  track: Track
  widthPx: number
  stems: ProjectStem[]
  assetUrls: Map<string, string>
  snap: boolean
  stepSec: number
  pxPerSec: number
  viewport: Viewport
  playheadRef: React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  anySolo: boolean
  getTrackLevel?: (trackId: string) => number | undefined
}) {
  const setAssetUrl = useAssetUrls((s) => s.setUrl)
  const addClip   = useArrangementStore((s) => s.addClipToTrack)
  const moveClip  = useArrangementStore((s) => s.moveClip)
  const removeClip = useArrangementStore((s) => s.removeClip)
  const resizeClip = useArrangementStore((s) => s.resizeClip)
  const toggleMute = useArrangementStore((s) => s.toggleMute)
  const toggleSolo = useArrangementStore((s) => s.toggleSolo)
  const setTrackVolume = useArrangementStore((s) => s.setTrackVolume)
  const selectClip = useEditorStore((s) => s.selectClip)
  const toggleSelectClip = useEditorStore((s) => s.toggleSelectClip)
  const selectedClipIds  = useEditorStore((s) => s.selectedClipIds)
  const laneRef   = useRef<HTMLDivElement>(null)
  const isAudible = anySolo ? track.solo : !track.mute

  const trackId = track.id

  // Stable clipId-keyed callbacks: one function per lane, reused across all
  // its clips and identical from render to render. Critical for ClipBlock's
  // React.memo — without this, every TrackLane re-render produces new
  // function refs and busts memoization for every clip in the lane.
  const onMoveClip = useCallback(
    (clipId: string, sec: number) => moveClip(trackId, clipId, sec),
    [trackId, moveClip],
  )
  const onResizeClip = useCallback(
    (clipId: string, edge: 'start' | 'end', sec: number) => resizeClip(trackId, clipId, edge, sec),
    [trackId, resizeClip],
  )
  const onDuplicateClip = useCallback(
    (clip: Clip, newStartSec: number) => {
      const length = clip.end_sec - clip.start_sec
      const clone: Clip = {
        ...clip,
        id:        cryptoRandomId(),
        start_sec: newStartSec,
        end_sec:   newStartSec + length,
      }
      addClip(trackId, clone)
    },
    [trackId, addClip],
  )
  const onRemoveClip = useCallback(
    (clipId: string) => removeClip(trackId, clipId),
    [trackId, removeClip],
  )
  const onSelectClipCb = useCallback(
    (clipId: string, additive: boolean) =>
      additive ? toggleSelectClip(clipId, true) : selectClip(clipId),
    [toggleSelectClip, selectClip],
  )

  const maybeSnap = useCallback(
    (sec: number) => (snap && stepSec > 0 ? snapSec(sec, stepSec) : sec),
    [snap, stepSec],
  )

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer.types
    if (types.includes('application/x-mashfusion-stem') ||
        types.includes('application/x-mashfusion-sample')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!laneRef.current) return
    const rect = laneRef.current.getBoundingClientRect()
    const startSec = maybeSnap(Math.max(0, (e.clientX - rect.left) / pxPerSec))

    const stemData = e.dataTransfer.getData('application/x-mashfusion-stem')
    if (stemData) {
      e.preventDefault()
      const payload = JSON.parse(stemData) as DragPayload
      const length  = payload.duration ?? 8
      const clip = makeClip('stem', payload.asset_ref, startSec, length)
      addClip(trackId, clip)
      return
    }

    const sampleData = e.dataTransfer.getData('application/x-mashfusion-sample')
    if (!sampleData) return
    e.preventDefault()
    const payload = JSON.parse(sampleData) as DragPayload
    const length  = payload.duration ?? 4
    setAssetUrl(payload.asset_ref, payload.signed_url)
    const clip = makeClip(payload.asset_kind, payload.asset_ref, startSec, length)
    addClip(trackId, clip)
  }

  // URL lookup memoized by stems + assetUrls — same identity for both
  // means same Map identity, so ClipBlock memo doesn't bust on unrelated
  // changes.
  const urlForRef = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of stems) if (s.signed_url) m.set(s.s3_key, s.signed_url)
    for (const [k, v] of Array.from(assetUrls)) m.set(k, v)
    return m
  }, [stems, assetUrls])

  // Stem lookup map — avoids O(N×M) array scans.
  const stemByRef = useMemo(() => {
    const m = new Map<string, ProjectStem>()
    for (const s of stems) m.set(s.s3_key, s)
    return m
  }, [stems])

  const stripeClass = track.lane % 2 === 0 ? 'bg-black/10' : 'bg-black/20'

  return (
    <div
      className={`flex border-b border-black/40 ${stripeClass}`}
      style={{ height: LANE_HEIGHT }}
    >
      <LaneHeader
        track={track}
        onMute={() => toggleMute(trackId)}
        onSolo={() => toggleSolo(trackId)}
        onVolume={(v) => setTrackVolume(trackId, v)}
        isAudible={isAudible}
        getTrackLevel={getTrackLevel}
      />
      <div
        ref={laneRef}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`relative ${track.mute ? 'opacity-40' : ''}`}
        style={{ width: widthPx }}
      >
        {track.clips.map((clip) => {
          // Viewport culling — skip clips fully outside the visible band.
          const leftPx  = clip.start_sec * pxPerSec
          const rightPx = clip.end_sec   * pxPerSec
          if (rightPx < viewport.left || leftPx > viewport.right) return null
          return (
            <ClipBlock
              key={clip.id}
              trackId={trackId}
              clip={clip}
              stem={clip.asset_kind === 'stem' ? stemByRef.get(clip.asset_ref) : undefined}
              url={urlForRef.get(clip.asset_ref) ?? null}
              laneRef={laneRef}
              pxPerSec={pxPerSec}
              snapStepSec={snap ? stepSec : 0}
              selected={selectedClipIds.has(clip.id)}
              onMove={onMoveClip}
              onDuplicate={onDuplicateClip}
              onResize={onResizeClip}
              onRemove={onRemoveClip}
              onSelect={onSelectClipCb}
            />
          )
        })}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Lane header (mute / solo / name / volume / level meter).
// ──────────────────────────────────────────────────────────────────────
function LaneHeader({
  track, onMute, onSolo, onVolume, isAudible, getTrackLevel,
}: {
  track: Track
  onMute: () => void
  onSolo: () => void
  onVolume: (v: number) => void
  isAudible: boolean
  getTrackLevel?: (trackId: string) => number | undefined
}) {
  const removeTrack = useArrangementStore((s) => s.removeTrack)
  const canDelete = track.user_created === true && track.clips.length === 0
  const handleDelete = () => {
    if (canDelete) removeTrack(track.id)
  }
  return (
    <div
      className="shrink-0 border-r border-black/50 flex bg-[#21252c]"
      style={{ width: HEADER_WIDTH }}
    >
      {/* Left column: name row + mute/solo/slider */}
      <div className="flex-1 px-2 py-1.5 flex flex-col justify-between min-w-0 overflow-hidden">
        <div className="flex items-center gap-1">
          <div className="flex-1 text-[11px] font-semibold text-white/85 truncate" title={track.name}>
            {track.name}
          </div>
          {canDelete && (
            <button
              onClick={handleDelete}
              className="h-4 w-4 rounded flex items-center justify-center text-white/40 hover:text-red-200 hover:bg-red-500/20 transition-colors"
              title="Delete empty track"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onMute}
            className={`h-5 w-5 rounded flex items-center justify-center transition-colors shrink-0 btn-led ${
              track.mute ? 'on text-red-100' : 'text-white/50 hover:text-white/80'
            }`}
            title={track.mute ? 'Unmute' : 'Mute'}
          >
            {track.mute ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
          <button
            onClick={onSolo}
            className={`h-5 w-5 rounded flex items-center justify-center transition-colors shrink-0 btn-led ${
              track.solo ? 'on text-amber-100' : 'text-white/50 hover:text-white/80'
            }`}
            title={track.solo ? 'Unsolo' : 'Solo'}
          >
            <Headphones className="h-3 w-3" />
          </button>
          <input
            type="range"
            min={-24}
            max={12}
            step={0.5}
            value={track.volume_db}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="flex-1 min-w-0 daw-range"
            title={`Volume ${track.volume_db.toFixed(1)} dB`}
          />
        </div>
      </div>
      {/* Right column: full-height level meter */}
      <LaneLevelMeter trackId={track.id} isAudible={isAudible} getTrackLevel={getTrackLevel} />
    </div>
  )
}

// Full-height Web Audio analyser-driven level meter.
// Reads RMS from per-track analyser nodes via getTrackLevel() every rAF
// frame. All DOM writes bypass React — zero re-renders per frame.
function LaneLevelMeter({
  trackId,
  isAudible,
  getTrackLevel,
}: {
  trackId: string
  isAudible: boolean
  getTrackLevel?: (trackId: string) => number | undefined
}) {
  const leftMaskRef = useRef<HTMLDivElement>(null)
  const rightMaskRef = useRef<HTMLDivElement>(null)
  const leftPeakRef = useRef<HTMLDivElement>(null)
  const rightPeakRef = useRef<HTMLDivElement>(null)
  const leftLevelRef = useRef(0)
  const rightLevelRef = useRef(0)
  const leftPeakValRef = useRef(0)
  const rightPeakValRef = useRef(0)
  const leftPeakTimeRef = useRef(0)
  const rightPeakTimeRef = useRef(0)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const raw = getTrackLevel?.(trackId) ?? 0
      const base = Math.max(0, Math.min(1, raw))
      const leftTarget = base
      const rightTarget = Math.max(0, Math.min(1, base * 0.96 + 0.02))

      const nextLeft = leftTarget > leftLevelRef.current
        ? leftLevelRef.current + (leftTarget - leftLevelRef.current) * 0.5
        : leftLevelRef.current * 0.88
      const nextRight = rightTarget > rightLevelRef.current
        ? rightLevelRef.current + (rightTarget - rightLevelRef.current) * 0.5
        : rightLevelRef.current * 0.88
      leftLevelRef.current = nextLeft < 0.001 ? 0 : nextLeft
      rightLevelRef.current = nextRight < 0.001 ? 0 : nextRight

      const now = Date.now()
      if (nextLeft > leftPeakValRef.current) {
        leftPeakValRef.current = nextLeft
        leftPeakTimeRef.current = now
      } else if (now - leftPeakTimeRef.current > 1400) {
        leftPeakValRef.current = Math.max(0, leftPeakValRef.current * 0.993)
      }
      if (nextRight > rightPeakValRef.current) {
        rightPeakValRef.current = nextRight
        rightPeakTimeRef.current = now
      } else if (now - rightPeakTimeRef.current > 1400) {
        rightPeakValRef.current = Math.max(0, rightPeakValRef.current * 0.993)
      }

      const leftMask = leftMaskRef.current
      if (leftMask) leftMask.style.height = `${Math.max(0, (1 - leftLevelRef.current)) * 100}%`
      const rightMask = rightMaskRef.current
      if (rightMask) rightMask.style.height = `${Math.max(0, (1 - rightLevelRef.current)) * 100}%`

      const leftPeak = leftPeakRef.current
      if (leftPeak) {
        leftPeak.style.bottom = `${leftPeakValRef.current * 100}%`
        leftPeak.style.opacity = leftPeakValRef.current > 0.01 ? '1' : '0'
      }
      const rightPeak = rightPeakRef.current
      if (rightPeak) {
        rightPeak.style.bottom = `${rightPeakValRef.current * 100}%`
        rightPeak.style.opacity = rightPeakValRef.current > 0.01 ? '1' : '0'
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [trackId, getTrackLevel])

  return (
    <div
      className="relative self-stretch my-1 mr-1.5 rounded-sm overflow-hidden shrink-0 flex items-end gap-0.5 px-0.5"
      style={{
        width: 18,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.35))',
        border: '1px solid rgba(0,0,0,0.6)',
        opacity: isAudible ? 1 : 0.3,
      }}
      title="Lane level meter"
      aria-label="Lane level meter"
    >
      {(['L', 'R'] as const).map((side) => (
        <div
          key={side}
          className="relative flex-1 h-full rounded-sm overflow-hidden"
          style={{
            background: 'linear-gradient(to top, #10b981 0%, #10b981 65%, #f59e0b 65%, #f59e0b 88%, #ef4444 88%, #ef4444 100%)',
          }}
        >
          <div
            ref={side === 'L' ? leftMaskRef : rightMaskRef}
            className="absolute top-0 left-0 right-0"
            style={{ height: '100%', background: 'rgba(13,13,20,0.92)' }}
          />
          <div
            ref={side === 'L' ? leftPeakRef : rightPeakRef}
            className="absolute left-0 right-0"
            style={{ height: 1, bottom: '0%', opacity: 0, background: 'rgba(255,255,255,0.85)' }}
          />
        </div>
      ))}
      <div className="absolute left-0 right-0 bottom-0 text-[7px] font-mono text-white/40 flex justify-between px-0.5">
        <span>L</span>
        <span>R</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// ClipBlock — pointer-driven drag + resize (no HTML5 drag).
// - Move starts only on the clip body.
// - Resize starts only on the explicit left/right handle divs.
// - Handles call stopPropagation() + preventDefault() so move never starts
//   from a handle.
// ──────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────
interface ClipBlockProps {
  trackId: string
  clip:    Clip
  stem?:   ProjectStem
  url:     string | null
  laneRef: React.RefObject<HTMLDivElement>
  pxPerSec: number
  snapStepSec: number
  selected: boolean
  onMove:      (clipId: string, sec: number) => void
  onDuplicate: (clip: Clip, newStartSec: number) => void
  onResize:    (clipId: string, edge: 'start' | 'end', sec: number) => void
  onRemove:    (clipId: string) => void
  onSelect:    (clipId: string, additive: boolean) => void
}

const ClipBlock = memo(function ClipBlock({
  trackId, clip, stem, url, laneRef, pxPerSec, snapStepSec,
  selected, onMove, onDuplicate, onResize, onRemove, onSelect,
}: ClipBlockProps) {
  const ref        = useRef<HTMLDivElement>(null)
  const trimOverlay = useRef<HTMLDivElement>(null)

  const left  = clip.start_sec * pxPerSec
  const width = Math.max(20, (clip.end_sec - clip.start_sec) * pxPerSec)
  const length = clip.end_sec - clip.start_sec

  const label = stem
    ? `${stem.side.toUpperCase()} · ${stem.stem_name}`
    : clip.asset_ref.split('/').pop() ?? 'clip'

  const colour = colourForClip(clip, stem)

  const snap = useCallback(
    (sec: number) => snapStepSec > 0 ? Math.round(sec / snapStepSec) * snapStepSec : sec,
    [snapStepSec],
  )

  const HANDLE_W = 10   // px — matches visual handle width below

  // ── single pointer handler (move vs resize) ─────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()

    const lane = laneRef.current
    const block = ref.current
    if (!lane || !block) return

    onSelect(clip.id, e.shiftKey || e.metaKey || e.ctrlKey)

    const MIN_CLIP_SEC = 0.001
    const rect    = block.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const clipW   = rect.width

    type Mode = 'move' | 'resize-start' | 'resize-end'
    const edgeEl = (e.target as HTMLElement | null)?.closest?.('[data-resize-edge]') as HTMLElement | null
    const edgeAttr = edgeEl?.dataset?.resizeEdge
    const mode: Mode = edgeAttr === 'start'
      ? 'resize-start'
      : edgeAttr === 'end'
        ? 'resize-end'
        : offsetX <= HANDLE_W
          ? 'resize-start'
          : offsetX >= clipW - HANDLE_W
            ? 'resize-end'
            : 'move'

    if (mode === 'move') {
      const startMouseX = e.clientX
      const startLeft   = clip.start_sec
      let committedSec  = startLeft
      let moved = false

      // Option/Alt held at pointerdown → start in copy mode.
      // User can toggle copy/move mid-drag by pressing/releasing Alt.
      const copyModeRef = { current: e.altKey }

      document.body.classList.add('iomixo-dragging')
      document.body.dataset.dragMode = copyModeRef.current ? 'copy' : 'move'

      const updateCopyMode = (on: boolean) => {
        copyModeRef.current = on
        document.body.dataset.dragMode = on ? 'copy' : 'move'
        if (on) block.dataset.copyDrag = 'true'
        else    delete block.dataset.copyDrag
        // Show/hide the + badge directly (bypasses React re-render during drag)
        const badge = block.querySelector('.copy-drag-badge') as HTMLElement | null
        if (badge) badge.style.display = on ? 'flex' : 'none'
      }

      // Initialise badge to match starting alt state.
      updateCopyMode(copyModeRef.current)

      const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === 'Alt') { ev.preventDefault(); updateCopyMode(true) } }
      const onKeyUp   = (ev: KeyboardEvent) => { if (ev.key === 'Alt') updateCopyMode(false) }
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup',   onKeyUp)

      const move = (ev: PointerEvent) => {
        const dx   = ev.clientX - startMouseX
        const next = Math.max(0, snap(startLeft + dx / pxPerSec))
        committedSec = next
        if (Math.abs(next - startLeft) > 0.001) moved = true
        block.style.transform = `translate3d(${(next - startLeft) * pxPerSec}px,0,0)`
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup',   up)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup',   onKeyUp)
        document.body.classList.remove('iomixo-dragging')
        delete document.body.dataset.dragMode
        delete block.dataset.copyDrag
        block.style.transform = ''
        if (moved) {
          if (copyModeRef.current) {
            onDuplicate(clip, committedSec)
          } else {
            onMove(clip.id, committedSec)
          }
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup',   up)
      return
    }

    // ── RESIZE ────────────────────────────────────────────────────────
    e.preventDefault()
    const edge         = mode === 'resize-start' ? 'start' : 'end'
    const startEdgeSec = edge === 'start' ? clip.start_sec : clip.end_sec
    const otherEdgeSec = edge === 'start' ? clip.end_sec   : clip.start_sec
    const startMouseX  = e.clientX
    let rawSec   = startEdgeSec
    let hasMoved = false

    block.dataset.resizing = 'true'
    document.body.classList.add('iomixo-dragging')
    document.body.dataset.dragMode = 'resize'

    // Show the trim-preview overlay (dark mask on the region being cut).
    const ov = trimOverlay.current
    const clipOrigW = block.getBoundingClientRect().width

    const move = (ev: PointerEvent) => {
      rawSec   = startEdgeSec + (ev.clientX - startMouseX) / pxPerSec
      hasMoved = true
      if (ov) {
        if (edge === 'start') {
          // Trim from left: mask covers left portion being cut away.
          const newStart  = Math.max(0, Math.min(rawSec, otherEdgeSec - MIN_CLIP_SEC))
          const cutPx     = Math.max(0, (newStart - clip.start_sec) * pxPerSec)
          ov.style.left   = '0px'
          ov.style.width  = `${cutPx}px`
          ov.style.right  = ''
          ov.style.display = cutPx > 0 ? 'block' : 'none'
        } else {
          // Trim from right: mask covers right portion being cut away.
          const newEnd    = Math.max(rawSec, otherEdgeSec + MIN_CLIP_SEC)
          const cutPx     = Math.max(0, (clip.end_sec - newEnd) * pxPerSec)
          ov.style.right  = '0px'
          ov.style.left   = ''
          ov.style.width  = `${Math.min(cutPx, clipOrigW)}px`
          ov.style.display = cutPx > 0 ? 'block' : 'none'
        }
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup',   up)
      delete block.dataset.resizing
      document.body.classList.remove('iomixo-dragging')
      delete document.body.dataset.dragMode
      if (ov) { ov.style.display = 'none'; ov.style.width = '0' }
      if (hasMoved) onResize(clip.id, edge, rawSec)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup',   up)
  }, [clip.id, clip.start_sec, clip.end_sec, laneRef, onMove, onDuplicate, onResize, onSelect, pxPerSec, snap])

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      className={`absolute top-1 bottom-1 rounded-md select-none group transition-shadow clip-block ${
        selected ? 'clip-selected' : ''
      }`}
      style={{
        left, width,
        ['--clip-color' as string]: colour,
        willChange: 'transform',
      } as CSSProperties}
      title={`${label} — ${length.toFixed(2)}s`}
      data-track-id={trackId}
    >
      {/* ── Trim preview overlay: dark mask over the region being cut.
           Hidden by default; shown during resize via direct DOM style. ── */}
      <div
        ref={trimOverlay}
        className="absolute top-0 bottom-0 z-25 pointer-events-none rounded-sm"
        style={{ display: 'none', width: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'brightness(0.4)' }}
      />

      {/* ── Interior content clipped to clip bounds ── */}
      <div className="absolute inset-0 overflow-hidden rounded-md pointer-events-none">
        <div className="px-2 py-1 text-[10px] font-semibold text-white/90 truncate relative z-10">
          {label}
        </div>

        {url && stem?.duration_sec && stem.duration_sec > 0 && width > 16 && (
          <div className="absolute inset-0 clip-waveform">
            <Waveform
              url={url}
              width={Math.max(1, width)}
              height={LANE_HEIGHT - 2}
              colour={colour}
              startSec={clip.offset_sec}
              endSec={clip.offset_sec + length}
              totalSec={stem.duration_sec}
              highlight={selected}
            />
          </div>
        )}

        {url && !stem && width > 16 && (
          <div className="absolute inset-0 clip-waveform">
            <Waveform
              url={url}
              width={Math.max(1, width)}
              height={LANE_HEIGHT - 2}
              colour={colour}
              highlight={selected}
            />
          </div>
        )}
      </div>

      {/* ── Resize handles — transparent hit-target with a thin edge line ── */}
      <div
        data-resize-edge="start"
        className={`absolute top-0 bottom-0 left-0 z-30 cursor-ew-resize transition-opacity ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ width: HANDLE_W }}
        title="Trim start"
      >
        {/* Thin visible line at the very left edge */}
        <div className="absolute top-1 bottom-1 left-0 w-[2px] rounded-full" style={{ background: colour }} />
      </div>
      <div
        data-resize-edge="end"
        className={`absolute top-0 bottom-0 right-0 z-30 cursor-ew-resize transition-opacity ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ width: HANDLE_W }}
        title="Trim end"
      >
        {/* Thin visible line at the very right edge */}
        <div className="absolute top-1 bottom-1 right-0 w-[2px] rounded-full" style={{ background: colour }} />
      </div>

      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(clip.id) }}
        className="absolute top-0.5 right-1.5 h-4 w-4 rounded-full bg-black/50 hover:bg-red-500/70 text-white/85 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-30"
        title="Remove clip"
      >
        <X className="h-2.5 w-2.5" />
      </button>

      {/* ── Copy-drag badge: shown via CSS when data-copy-drag is set ── */}
      <div
        className="copy-drag-badge absolute -top-2 -right-2 h-5 w-5 rounded-full bg-cyan-400 text-black flex items-center justify-center z-40 pointer-events-none text-[10px] font-bold shadow-lg"
        style={{ display: 'none' }}
      >
        +
      </div>
    </div>
  )
})

function colourForClip(clip: Clip, stem?: ProjectStem): string {
  if (stem) {
    const map: Record<string, string> = {
      vocals: '#ec4899',
      drums:  '#f59e0b',
      bass:   '#22d3ee',
      other:  '#a855f7',
    }
    return map[stem.stem_name] ?? '#a855f7'
  }
  if (clip.asset_kind === 'soundbank') return '#10b981'
  if (clip.asset_kind === 'user_sample') return '#6366f1'
  return '#a855f7'
}

function makeClip(
  asset_kind: Clip['asset_kind'],
  asset_ref: string,
  startSec: number,
  lengthSec: number,
): Clip {
  return {
    id: cryptoRandomId(),
    asset_kind,
    asset_ref,
    start_sec:          startSec,
    end_sec:            startSec + lengthSec,
    offset_sec:         0,
    gain_db:            0,
    fade_in_sec:        asset_kind === 'stem' ? 0.05 : 0.02,
    fade_out_sec:       asset_kind === 'stem' ? 0.10 : 0.05,
    pitch_semitones:    0,
    time_stretch_ratio: 1,
  }
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgb')) return hex
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
