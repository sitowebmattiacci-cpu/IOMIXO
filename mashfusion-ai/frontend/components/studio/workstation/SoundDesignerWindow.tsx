'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Minus, X, Wand2, Sparkles, Power, Copy, Save, SlidersHorizontal } from 'lucide-react'
import { useArrangementStore } from '@/lib/stores/useArrangementStore'
import { useEditorStore } from '@/lib/stores/useEditorStore'
import { DEFAULT_CLIP_FX } from '@/types/arrangement'
import type { Clip, ClipFx } from '@/types/arrangement'
import { Knob } from '@/components/ui/Knob'

interface LayoutState {
  x: number
  y: number
  w: number
  h: number
  minimized: boolean
}

interface Snapshot {
  gain: number
  fx: ClipFx
}

interface Preset {
  label: string
  colour: string
  gain_db?: number
  fx: Partial<ClipFx>
}

const STORAGE_KEY = 'iomixo:sound-designer-window:v5'
const PLUGIN_WIDTH = 640
const PLUGIN_HEIGHT = 420
const HEADER_HEIGHT = 40
const DEFAULT_LAYOUT: LayoutState = { x: 80, y: 60, w: PLUGIN_WIDTH, h: PLUGIN_HEIGHT, minimized: false }
const REACHABLE_X = 120
const REACHABLE_Y = 40

const PRESETS: Preset[] = [
  {
    label: 'Punchy Kick',
    colour: '#f59e0b',
    fx: { attack_ms: 2, decay_ms: 320, filter_cutoff_hz: 180, resonance: 0.25, drive: 0.62, transient_punch: 0.9, reverb: 0.04, delay: 0, stereo_width: 1 },
  },
  {
    label: 'Deep Sub Kick',
    colour: '#22d3ee',
    fx: { attack_ms: 5, decay_ms: 850, filter_cutoff_hz: 95, resonance: 0.12, drive: 0.28, transient_punch: 0.48, reverb: 0.06, delay: 0, stereo_width: 0.7 },
  },
  {
    label: 'Tight Drum',
    colour: '#f97316',
    fx: { attack_ms: 1, decay_ms: 140, filter_cutoff_hz: 11000, resonance: 0.28, drive: 0.38, transient_punch: 0.82, reverb: 0.02, delay: 0, stereo_width: 0.9 },
  },
  {
    label: 'Wide FX',
    colour: '#a855f7',
    fx: { attack_ms: 35, decay_ms: 1500, filter_cutoff_hz: 4800, resonance: 0.56, drive: 0.22, transient_punch: 0.22, reverb: 0.72, delay: 0.48, stereo_width: 1.9 },
  },
  {
    label: 'Clean Vocal',
    colour: '#ec4899',
    fx: { attack_ms: 15, decay_ms: 700, filter_cutoff_hz: 14000, resonance: 0.08, drive: 0.08, transient_punch: 0.35, reverb: 0.28, delay: 0.14, stereo_width: 1.15 },
  },
]

export function SoundDesignerWindow({
  open,
  onClose,
  getTrackLevel,
}: {
  open: boolean
  onClose: () => void
  getTrackLevel?: (trackId: string) => number
}) {
  const arrangement = useArrangementStore((s) => s.arrangement)
  const selectedIds = useEditorStore((s) => s.selectedClipIds)
  const setClipGain = useArrangementStore((s) => s.setClipGain)
  const patchClipFx = useArrangementStore((s) => s.patchClipFx)

  const [layout, setLayout] = useState<LayoutState>(DEFAULT_LAYOUT)
  const [slotA, setSlotA] = useState<Snapshot | null>(null)
  const [slotB, setSlotB] = useState<Snapshot | null>(null)
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A')
  const [activeTab, setActiveTab] = useState<'main' | 'tone' | 'dynamics' | 'space'>('main')

  const dragRef = useRef<{
    mode: 'move'
    sx: number
    sy: number
    initial: LayoutState
  } | null>(null)

  const selected = useMemo(() => {
    if (!arrangement || selectedIds.size === 0) return null
    for (const t of arrangement.tracks) {
      for (const c of t.clips) {
        if (selectedIds.has(c.id)) return { trackId: t.id, trackName: t.name, clip: c }
      }
    }
    return null
  }, [arrangement, selectedIds])

  const clip = selected?.clip
  const fx = useMemo(() => ({ ...DEFAULT_CLIP_FX, ...(clip?.fx ?? {}) }), [clip])
  const isActive = clip ? fx.enabled !== false : true

  const capture = useCallback((targetClip: Clip): Snapshot => ({
    gain: targetClip.gain_db,
    fx: { ...DEFAULT_CLIP_FX, ...(targetClip.fx ?? {}) },
  }), [])

  const applySnapshot = useCallback((snap: Snapshot) => {
    if (!selected) return
    setClipGain(selected.trackId, selected.clip.id, snap.gain)
    patchClipFx(selected.trackId, selected.clip.id, snap.fx)
  }, [patchClipFx, selected, setClipGain])

  useEffect(() => {
    if (!open) return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) as Partial<LayoutState> : {}
      setLayout((prev) => sanitizeLayout({
        x: Number.isFinite(parsed.x) ? parsed.x! : prev.x,
        y: Number.isFinite(parsed.y) ? parsed.y! : prev.y,
        w: PLUGIN_WIDTH,
        h: PLUGIN_HEIGHT,
        // Always reopen expanded so the user never "loses" the window.
        minimized: false,
      }))
    } catch {}
  }, [open])

  useEffect(() => {
    if (!open) return
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)) } catch {}
  }, [layout, open])

  useEffect(() => {
    if (!clip) return
    const now = capture(clip)
    setSlotA((s) => s ?? now)
    setSlotB((s) => s ?? now)
  }, [capture, clip])

  const onPointerMove = useCallback((ev: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = ev.clientX - d.sx
    const dy = ev.clientY - d.sy
    const pos = clampReachable(
      d.initial.x + dx,
      d.initial.y + dy,
      d.initial.w,
      d.initial.minimized ? HEADER_HEIGHT : d.initial.h,
    )
    setLayout((prev) => ({ ...prev, x: pos.x, y: pos.y }))
  }, [])

  const stopDrag = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopDrag)
    document.body.classList.remove('select-none')
    document.body.style.cursor = ''
  }, [onPointerMove])

  const startMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragRef.current = { mode: 'move', sx: e.clientX, sy: e.clientY, initial: layout }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
    document.body.classList.add('select-none')
    document.body.style.cursor = 'grabbing'
  }

  const patch = useCallback((p: Partial<ClipFx>) => {
    if (!selected) return
    patchClipFx(selected.trackId, selected.clip.id, p)
  }, [patchClipFx, selected])

  const applyPreset = (preset: Preset) => {
    if (!selected) return
    patch({ ...DEFAULT_CLIP_FX, ...preset.fx, enabled: isActive })
    if (preset.gain_db !== undefined) setClipGain(selected.trackId, selected.clip.id, preset.gain_db)
  }

  const toggleBypass = () => {
    if (!selected) return
    patchClipFx(selected.trackId, selected.clip.id, { enabled: !isActive })
  }

  const captureSlot = (slot: 'A' | 'B') => {
    if (!clip) return
    const snap = capture(clip)
    if (slot === 'A') setSlotA(snap)
    else setSlotB(snap)
  }

  const switchAB = (slot: 'A' | 'B') => {
    setActiveSlot(slot)
    const snap = slot === 'A' ? slotA : slotB
    if (snap) applySnapshot(snap)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      <div
        className="absolute pointer-events-auto rounded-lg border border-white/20 shadow-2xl overflow-hidden"
        style={{
          left: layout.x,
          top: layout.y,
          width: PLUGIN_WIDTH,
          height: layout.minimized ? HEADER_HEIGHT : PLUGIN_HEIGHT,
          background: 'linear-gradient(180deg, #3a3d44 0%, #24262c 45%, #1b1d22 100%)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.6)',
        }}
      >
        <div
          onPointerDown={startMove}
          className="h-[40px] px-3 border-b border-black/30 flex items-center gap-2.5 cursor-grab active:cursor-grabbing"
          style={{ background: 'linear-gradient(180deg, #4a4d55 0%, #33363d 100%)' }}
        >
          <div className="h-6 w-6 rounded-sm flex items-center justify-center bg-[#1c1f26] text-[#b9c2cc] border border-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            <Wand2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#c7ced6] leading-none">IOMIXO</div>
            <div className="text-[12px] font-semibold text-white/95 truncate leading-tight">Sound Designer</div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleBypass}
              className={`h-7 px-2 rounded-sm text-[10px] font-semibold border transition-colors ${isActive ? 'bg-emerald-500/25 border-emerald-300/40 text-emerald-100 shadow-[0_0_8px_rgba(16,185,129,0.35)]' : 'bg-[#2b2e35] border-black/50 text-white/65'}`}
              title="Bypass plugin chain"
              disabled={!selected}
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: isActive ? 'rgba(16,185,129,0.9)' : 'rgba(148,163,184,0.35)',
                    boxShadow: isActive ? '0 0 6px rgba(16,185,129,0.7)' : 'none'
                  }}
                />
                <Power className="h-3 w-3" />
                <span>{isActive ? 'Active' : 'Bypassed'}</span>
              </span>
            </button>
            <button
              onClick={() => setLayout((s) => ({ ...s, minimized: !s.minimized }))}
              className="h-7 w-7 rounded-sm border border-black/40 text-white/80 hover:text-white hover:bg-white/[0.08]"
              title={layout.minimized ? 'Expand' : 'Minimize'}
            >
              <Minus className="h-3.5 w-3.5 mx-auto" />
            </button>
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-sm border border-black/40 text-white/80 hover:text-white hover:bg-red-500/30"
              title="Close"
            >
              <X className="h-3.5 w-3.5 mx-auto" />
            </button>
          </div>
        </div>

        {!layout.minimized && (
          <div className="h-[calc(100%-40px)] p-2.5 flex flex-col gap-2" style={{ background: 'linear-gradient(180deg, #2f3238 0%, #26282e 100%)' }}>
            {!selected ? (
              <div className="h-full rounded-md border border-black/40 bg-[#1f2127] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <div className="text-center">
                  <Sparkles className="h-7 w-7 text-[#9aa3ad] mx-auto mb-2" />
                  <div className="text-[14px] font-semibold text-white/90">Select a clip to shape its sound</div>
                  <div className="text-[11px] text-white/55 mt-1">Pick any clip in timeline and this plugin will attach automatically.</div>
                </div>
              </div>
            ) : (
              <>
                {/* Preset + A/B bar */}
                <div className="rounded-md border border-black/40 bg-[#2a2d34] px-2.5 py-1.5 flex items-center gap-2 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                  <div className="text-[9px] uppercase tracking-widest text-white/60 shrink-0">Preset</div>
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => applyPreset(p)}
                        className="px-2 py-0.5 rounded-sm text-[9px] font-semibold border transition-colors"
                        style={{ borderColor: `${p.colour}66`, color: `${p.colour}ff`, background: `${p.colour}22` }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-1 shrink-0">
                    <button onClick={() => captureSlot('A')} className="h-5 px-1.5 rounded-sm border border-black/40 text-[9px] text-white/80 hover:bg-white/[0.08]" title="Capture A"><Save className="h-2.5 w-2.5 inline mr-0.5" />A</button>
                    <button onClick={() => captureSlot('B')} className="h-5 px-1.5 rounded-sm border border-black/40 text-[9px] text-white/80 hover:bg-white/[0.08]" title="Capture B"><Save className="h-2.5 w-2.5 inline mr-0.5" />B</button>
                    <button onClick={() => switchAB('A')} className={`h-5 px-1.5 rounded-sm border text-[9px] ${activeSlot === 'A' ? 'border-[#7dd3fc] text-[#a5f3fc] bg-[#1f3b4a]' : 'border-black/40 text-white/75 hover:bg-white/[0.08]'}`}>A</button>
                    <button onClick={() => switchAB('B')} className={`h-5 px-1.5 rounded-sm border text-[9px] ${activeSlot === 'B' ? 'border-[#7dd3fc] text-[#a5f3fc] bg-[#1f3b4a]' : 'border-black/40 text-white/75 hover:bg-white/[0.08]'}`}>B</button>
                  </div>
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 shrink-0">
                  {(['main', 'tone', 'dynamics', 'space'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1 rounded-sm text-[10px] font-semibold uppercase tracking-wider transition-colors border ${activeTab === tab ? 'bg-[#22262d] border-black/40 text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]' : 'border-black/30 text-white/60 hover:text-white/85 hover:bg-white/[0.08]'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className={`flex-1 min-h-0 overflow-hidden ${isActive ? '' : 'opacity-60'}`}>

                  {activeTab === 'main' && (
                    <div className="h-full flex gap-2">
                      <Module title="Quick Controls" subtitle={selected.trackName} accent="#f97316" className="flex-1">
                        <div className="flex items-end gap-2">
                          <div className="grid grid-cols-3 gap-3 flex-1 items-end">
                            <Knob label="Attack" value={fx.attack_ms} min={0} max={500} step={1} unit="ms" colour="#f59e0b" onChange={(v) => patch({ attack_ms: v })} size="sm" />
                            <Knob label="Decay" value={fx.decay_ms} min={0} max={2000} step={10} unit="ms" colour="#f59e0b" onChange={(v) => patch({ decay_ms: v })} size="sm" />
                            <Knob label="Punch" value={fx.transient_punch} min={0} max={1} step={0.01} unit="" colour="#f97316" onChange={(v) => patch({ transient_punch: v })} size="sm" />
                          </div>
                          <SectionClipLeds trackId={selected.trackId} getTrackLevel={getTrackLevel} />
                        </div>
                      </Module>
                      <Module title="Output" subtitle="Final Stage" accent="#10b981" className="w-44 shrink-0">
                        <div className="flex items-end gap-2">
                          <div className="grid grid-cols-2 gap-3 flex-1 items-end">
                            <Knob label="Gain" value={selected.clip.gain_db} min={-24} max={12} step={0.5} unit="dB" colour="#10b981" onChange={(v) => setClipGain(selected.trackId, selected.clip.id, v)} size="sm" />
                            <Knob label="Lim" value={fx.limiter_db} min={-24} max={0} step={0.5} unit="dB" colour="#22d3ee" onChange={(v) => patch({ limiter_db: v })} size="sm" />
                          </div>
                          <SectionClipLeds trackId={selected.trackId} getTrackLevel={getTrackLevel} />
                        </div>
                        <div className="rounded-sm border border-black/60 bg-[#1a1c21] p-1.5 mt-auto text-[10px] font-mono text-white/75 space-y-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                          <div>G {selected.clip.gain_db.toFixed(1)} dB</div>
                          <div>L {fx.limiter_db.toFixed(1)} dB</div>
                        </div>
                      </Module>
                    </div>
                  )}

                  {activeTab === 'tone' && (
                    <div className="h-full">
                      <div className="flex gap-3">
                        <div className="flex-1 flex flex-col gap-2">
                          <div className="w-full h-[190px]">
                            <ToneGraph
                              cutoff={fx.filter_cutoff_hz}
                              resonance={fx.resonance}
                              drive={fx.drive}
                              onCutoff={(v) => patch({ filter_cutoff_hz: v })}
                              onResonance={(v) => patch({ resonance: v })}
                              onDrive={(v) => patch({ drive: v })}
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-3 items-end">
                            <Knob label="Cutoff" value={fx.filter_cutoff_hz} min={20} max={20000} step={10} unit="Hz" colour="#22d3ee" logScale onChange={(v) => patch({ filter_cutoff_hz: v })} size="sm" />
                            <Knob label="Reso" value={fx.resonance} min={0} max={1} step={0.01} unit="" colour="#22d3ee" onChange={(v) => patch({ resonance: v })} size="sm" />
                            <Knob label="Drive" value={fx.drive} min={0} max={1} step={0.01} unit="" colour="#ef4444" onChange={(v) => patch({ drive: v })} size="sm" />
                          </div>
                        </div>
                        <SectionClipLeds trackId={selected.trackId} getTrackLevel={getTrackLevel} height={190} />
                      </div>
                    </div>
                  )}

                  {activeTab === 'dynamics' && (
                    <div className="h-full">
                      <div className="flex gap-3">
                        <div className="flex-1 flex flex-col gap-2">
                          <div className="w-full h-[190px]">
                            <DynamicsGraph
                              attackMs={fx.attack_ms}
                              decayMs={fx.decay_ms}
                              punch={fx.transient_punch}
                              onAttack={(v) => patch({ attack_ms: v })}
                              onDecay={(v) => patch({ decay_ms: v })}
                              onPunch={(v) => patch({ transient_punch: v })}
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-3 items-end">
                            <Knob label="Attack" value={fx.attack_ms} min={0} max={500} step={1} unit="ms" colour="#f59e0b" onChange={(v) => patch({ attack_ms: v })} size="sm" />
                            <Knob label="Decay" value={fx.decay_ms} min={0} max={2000} step={10} unit="ms" colour="#f59e0b" onChange={(v) => patch({ decay_ms: v })} size="sm" />
                            <Knob label="Punch" value={fx.transient_punch} min={0} max={1} step={0.01} unit="" colour="#f97316" onChange={(v) => patch({ transient_punch: v })} size="sm" />
                          </div>
                        </div>
                        <SectionClipLeds trackId={selected.trackId} getTrackLevel={getTrackLevel} height={190} />
                      </div>
                    </div>
                  )}

                  {activeTab === 'space' && (
                    <Module title="Space" subtitle="Depth + Motion" accent="#6366f1" className="h-full">
                      <div className="flex items-end gap-2">
                        <div className="grid grid-cols-3 gap-3 flex-1 items-end">
                          <Knob label="Reverb" value={fx.reverb} min={0} max={1} step={0.01} unit="" colour="#6366f1" onChange={(v) => patch({ reverb: v })} size="sm" />
                          <Knob label="Delay" value={fx.delay} min={0} max={1} step={0.01} unit="" colour="#6366f1" onChange={(v) => patch({ delay: v })} size="sm" />
                          <Knob label="Width" value={fx.stereo_width} min={0} max={2} step={0.01} unit="" colour="#10b981" onChange={(v) => patch({ stereo_width: v })} size="sm" />
                        </div>
                        <SectionClipLeds trackId={selected.trackId} getTrackLevel={getTrackLevel} />
                      </div>
                    </Module>
                  )}

                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

function Module({
  title, subtitle, accent, className = '', children,
}: {
  title: string
  subtitle: string
  accent: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-md border p-3 flex flex-col gap-2 min-h-0 overflow-hidden ${className}`}
      style={{
        borderColor: 'rgba(0,0,0,0.55)',
        background: 'linear-gradient(180deg, rgba(70,73,82,0.35), rgba(34,36,42,0.6))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.6)'
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: accent }}>{title}</div>
          <div className="text-[10px] text-white/60">{subtitle}</div>
        </div>
        <div className="h-1.5 w-12 rounded-full" style={{ background: `linear-gradient(90deg, ${accent}dd, transparent)` }} />
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function ToneGraph({
  cutoff,
  resonance,
  drive,
  onCutoff,
  onResonance,
  onDrive,
}: {
  cutoff: number
  resonance: number
  drive: number
  onCutoff: (v: number) => void
  onResonance: (v: number) => void
  onDrive: (v: number) => void
}) {
  const W = 250
  const H = 138
  const NUM_PTS = 120
  const graphRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ mode: 'node' | 'q' } | null>(null)
  const [hoveredHandle, setHoveredHandle] = useState<'node' | 'q' | null>(null)
  const rafRef = useRef<number | null>(null)
  const pending = useRef<{ cutoff?: number; resonance?: number; drive?: number }>({})

  // Map frequency (log) → SVG x
  const xForFreq = (f: number) => W * Math.log10(f / 20) / Math.log10(1000)
  // Map SVG x → frequency
  const freqForX = (x: number) => 20 * Math.pow(1000, x / W)

  // 0 dB → y = H * 0.30; each 6dB = 12px
  const dBtoY = (db: number) => H * 0.30 - db * 2.0

  // Compute 2nd-order lowpass magnitude response: |H(f)| = 1/sqrt((1-(f/fc)^2)^2 + (f/(fc*Q))^2)
  const Q = 0.5 + resonance * 14.5 // 0.5..15
  const gainDb = (drive - 0.5) * 12
  const pts = Array.from({ length: NUM_PTS }, (_, i) => {
    const f = freqForX(i / (NUM_PTS - 1) * W)
    const ratio = f / cutoff
    const r2 = ratio * ratio
    const mag = 1 / Math.sqrt((1 - r2) * (1 - r2) + r2 / (Q * Q))
    const db = clamp(20 * Math.log10(Math.max(mag, 0.00001)) + gainDb, -48, 18)
    return { x: i / (NUM_PTS - 1) * W, y: dBtoY(db) }
  })

  const linePath = 'M ' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')
  const fillPath = `${linePath} L ${W},${H} L 0,${H} Z`

  // Cutoff handle: position at the -3dB point x, and at 0dB y as reference
  const cutoffX = xForFreq(cutoff)
  const cutoffHandleY = dBtoY(20 * Math.log10(1 / Math.sqrt(1 + 1 / (Q * Q))) + gainDb)
  const qHandleX = clamp(cutoffX + 14, 12, W - 12)
  const qHandleY = clamp(cutoffHandleY - (resonance * 18 + 6), 8, H - 8)

  const commit = () => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      const { cutoff: c, resonance: r, drive: d } = pending.current
      if (c != null) onCutoff(c)
      if (r != null) onResonance(r)
      if (d != null) onDrive(d)
      pending.current = {}
      rafRef.current = null
    })
  }

  const onPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const rect = graphRef.current?.getBoundingClientRect()
    if (!rect) return
    const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1)
    if (drag.mode === 'node') {
      pending.current.cutoff = freqForX(nx * W)
      pending.current.drive = clamp(1 - ny, 0, 1)
    } else {
      pending.current.resonance = clamp(1 - ny, 0, 1)
    }
    commit()
  }

  const stopDrag = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopDrag)
  }

  const startDrag = (mode: 'node' | 'q') => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    dragRef.current = { mode }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
  }

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

  // Frequency grid labels
  const gridFreqs = [{ f: 100, label: '100' }, { f: 500, label: '500' }, { f: 1000, label: '1k' }, { f: 5000, label: '5k' }, { f: 10000, label: '10k' }]
  const dbLines = [12, 6, 0, -12, -24, -36]

  return (
    <div className="w-full h-full rounded-sm border border-black/60 bg-[#1a1c21] relative overflow-hidden">
      <svg ref={graphRef} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}>
        <defs>
          <linearGradient id="toneGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`rgba(34,211,238,${0.25 + drive * 0.15})`} />
            <stop offset="100%" stopColor="rgba(34,211,238,0)" />
          </linearGradient>
          <linearGradient id="toneSweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(34,211,238,0)" />
            <stop offset="50%" stopColor="rgba(34,211,238,0.18)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0)" />
          </linearGradient>
          <filter id="toneGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="toneClip"><rect x={0} y={0} width={W} height={H} /></clipPath>
        </defs>
        <rect
          className="analyzer-sweep"
          x={-W * 0.6}
          y={0}
          width={W * 1.2}
          height={H}
          fill="url(#toneSweep)"
          opacity={0.35}
        />
        {/* dB grid lines */}
        {dbLines.map((db) => (
          <g key={`db${db}`}>
            <line x1={0} y1={dBtoY(db)} x2={W} y2={dBtoY(db)} stroke={db === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)'} strokeDasharray={db === 0 ? 'none' : '3,4'} />
            <text x={3} y={dBtoY(db) - 2} fontSize="7" fill="rgba(255,255,255,0.38)" fontFamily="monospace">{db > 0 ? `+${db}` : db}</text>
          </g>
        ))}
        {/* Frequency grid */}
        {gridFreqs.map(({ f, label }) => (
          <g key={`f${f}`}>
            <line x1={xForFreq(f)} y1={0} x2={xForFreq(f)} y2={H} stroke="rgba(255,255,255,0.12)" />
            <text x={xForFreq(f) + 2} y={H - 3} fontSize="7" fill="rgba(255,255,255,0.38)" fontFamily="monospace">{label}</text>
          </g>
        ))}
        <text x={3} y={H - 3} fontSize="7" fill="rgba(255,255,255,0.38)" fontFamily="monospace">20</text>
        {/* EQ fill */}
        <path d={fillPath} fill="url(#toneGrad)" clipPath="url(#toneClip)" />
        {/* EQ curve */}
        <path d={linePath} fill="none" stroke="rgba(34,211,238,0.4)" strokeWidth={3} filter="url(#toneGlow)" clipPath="url(#toneClip)" />
        <path d={linePath} fill="none" stroke={`rgba(34,211,238,${0.9 + drive * 0.1})`} strokeWidth={2} clipPath="url(#toneClip)" />
        {/* 0dB reference dotted */}
        <line x1={0} y1={dBtoY(0)} x2={W} y2={dBtoY(0)} stroke="rgba(34,211,238,0.4)" strokeDasharray="2,4" />
        {/* Cutoff handle */}
        <line x1={cutoffX} y1={0} x2={cutoffX} y2={H} stroke="rgba(34,211,238,0.30)" strokeDasharray="2,3" />
        <circle
          cx={cutoffX}
          cy={clamp(cutoffHandleY, 8, H - 8)}
          r={hoveredHandle === 'node' ? 6.4 : 5.6}
          fill="rgba(34,211,238,0.92)"
          stroke="rgba(255,255,255,0.58)"
          strokeWidth={hoveredHandle === 'node' ? 1.5 : 1.1}
          style={{ cursor: 'grab' }}
          onPointerDown={startDrag('node')}
          onPointerEnter={() => setHoveredHandle('node')}
          onPointerLeave={() => setHoveredHandle((h) => (h === 'node' ? null : h))}
        />
        {/* Q handle */}
        <circle
          cx={qHandleX}
          cy={qHandleY}
          r={hoveredHandle === 'q' ? 5 : 4.2}
          fill="rgba(255,255,255,0.75)"
          stroke="rgba(34,211,238,0.8)"
          strokeWidth={hoveredHandle === 'q' ? 1.4 : 1.1}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={startDrag('q')}
          onPointerEnter={() => setHoveredHandle('q')}
          onPointerLeave={() => setHoveredHandle((h) => (h === 'q' ? null : h))}
        />
      </svg>
    </div>
  )
}

function DynamicsGraph({
  attackMs,
  decayMs,
  punch,
  onAttack,
  onDecay,
  onPunch,
}: {
  attackMs: number
  decayMs: number
  punch: number
  onAttack: (v: number) => void
  onDecay: (v: number) => void
  onPunch: (v: number) => void
}) {
  const graphRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ mode: 'attack' | 'decay' | 'punch' } | null>(null)
  const [hoveredHandle, setHoveredHandle] = useState<'attack' | 'decay' | 'punch' | null>(null)
  const rafRef = useRef<number | null>(null)
  const pending = useRef<{ attack?: number; decay?: number; punch?: number }>({})

  const aNorm = clamp(attackMs / 500, 0, 1)
  const p = clamp(punch, 0, 1)
  const dNorm = clamp(decayMs / 2000, 0, 1)
  const entryX = 16 + aNorm * 74
  const entryY = 122 - aNorm * 52
  const peakX = clamp(entryX + 32 + p * 34, entryX + 24, 170)
  const peakY = 42 + (1 - p) * 34
  const releaseX = 142 + dNorm * 102
  const releaseY = 74 + dNorm * 50
  const curve = `M 10 136 C 14 134, ${entryX - 6} ${entryY + 8}, ${entryX} ${entryY}
                 C ${entryX + 18} ${entryY - 28}, ${peakX - 10} ${peakY + 4}, ${peakX} ${peakY}
                 C ${peakX + 28} ${peakY + 24}, ${releaseX - 20} ${releaseY - 10}, ${releaseX} ${releaseY}
                 C ${releaseX + 10} ${releaseY + 8}, 248 124, 250 136`

  const commit = () => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      const { attack, decay, punch } = pending.current
      if (attack != null) onAttack(attack)
      if (decay != null) onDecay(decay)
      if (punch != null) onPunch(punch)
      pending.current = {}
      rafRef.current = null
    })
  }

  const pointerToVals = (e: PointerEvent) => {
    const rect = graphRef.current?.getBoundingClientRect()
    if (!rect) return null
    const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1)
    return { nx, ny }
  }

  const onPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const pos = pointerToVals(e)
    if (!pos) return
    if (drag.mode === 'attack') {
      pending.current.attack = clamp((pos.nx / 0.45) * 500, 0, 500)
    } else if (drag.mode === 'decay') {
      pending.current.decay = clamp(pos.nx * 2000, 0, 2000)
    } else {
      pending.current.punch = clamp(1 - pos.ny, 0, 1)
    }
    commit()
  }

  const stopDrag = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopDrag)
  }

  const startDrag = (mode: 'attack' | 'decay' | 'punch') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { mode }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
  }

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div className="w-full h-full rounded-sm border border-black/60 bg-[#1a1c21] relative overflow-hidden">
      <svg ref={graphRef} viewBox="0 0 260 150" className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}>
        <defs>
          <filter id="dynGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="dynSweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(249,115,22,0)" />
            <stop offset="50%" stopColor="rgba(249,115,22,0.18)" />
            <stop offset="100%" stopColor="rgba(249,115,22,0)" />
          </linearGradient>
        </defs>
        <rect
          className="analyzer-sweep"
          x={-160}
          y={0}
          width={420}
          height={150}
          fill="url(#dynSweep)"
          opacity={0.3}
        />
        {[0, 52, 104, 156, 208, 260].map((xx) => <line key={`dv${xx}`} x1={xx} y1={0} x2={xx} y2={150} stroke="rgba(255,255,255,0.12)" />)}
        {[0, 30, 60, 90, 120, 150].map((yy) => <line key={`dh${yy}`} x1={0} y1={yy} x2={260} y2={yy} stroke="rgba(255,255,255,0.1)" />)}
        <text x={8} y={144} fontSize="8" fill="rgba(255,255,255,0.25)">entry</text>
        <text x={104} y={144} fontSize="8" fill="rgba(255,255,255,0.25)">punch</text>
        <text x={210} y={144} fontSize="8" fill="rgba(255,255,255,0.25)">release</text>
        <path d={curve} fill="none" stroke="rgba(249,115,22,0.4)" strokeWidth={3} filter="url(#dynGlow)" />
        <path d={curve} fill="none" stroke="rgba(249,115,22,0.95)" strokeWidth={2} />
        <rect x={236} y={26 + (1 - p) * 64} width={10} height={102 - (1 - p) * 64} rx={3} fill="rgba(249,115,22,0.45)" />
        <circle
          cx={entryX}
          cy={entryY}
          r={hoveredHandle === 'attack' ? 6 : 5}
          fill="rgba(245,158,11,0.95)"
          stroke="rgba(255,255,255,0.62)"
          strokeWidth={hoveredHandle === 'attack' ? 1.4 : 1.1}
          style={{ cursor: 'ew-resize' }}
          onPointerDown={startDrag('attack')}
          onPointerEnter={() => setHoveredHandle('attack')}
          onPointerLeave={() => setHoveredHandle((h) => (h === 'attack' ? null : h))}
        />
        <circle
          cx={peakX}
          cy={peakY}
          r={hoveredHandle === 'punch' ? 6 : 5}
          fill="rgba(249,115,22,0.8)"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth={hoveredHandle === 'punch' ? 1.4 : 1.1}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={startDrag('punch')}
          onPointerEnter={() => setHoveredHandle('punch')}
          onPointerLeave={() => setHoveredHandle((h) => (h === 'punch' ? null : h))}
        />
        <circle
          cx={releaseX}
          cy={releaseY}
          r={hoveredHandle === 'decay' ? 6 : 5}
          fill="rgba(251,146,60,0.92)"
          stroke="rgba(255,255,255,0.58)"
          strokeWidth={hoveredHandle === 'decay' ? 1.4 : 1.1}
          style={{ cursor: 'ew-resize' }}
          onPointerDown={startDrag('decay')}
          onPointerEnter={() => setHoveredHandle('decay')}
          onPointerLeave={() => setHoveredHandle((h) => (h === 'decay' ? null : h))}
        />
      </svg>
    </div>
  )
}

function Fader({
  label, value, min, max, step, neutral, unit, colour, onChange, logScale = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  neutral: number
  unit: string
  colour: string
  onChange: (v: number) => void
  logScale?: boolean
}) {
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
  const isNeutral = Math.abs(value - neutral) < Math.max(step * 0.5, 0.0005)
  const displayValue = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : (step >= 1 ? Math.round(value).toString() : value.toFixed(2))

  const slotHeight = '100px'
  const sliderHeight = '78px'
  return (
    <div className="w-[50px] flex flex-col items-center gap-1">
      <div className="h-3.5 text-[9px] leading-[14px] uppercase tracking-wider font-mono truncate w-full text-center" style={{ color: isNeutral ? 'rgba(255,255,255,0.45)' : colour }}>{label}</div>
      <div className="w-[28px] rounded-sm border border-black/50 bg-[#1b1e24] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" style={{ height: slotHeight }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={toSlider(value)}
          onChange={(e) => onChange(Number(fromSlider(parseFloat(e.target.value)).toFixed(4)))}
          className="fx-knob-slider"
          style={{ '--knob-colour': colour, height: sliderHeight } as CSSProperties}
        />
      </div>
      <div className="h-3.5 text-[9px] leading-[14px] font-mono tabular-nums text-white/70 text-center">{displayValue}{unit && <span className="text-white/40 ml-0.5">{unit}</span>}</div>
    </div>
  )
}


function SectionClipLeds({
  trackId,
  getTrackLevel,
  height,
}: {
  trackId: string
  getTrackLevel?: (trackId: string) => number
  height?: number
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
      const base = clamp(raw, 0, 1)
      const leftTarget = base
      const rightTarget = clamp(base * 0.97 + 0.015, 0, 1)

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
      } else if (now - leftPeakTimeRef.current > 1200) {
        leftPeakValRef.current = Math.max(0, leftPeakValRef.current * 0.993)
      }
      if (nextRight > rightPeakValRef.current) {
        rightPeakValRef.current = nextRight
        rightPeakTimeRef.current = now
      } else if (now - rightPeakTimeRef.current > 1200) {
        rightPeakValRef.current = Math.max(0, rightPeakValRef.current * 0.993)
      }

      const leftMask = leftMaskRef.current
      if (leftMask) leftMask.style.height = `${Math.max(0, (1 - leftLevelRef.current)) * 100}%`
      const rightMask = rightMaskRef.current
      if (rightMask) rightMask.style.height = `${Math.max(0, (1 - rightLevelRef.current)) * 100}%`

      const leftPeak = leftPeakRef.current
      if (leftPeak) {
        leftPeak.style.bottom = `${leftPeakValRef.current * 100}%`
        leftPeak.style.opacity = leftPeakValRef.current > 0.02 ? '1' : '0'
      }
      const rightPeak = rightPeakRef.current
      if (rightPeak) {
        rightPeak.style.bottom = `${rightPeakValRef.current * 100}%`
        rightPeak.style.opacity = rightPeakValRef.current > 0.02 ? '1' : '0'
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [trackId, getTrackLevel])

  const ledHeight = `${height ?? 78}px`
  return (
    <div className="flex items-end gap-1 rounded-sm border border-black/60 bg-[#23262c] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
      <div className="flex flex-col items-center gap-0.5 text-[7px] text-white/40">
        <span>L</span>
        <div
          className="relative w-2 rounded-sm border border-orange-300/25 overflow-hidden"
          style={{ height: ledHeight, background: 'linear-gradient(to top, #f59e0b 0%, #f59e0b 55%, #f97316 55%, #f97316 78%, #ef4444 78%, #ef4444 100%)' }}
        >
          <div ref={leftMaskRef} className="absolute top-0 left-0 right-0" style={{ height: '100%', background: 'rgba(10,10,16,0.9)' }} />
          <div ref={leftPeakRef} className="absolute left-0 right-0" style={{ height: 1, bottom: '0%', opacity: 0, background: 'rgba(255,255,255,0.85)' }} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5 text-[7px] text-white/40">
        <span>R</span>
        <div
          className="relative w-2 rounded-sm border border-orange-300/25 overflow-hidden"
          style={{ height: ledHeight, background: 'linear-gradient(to top, #f59e0b 0%, #f59e0b 55%, #f97316 55%, #f97316 78%, #ef4444 78%, #ef4444 100%)' }}
        >
          <div ref={rightMaskRef} className="absolute top-0 left-0 right-0" style={{ height: '100%', background: 'rgba(10,10,16,0.9)' }} />
          <div ref={rightPeakRef} className="absolute left-0 right-0" style={{ height: 1, bottom: '0%', opacity: 0, background: 'rgba(255,255,255,0.85)' }} />
        </div>
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function sanitizeLayout(layout: LayoutState): LayoutState {
  if (typeof window === 'undefined') return layout
  const w = PLUGIN_WIDTH
  const h = PLUGIN_HEIGHT
  const pos = clampReachable(layout.x, layout.y, w, h)
  const x = pos.x
  const y = pos.y
  return { ...layout, x, y, w, h }
}

function clampReachable(x: number, y: number, w: number, h: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y }
  const minX = -w + REACHABLE_X
  const maxX = window.innerWidth - REACHABLE_X
  const minY = -h + REACHABLE_Y
  const maxY = window.innerHeight - REACHABLE_Y
  return {
    x: clamp(x, minX, maxX),
    y: clamp(y, minY, maxY),
  }
}
