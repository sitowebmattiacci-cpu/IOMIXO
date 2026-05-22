'use client'

import { useCallback, useState } from 'react'
import { Zap } from 'lucide-react'
import { useArrangementStore } from '@/lib/stores/useArrangementStore'
import { useEditorStore } from '@/lib/stores/useEditorStore'
import { DEFAULT_CLIP_FX } from '@/types/arrangement'
import type { ClipFx, Clip, Track } from '@/types/arrangement'
import { Knob } from '@/components/ui/Knob'

// ── Preset definitions ────────────────────────────────────────
interface Preset {
  label: string
  colour: string
  gain_db?: number
  pitch_semitones?: number
  fx: Partial<ClipFx>
}

const PRESETS: Preset[] = [
  {
    label: 'Punchy Kick',
    colour: '#f59e0b',
    gain_db: 0,
    fx: {
      attack_ms:        2,
      decay_ms:         350,
      filter_cutoff_hz: 180,
      resonance:        0.25,
      drive:            0.65,
      transient_punch:  0.9,
      reverb:           0.04,
      delay:            0,
      stereo_width:     1,
    },
  },
  {
    label: 'Deep Sub',
    colour: '#22d3ee',
    fx: {
      attack_ms:        5,
      decay_ms:         900,
      filter_cutoff_hz: 80,
      resonance:        0.1,
      drive:            0.3,
      transient_punch:  0.45,
      reverb:           0.08,
      delay:            0,
      stereo_width:     0.7,
    },
  },
  {
    label: 'Tight Drum',
    colour: '#f97316',
    fx: {
      attack_ms:        1,
      decay_ms:         140,
      filter_cutoff_hz: 10000,
      resonance:        0.3,
      drive:            0.4,
      transient_punch:  0.85,
      reverb:           0.02,
      delay:            0,
      stereo_width:     0.85,
    },
  },
  {
    label: 'Wide FX',
    colour: '#a855f7',
    fx: {
      attack_ms:        30,
      decay_ms:         1400,
      filter_cutoff_hz: 5000,
      resonance:        0.55,
      drive:            0.2,
      transient_punch:  0.25,
      reverb:           0.72,
      delay:            0.45,
      stereo_width:     1.85,
    },
  },
  {
    label: 'Clean Vocal',
    colour: '#ec4899',
    fx: {
      attack_ms:        15,
      decay_ms:         700,
      filter_cutoff_hz: 14000,
      resonance:        0.08,
      drive:            0.08,
      transient_punch:  0.35,
      reverb:           0.28,
      delay:            0.14,
      stereo_width:     1.15,
    },
  },
]

// ── Helpers ───────────────────────────────────────────────────
function resolveFx(clip: Clip): ClipFx {
  return { ...DEFAULT_CLIP_FX, ...(clip.fx ?? {}) }
}

// ── Main component ────────────────────────────────────────────
interface Props {
  track: Track
  clip: Clip
}

export function SoundDesigner({ track, clip }: Props) {
  const patchClipFx  = useArrangementStore((s) => s.patchClipFx)
  const setClipGain  = useArrangementStore((s) => s.setClipGain)
  const setClipPitch = useArrangementStore((s) => s.setClipPitch)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basic: true,
    filter: false,
    dynamics: false,
    space: false,
    output: true,
  })

  const fx = resolveFx(clip)

  const patch = useCallback(
    (p: Partial<ClipFx>) => patchClipFx(track.id, clip.id, p),
    [track.id, clip.id, patchClipFx],
  )

  const applyPreset = (preset: Preset) => {
    patch({ ...DEFAULT_CLIP_FX, ...preset.fx })
    if (preset.gain_db !== undefined) setClipGain(track.id, clip.id, preset.gain_db)
    if (preset.pitch_semitones !== undefined) setClipPitch(track.id, clip.id, preset.pitch_semitones)
  }

  return (
    <div className="h-full flex flex-col gap-2 px-3 py-2 overflow-x-auto overflow-y-hidden">
      {/* ── Preset strip ─────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Zap className="h-3 w-3 text-white/30 flex-shrink-0" />
        <span className="text-[10px] uppercase tracking-wider text-white/30 font-mono mr-1">Presets</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors border border-black/60 bg-black/20 hover:bg-black/30 whitespace-nowrap"
            style={{ borderColor: `${p.colour}40`, color: p.colour + 'cc' }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Controls sections ───────────────────────────────── */}
      <div className="flex flex-col gap-2 min-w-max">
        <SectionToggle
          label="Basic"
          isOpen={openSections.basic}
          onToggle={() => setOpenSections((s) => ({ ...s, basic: !s.basic }))}
        />
        {openSections.basic && (
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            <Knob
              label="Gain"
              unit="dB"
              value={clip.gain_db}
              min={-24} max={12} step={0.5}
              neutral={0}
              colour="#a855f7"
              size="sm"
              onChange={(v) => setClipGain(track.id, clip.id, v)}
            />
            <Knob
              label="Pitch"
              unit="st"
              value={clip.pitch_semitones}
              min={-24} max={24} step={0.5}
              neutral={0}
              colour="#a855f7"
              size="sm"
              onChange={(v) => setClipPitch(track.id, clip.id, v)}
            />
            <Knob
              label="Attack"
              unit="ms"
              value={fx.attack_ms}
              min={0} max={500} step={1}
              neutral={2}
              colour="#f59e0b"
              size="sm"
              onChange={(v) => patch({ attack_ms: v })}
            />
            <Knob
              label="Decay"
              unit="ms"
              value={fx.decay_ms}
              min={0} max={2000} step={10}
              neutral={300}
              colour="#f59e0b"
              size="sm"
              onChange={(v) => patch({ decay_ms: v })}
            />
          </div>
        )}

        <SectionToggle
          label="Filter"
          isOpen={openSections.filter}
          onToggle={() => setOpenSections((s) => ({ ...s, filter: !s.filter }))}
        />
        {openSections.filter && (
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            <Knob
              label="Cutoff"
              unit="Hz"
              value={fx.filter_cutoff_hz}
              min={20} max={20000} step={10}
              neutral={20000}
              colour="#22d3ee"
              logScale
              size="sm"
              onChange={(v) => patch({ filter_cutoff_hz: v })}
            />
            <Knob
              label="Reso"
              unit=""
              value={fx.resonance}
              min={0} max={1} step={0.01}
              neutral={0}
              colour="#22d3ee"
              size="sm"
              onChange={(v) => patch({ resonance: v })}
            />
            <Knob
              label="Drive"
              unit=""
              value={fx.drive}
              min={0} max={1} step={0.01}
              neutral={0}
              colour="#ef4444"
              size="sm"
              onChange={(v) => patch({ drive: v })}
            />
          </div>
        )}

        <SectionToggle
          label="Dynamics"
          isOpen={openSections.dynamics}
          onToggle={() => setOpenSections((s) => ({ ...s, dynamics: !s.dynamics }))}
        />
        {openSections.dynamics && (
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            <Knob
              label="Punch"
              unit=""
              value={fx.transient_punch}
              min={0} max={1} step={0.01}
              neutral={0}
              colour="#f97316"
              size="sm"
              onChange={(v) => patch({ transient_punch: v })}
            />
          </div>
        )}

        <SectionToggle
          label="Space"
          isOpen={openSections.space}
          onToggle={() => setOpenSections((s) => ({ ...s, space: !s.space }))}
        />
        {openSections.space && (
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            <Knob
              label="Reverb"
              unit=""
              value={fx.reverb}
              min={0} max={1} step={0.01}
              neutral={0}
              colour="#6366f1"
              size="sm"
              onChange={(v) => patch({ reverb: v })}
            />
            <Knob
              label="Delay"
              unit=""
              value={fx.delay}
              min={0} max={1} step={0.01}
              neutral={0}
              colour="#6366f1"
              size="sm"
              onChange={(v) => patch({ delay: v })}
            />
          </div>
        )}

        <SectionToggle
          label="Output"
          isOpen={openSections.output}
          onToggle={() => setOpenSections((s) => ({ ...s, output: !s.output }))}
        />
        {openSections.output && (
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            <Knob
              label="Width"
              unit=""
              value={fx.stereo_width}
              min={0} max={2} step={0.01}
              neutral={1}
              colour="#10b981"
              size="sm"
              onChange={(v) => patch({ stereo_width: v })}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function SectionToggle({ label, isOpen, onToggle }: { label: string; isOpen: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-between rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        isOpen
          ? 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100'
          : 'border-white/10 text-white/40 hover:text-white/70 hover:bg-white/[0.03]'
      }`}
    >
      {label}
      <span className="text-[10px] text-white/35">{isOpen ? '−' : '+'}</span>
    </button>
  )
}

// Re-export for use from Inspector
export { PRESETS }
export type { Preset }
