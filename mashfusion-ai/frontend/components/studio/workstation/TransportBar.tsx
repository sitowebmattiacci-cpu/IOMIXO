'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Play, Pause, Square, Save, Sparkles, Magnet,
  Music2, Repeat, ZoomIn, ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useArrangementStore } from '@/lib/stores/useArrangementStore'
import {
  useEditorStore, GRID_OPTIONS,
  MIN_PX_PER_SEC, MAX_PX_PER_SEC, DEFAULT_PX_PER_SEC,
} from '@/lib/stores/useEditorStore'

interface Props {
  bpm: number
  musicalKey: string | null
  durationSec: number
  isPlaying: boolean
  isSaving: boolean
  isRendering: boolean
  dirty: boolean
  /** Live playhead reader — drives the bar/beat counter without re-rendering
   *  the whole bar on every rAF. */
  playheadRef: React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  showBrowser: boolean
  showAITools: boolean
  inspectorOpen: boolean
  onPlayToggle: () => void
  onStop: () => void
  onSave: () => void
  onRender: () => void
  onToggleBrowser: () => void
  onToggleAITools: () => void
  onToggleInspector: () => void
}

export function TransportBar({
  bpm, musicalKey, durationSec,
  isPlaying, isSaving, isRendering, dirty,
  playheadRef, isPlayingRef,
  showBrowser, showAITools, inspectorOpen,
  onPlayToggle, onStop, onSave, onRender,
  onToggleBrowser, onToggleAITools, onToggleInspector,
}: Props) {
  const snap          = useEditorStore((s) => s.snap)
  const resolution    = useEditorStore((s) => s.resolution)
  const setResolution = useEditorStore((s) => s.setResolution)
  const setSnap       = useEditorStore((s) => s.setSnap)
  const pxPerSec      = useEditorStore((s) => s.pxPerSec)
  const setPxPerSec   = useEditorStore((s) => s.setPxPerSec)
  const metronomeOn   = useEditorStore((s) => s.metronomeOn)
  const setMetronome  = useEditorStore((s) => s.setMetronome)
  const loopOn        = useEditorStore((s) => s.loopOn)
  const setLoop       = useEditorStore((s) => s.setLoop)
  const loopStartSec  = useEditorStore((s) => s.loopStartSec)
  const loopEndSec    = useEditorStore((s) => s.loopEndSec)
  const setLoopRegion = useEditorStore((s) => s.setLoopRegion)
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds)
  const arrangement = useArrangementStore((s) => s.arrangement)

  const loopLabel = useMemo(() => {
    if (loopStartSec == null || loopEndSec == null || loopEndSec <= loopStartSec) return 'Loop: off'
    return `Loop: ${formatSecPrec(loopStartSec)} - ${formatSecPrec(loopEndSec)}`
  }, [loopStartSec, loopEndSec])

  const handleLoopClick = () => {
    if (!arrangement) return
    const beatSec = bpm > 0 ? 60 / bpm : 0.5
    const barSec = beatSec * 4
    if (selectedClipIds.size > 0) {
      const bounds = getSelectedClipBounds(arrangement.tracks, selectedClipIds)
      if (bounds) {
        const snapped = snapLoopRange(bounds.startSec, bounds.endSec, beatSec, durationSec)
        setLoopRegion(snapped.startSec, snapped.endSec)
        setLoop(true)
        return
      }
    }
    const hasRegion = loopStartSec != null && loopEndSec != null && loopEndSec > loopStartSec
    if (!hasRegion) {
      if (durationSec > 0.01) {
        const playheadSec = playheadRef.current
        const startSec = Math.max(0, Math.floor(playheadSec / beatSec) * beatSec)
        const endSec = startSec + barSec * 4
        const snapped = snapLoopRange(startSec, endSec, beatSec, durationSec)
        setLoopRegion(snapped.startSec, snapped.endSec)
        setLoop(true)
      } else {
        toast('Seleziona una clip per creare un loop')
      }
      return
    }
    setLoop(!loopOn)
  }

  return (
    <div className="daw-panel-header flex items-center justify-between gap-3 px-4 h-12 border-b border-black/40 backdrop-blur shrink-0">
      {/* ── transport controls ───────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap justify-end min-w-0">
        <button
          onClick={onPlayToggle}
          className={`btn-led h-9 w-9 rounded-md flex items-center justify-center transition-all ${
            isPlaying ? 'on' : ''
          }`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
        </button>
        <button
          onClick={onStop}
          className="btn-led h-8 w-8 rounded-md flex items-center justify-center"
          title="Stop"
        >
          <Square className="h-3.5 w-3.5" />
        </button>

        <ToggleChip
          active={metronomeOn}
          onClick={() => setMetronome(!metronomeOn)}
          icon={<Music2 className="h-3 w-3" />}
          label="Click"
          accent="amber"
          title="Toggle metronome"
        />
        <ToggleChip
          active={loopOn}
          onClick={handleLoopClick}
          icon={<Repeat className="h-3 w-3" />}
          label="Loop"
          accent="cyan"
          title="Toggle loop"
        />

      </div>

      {/* ── readout ──────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-[10px] font-mono text-white/70">
        <BarBeatCounter
          bpm={bpm}
          playheadRef={playheadRef}
          isPlayingRef={isPlayingRef}
        />
        <BpmField bpm={bpm} />
        {musicalKey && <span><span className="text-white/30">Key</span>&nbsp;{musicalKey}</span>}
        <span><span className="text-white/30">Length</span>&nbsp;{formatSec(durationSec)}</span>
      </div>

      {/* ── snap + zoom + actions ───────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Snap toggle + dropdown */}
        <div className="flex items-center rounded-md border border-black/60 bg-white/[0.03] overflow-hidden">
          <button
            onClick={() => setSnap(!snap)}
            className={`flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors ${
              snap ? 'bg-emerald-500/15 text-emerald-200' : 'text-white/50 hover:text-white/85'
            }`}
            title={snap ? 'Disable beat snap' : 'Enable beat snap'}
          >
            <Magnet className="h-3 w-3" />
            <span>Snap</span>
          </button>
          <div className="border-l border-white/10">
            <select
              value={resolution}
              onChange={(e) => {
                const r = e.target.value as typeof resolution
                setResolution(r)
              }}
              className="bg-transparent px-2 py-1 text-[10px] font-mono text-white/80 hover:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/40 cursor-pointer"
              title="Snap resolution"
            >
              {GRID_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-[#15151c] text-white">
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Zoom slider */}
        <div className="flex items-center gap-1 rounded-md border border-black/60 bg-white/[0.03] px-2 py-1">
          <button
            onClick={() => setPxPerSec(pxPerSec - 8)}
            className="text-white/40 hover:text-white/80 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <input
            type="range"
            min={MIN_PX_PER_SEC}
            max={MAX_PX_PER_SEC}
            step={1}
            value={pxPerSec}
            onChange={(e) => setPxPerSec(Number(e.target.value))}
            className="w-20 daw-range"
            title="Timeline zoom"
          />
          <button
            onClick={() => setPxPerSec(pxPerSec + 8)}
            className="text-white/40 hover:text-white/80 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <button
            onClick={() => setPxPerSec(DEFAULT_PX_PER_SEC)}
            className="ml-1 text-[9px] text-white/40 hover:text-white/80 font-mono"
            title="Reset zoom"
          >
            1×
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-black/60 bg-white/[0.03] px-1.5 py-1">
          <ViewChip
            active={showBrowser}
            onClick={onToggleBrowser}
            label="Browser"
            title={showBrowser ? 'Hide Browser' : 'Show Browser'}
          />
          <ViewChip
            active={inspectorOpen}
            onClick={onToggleInspector}
            label="Inspector"
            title={inspectorOpen ? 'Hide Inspector' : 'Show Inspector'}
          />
          <ViewChip
            active={showAITools}
            onClick={onToggleAITools}
            label="AI"
            title={showAITools ? 'Hide AI Tools' : 'Show AI Tools'}
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={<Save className="h-3 w-3" />}
          loading={isSaving}
          disabled={!dirty}
          onClick={onSave}
          className="h-6 px-1.5 py-0.5 text-[9px] leading-none uppercase tracking-wide rounded-md"
        >
          {dirty ? 'Save' : 'Saved'}
        </Button>
        <Button
          size="sm"
          icon={<Sparkles className="h-3 w-3" />}
          loading={isRendering}
          onClick={onRender}
          className="h-6 px-1.5 py-0.5 text-[9px] leading-none uppercase tracking-wide rounded-md"
        >
          Render
        </Button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Live bar.beat.tick counter that ticks via rAF without re-rendering
// the whole transport bar.
// ──────────────────────────────────────────────────────────────────────
function BarBeatCounter({
  bpm, playheadRef, isPlayingRef,
}: {
  bpm: number
  playheadRef:  React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
}) {
  const [text, setText] = useState('1.1.0')

  useEffect(() => {
    let raf = 0
    let last = ''
    const frame = () => {
      const sec = playheadRef.current
      const beatSec = 60 / bpm
      const totalBeats = sec / beatSec
      const bar  = Math.floor(totalBeats / 4) + 1
      const beat = (Math.floor(totalBeats) % 4) + 1
      const subTick = Math.floor((totalBeats - Math.floor(totalBeats)) * 4)
      const next = `${bar}.${beat}.${subTick}`
      if (next !== last) {
        setText(next)
        last = next
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [bpm, playheadRef, isPlayingRef])

  return (
    <span className="px-2 py-1 rounded daw-panel-inset text-emerald-200/90 font-mono tabular-nums">
      {text}
    </span>
  )
}

function BpmField({ bpm }: { bpm: number }) {
  const setBpm = useArrangementStore((s) => s.setBpm)
  const [text, setText] = useState(String(Math.round(bpm)))

  // Keep local input synced when the underlying arrangement bpm changes
  // (e.g. when a project loads). We compare numerically so partial edits
  // like "12" don't get stomped while the user is typing.
  useEffect(() => {
    if (Math.round(Number(text)) !== Math.round(bpm)) {
      setText(String(Math.round(bpm)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm])

  const commit = (raw: string) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) { setText(String(Math.round(bpm))); return }
    const clamped = Math.max(20, Math.min(300, Math.round(n)))
    setBpm(clamped)
    setText(String(clamped))
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className="text-white/30">BPM</span>
      <input
        type="number"
        min={20}
        max={300}
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp')   { e.preventDefault(); commit(String(Number(text) + 1)) }
          if (e.key === 'ArrowDown') { e.preventDefault(); commit(String(Number(text) - 1)) }
        }}
        className="w-12 daw-panel-inset rounded px-1.5 py-0.5 text-[11px] font-mono text-white/90 tabular-nums focus:outline-none focus:border-emerald-400/50"
        title="Project tempo (BPM)"
      />
    </label>
  )
}

function ToggleChip({
  active, onClick, icon, label, accent, title,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  accent: 'amber' | 'cyan'
  title: string
}) {
  const onCls = accent === 'amber'
    ? 'btn-led on text-amber-100'
    : 'btn-led on text-cyan-100'
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-colors ${
        active ? onCls : 'btn-led text-white/50 hover:text-white/85'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function ViewChip({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean
  onClick: () => void
  label: string
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wide transition-colors ${
        active ? 'btn-led on' : 'btn-led text-white/50'
      }`}
    >
      {label}
    </button>
  )
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

function formatSecPrec(s: number): string {
  const sec = Math.max(0, s)
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const r = (sec % 60).toFixed(1).padStart(4, '0')
  return `${m}:${r}`
}

function snapLoopRange(
  startSec: number,
  endSec: number,
  beatSec: number,
  durationSec: number,
): { startSec: number; endSec: number } {
  if (beatSec <= 0) {
    const start = Math.max(0, startSec)
    const end = Math.max(start + 0.01, Math.min(durationSec, endSec))
    return { startSec: start, endSec: end }
  }
  const snappedStart = Math.max(0, Math.floor(startSec / beatSec) * beatSec)
  const snappedEnd = Math.max(snappedStart + beatSec, Math.ceil(endSec / beatSec) * beatSec)
  const end = Math.min(durationSec, snappedEnd)
  return { startSec: snappedStart, endSec: end > snappedStart ? end : snappedStart + beatSec }
}

function getSelectedClipBounds(
  tracks: Array<{ clips: Array<{ id: string; start_sec: number; end_sec: number }> }>,
  selected: Set<string>,
): { startSec: number; endSec: number } | null {
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  for (const t of tracks) {
    for (const c of t.clips) {
      if (!selected.has(c.id)) continue
      start = Math.min(start, c.start_sec)
      end = Math.max(end, c.end_sec)
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { startSec: start, endSec: end }
}
