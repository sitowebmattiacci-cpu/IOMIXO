'use client'

import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Music, Layers, Sparkles, Sliders, Trash2, Magnet, Wand2 } from 'lucide-react'
import { useArrangementStore } from '@/lib/stores/useArrangementStore'
import { useEditorStore, gridStepSec } from '@/lib/stores/useEditorStore'
import type { Clip, ProjectStem } from '@/types/arrangement'

type InspectorTab = 'clip' | 'fx'

interface Props {
  stems: ProjectStem[]
  isOpen: boolean
  onToggle: () => void
  onOpenSoundDesigner?: () => void
}

export function Inspector({ stems, isOpen, onToggle, onOpenSoundDesigner }: Props) {
  const arrangement = useArrangementStore((s) => s.arrangement)
  const removeClip  = useArrangementStore((s) => s.removeClip)
  const resizeClip  = useArrangementStore((s) => s.resizeClip)
  const moveClip    = useArrangementStore((s) => s.moveClip)
  const setClipGain = useArrangementStore((s) => s.setClipGain)
  const quantizeClips = useArrangementStore((s) => s.quantizeClips)
  const selectedIds = useEditorStore((s) => s.selectedClipIds)
  const resolution  = useEditorStore((s) => s.resolution)
  const clearSel    = useEditorStore((s) => s.clearSelection)
  const [tab, setTab] = useState<InspectorTab>('clip')

  // First selected (single-clip inspector for now).
  const found = useMemo(() => {
    if (!arrangement || selectedIds.size === 0) return null
    for (const t of arrangement.tracks) {
      for (const c of t.clips) {
        if (selectedIds.has(c.id)) return { track: t, clip: c }
      }
    }
    return null
  }, [arrangement, selectedIds])

  const hasSelection = !!found
  const expanded = isOpen && hasSelection

  if (!found) {
    return (
      <div className="daw-panel shrink-0 overflow-hidden">
        <div className="daw-panel-header flex items-center gap-2 px-3 py-2">
          <button
            onClick={onToggle}
            className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
              isOpen ? 'btn-led on' : 'btn-led text-white/60'
            }`}
            title="Toggle inspector"
          >
            Inspector
          </button>
          <span className="text-[10px] text-white/45">No clip selected</span>
          <span className="ml-auto text-[10px] text-white/30">
            {selectedIds.size > 1 ? `${selectedIds.size} clips selected` : ''}
          </span>
        </div>
      </div>
    )
  }

  const { track, clip } = found
  const length = clip.end_sec - clip.start_sec
  const stem   = clip.asset_kind === 'stem'
    ? stems.find((s) => s.s3_key === clip.asset_ref)
    : undefined

  const onLengthChange = (newLen: number) =>
    resizeClip(track.id, clip.id, 'end', clip.start_sec + Math.max(0.1, newLen))
  const onStartChange = (newStart: number) =>
    moveClip(track.id, clip.id, Math.max(0, newStart))

  return (
    <div className="daw-panel shrink-0 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="daw-panel-header flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggle}
          className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
            expanded ? 'btn-led on' : 'btn-led text-white/60'
          }`}
          title="Toggle inspector"
        >
          Inspector
        </button>
        <div className="text-[10px] text-white/35">
          {expanded ? 'Clip details' : 'Collapsed'}
        </div>
        <button
          onClick={() => onOpenSoundDesigner?.()}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] text-emerald-100 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-300/30 transition-colors"
          title="Open floating Sound Designer plugin"
        >
          <Wand2 className="h-3 w-3" />
          Sound Designer
        </button>
      </div>

      {/* ── Content ────────────────────────────────────────── */}
      {expanded && (
        <div className="max-h-[240px] overflow-y-auto">
          <div className="flex items-center gap-0 border-b border-white/6 px-3 pt-1.5">
            <TabBtn active={tab === 'clip'} onClick={() => setTab('clip')} icon={<Sliders className="h-3 w-3" />} label="Clip" />
            <TabBtn active={tab === 'fx'} onClick={() => setTab('fx')} icon={<Wand2 className="h-3 w-3" />} label="Sound Designer" accent />
          </div>

          {tab === 'clip' ? (
            <div className="px-4 py-3 overflow-x-auto overflow-y-hidden">
              <div className="rounded-lg border border-black/60 bg-[#1b1f25]/70 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
                <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
                  <Section label="Clip info" className="min-w-[220px] max-w-[320px]">
                    <ClipBadge clip={clip} stem={stem} />
                  </Section>

                  <Section label="Timing" className="min-w-[220px]">
                    <div className="flex items-start gap-2">
                      <NumField label="Start" value={clip.start_sec} unit="s" step={0.05} onChange={onStartChange} />
                      <NumField label="Length" value={length} unit="s" step={0.05} min={0.1} onChange={onLengthChange} />
                    </div>
                  </Section>

                  <Section label="Gain" className="min-w-[124px]">
                    <NumField
                      label="Level"
                      value={clip.gain_db}
                      unit="dB"
                      step={0.5}
                      min={-24}
                      max={12}
                      onChange={(v) => setClipGain(track.id, clip.id, v)}
                    />
                  </Section>

                  <Section label="Source" className="min-w-[220px] max-w-[320px]">
                    <div className="space-y-1">
                      <div className="text-[11px] text-white/85 capitalize truncate" title={track.name}>
                        Lane · {track.name}
                      </div>
                      <div className="text-[11px] text-white/60 capitalize truncate">
                        {clip.asset_kind === 'stem' ? `Stem · ${stem?.stem_name ?? 'unknown'}` :
                         clip.asset_kind === 'soundbank' ? 'Soundbank' :
                         'User Sample'}
                      </div>
                    </div>
                  </Section>

                  <Section label="Actions" className="ml-auto min-w-[230px]">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          if (!arrangement) return
                          const res = resolution === 'off' ? 'beat' : resolution
                          const step = gridStepSec(res, arrangement.bpm)
                          const moved = quantizeClips(step, { type: 'ids', ids: new Set(selectedIds) })
                          toast.success(moved > 0
                            ? `Synced ${moved} clip${moved === 1 ? '' : 's'} to ${arrangement.bpm} BPM`
                            : 'Clip already on grid')
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] text-emerald-100 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 transition-colors"
                        title="Snap clip start to the metronome grid"
                      >
                        <Magnet className="h-3.5 w-3.5" />
                        Sync Clip
                      </button>
                      <button
                        onClick={() => { removeClip(track.id, clip.id); clearSel() }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] text-red-300/80 hover:bg-red-500/15 hover:text-red-200 border border-red-400/20 transition-colors"
                        title="Delete clip"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </Section>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-4 py-2">
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/5 px-4 py-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-emerald-100">Floating Sound Designer Plugin</div>
                  <div className="text-[11px] text-white/50 mt-0.5">
                    Use the floating window for full plugin controls, drag/reposition, presets and A/B compare.
                  </div>
                </div>
                <button
                  onClick={() => onOpenSoundDesigner?.()}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-300/30 transition-colors"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Open Sound Designer
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TabBtn({
  active, onClick, icon, label, accent,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-t-md border-b-2 transition-colors ${
        active
          ? accent
            ? 'border-emerald-300 text-emerald-100 bg-emerald-500/10'
            : 'border-white/40 text-white/90 bg-white/[0.03]'
          : 'border-transparent text-white/35 hover:text-white/60 hover:bg-white/[0.02]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function ClipBadge({ clip, stem }: { clip: Clip; stem?: ProjectStem }) {
  const colour = stemColour(clip, stem)
  const icon =
    clip.asset_kind === 'stem'      ? <Music className="h-4 w-4" /> :
    clip.asset_kind === 'soundbank' ? <Sparkles className="h-4 w-4" /> :
                                      <Layers className="h-4 w-4" />
  const title = stem ? `${stem.side.toUpperCase()} · ${stem.stem_name}` :
    clip.asset_ref.split('/').pop() ?? 'Clip'
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div
        className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${colour}26`, color: colour }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-white/35 font-mono">Selected</div>
        <div className="text-xs font-semibold text-white truncate max-w-[240px]" title={title}>
          {title}
        </div>
      </div>
    </div>
  )
}

function Section({
  label, children, className = '',
}: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[10px] uppercase tracking-wider text-white/32 font-mono mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function NumField({
  label, value, unit, step = 0.1, min, max, onChange, readOnly,
}: {
  label: string
  value: number
  unit?: string
  step?: number
  min?: number
  max?: number
  onChange: (v: number) => void
  readOnly?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/30 font-mono mb-1">{label}</div>
      <div className={`flex items-baseline gap-1 rounded-md border px-2 py-1 ${
        readOnly
          ? 'border-white/5 bg-black/20 text-white/60'
          : 'border-black/60 bg-black/25 text-white/95 focus-within:border-emerald-400/50'
      }`}>
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={Number(value.toFixed(2))}
          readOnly={readOnly}
          onChange={(e) => !readOnly && onChange(Number(e.target.value))}
          className="w-[76px] bg-transparent text-xs font-mono tabular-nums focus:outline-none"
        />
        {unit && <span className="text-[10px] text-white/35">{unit}</span>}
      </div>
    </div>
  )
}

function stemColour(clip: Clip, stem?: ProjectStem): string {
  if (stem) {
    const m: Record<string, string> = {
      vocals: '#ec4899', drums: '#f59e0b', bass: '#22d3ee', other: '#a855f7',
    }
    return m[stem.stem_name] ?? '#a855f7'
  }
  if (clip.asset_kind === 'soundbank') return '#10b981'
  if (clip.asset_kind === 'user_sample') return '#6366f1'
  return '#a855f7'
}
