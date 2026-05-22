'use client'

import { create } from 'zustand'

// Editor-only UI state. Distinct from the arrangement document (which is
// what gets saved) — these settings are local to the user's session.

export type GridResolution =
  | 'off'
  | 'bar'
  | 'half'      // 1/2 note
  | 'beat'      // 1/4 note
  | 'eighth'    // 1/8 note
  | 'sixteenth' // 1/16 note

export const GRID_OPTIONS: { value: GridResolution; label: string }[] = [
  { value: 'off',       label: 'Off'    },
  { value: 'bar',       label: '1 Bar'  },
  { value: 'half',      label: '1/2'    },
  { value: 'beat',      label: '1/4'    },
  { value: 'eighth',    label: '1/8'    },
  { value: 'sixteenth', label: '1/16'   },
]

export const MIN_PX_PER_SEC = 16
export const MAX_PX_PER_SEC = 240
export const DEFAULT_PX_PER_SEC = 48

export type QuantizeStart = 'off' | 'bar' | 'beat'

export const QUANTIZE_OPTIONS: { value: QuantizeStart; label: string }[] = [
  { value: 'off',  label: 'Instant' },
  { value: 'bar',  label: 'Next bar' },
  { value: 'beat', label: 'Next beat' },
]

interface EditorState {
  snap: boolean
  resolution: GridResolution
  pxPerSec: number
  /** True while the user is actively pinch/wheel zooming — suppresses
   *  expensive canvas redraws until zoom settles. */
  isZooming: boolean
  metronomeOn: boolean
  loopOn: boolean
  loopStartSec: number | null
  loopEndSec: number | null
  quantizePlayStart: QuantizeStart
  selectedClipIds: Set<string>

  setSnap:              (v: boolean) => void
  setResolution:        (r: GridResolution) => void
  setPxPerSec:          (px: number) => void
  setIsZooming:         (v: boolean) => void
  setMetronome:         (v: boolean) => void
  setLoop:              (v: boolean) => void
  setLoopRegion:        (startSec: number, endSec: number) => void
  clearLoopRegion:      () => void
  setQuantizePlayStart: (q: QuantizeStart) => void

  toggleSelectClip: (id: string, additive: boolean) => void
  selectClip:       (id: string) => void
  clearSelection:   () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  snap: true,
  resolution: 'beat',
  pxPerSec: DEFAULT_PX_PER_SEC,
  isZooming: false,
  metronomeOn: false,
  loopOn: false,
  loopStartSec: null,
  loopEndSec: null,
  quantizePlayStart: 'off',
  selectedClipIds: new Set<string>(),

  setSnap:       (v) => set({ snap: v }),
  setResolution: (r) => set((s) => ({
    resolution: r,
    snap: r === 'off' ? false : s.snap,
  })),
  setPxPerSec:   (px) => set({
    pxPerSec: clamp(px, MIN_PX_PER_SEC, MAX_PX_PER_SEC),
  }),
  setIsZooming:         (v) => set({ isZooming: v }),
  setMetronome:         (v) => set({ metronomeOn: v }),
  setLoop:              (v) => set({ loopOn: v }),
  setLoopRegion:        (startSec, endSec) => set(() => {
    const start = Math.max(0, startSec)
    const end   = Math.max(start + 0.01, endSec)
    return { loopStartSec: start, loopEndSec: end }
  }),
  clearLoopRegion:      () => set({ loopStartSec: null, loopEndSec: null }),
  setQuantizePlayStart: (q) => set({ quantizePlayStart: q }),

  toggleSelectClip: (id, additive) =>
    set((s) => {
      const next = additive ? new Set(s.selectedClipIds) : new Set<string>()
      if (additive && next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedClipIds: next }
    }),
  selectClip: (id) => set({ selectedClipIds: new Set([id]) }),
  clearSelection: () => set({ selectedClipIds: new Set<string>() }),
}))

/**
 * Convert a grid resolution into seconds at a given BPM.
 *   bar       = 4 beats     = 240/bpm
 *   half      = 2 beats     = 120/bpm
 *   beat      = quarter     =  60/bpm
 *   eighth    = 1/8         =  30/bpm
 *   sixteenth = 1/16        =  15/bpm
 *   off       = 0 (no snap)
 */
export function gridStepSec(resolution: GridResolution, bpm: number): number {
  if (bpm <= 0) return 0
  switch (resolution) {
    case 'off':       return 0
    case 'bar':       return 240 / bpm
    case 'half':      return 120 / bpm
    case 'beat':      return 60  / bpm
    case 'eighth':    return 30  / bpm
    case 'sixteenth': return 15  / bpm
  }
}

export function snapSec(sec: number, step: number): number {
  if (step <= 0) return sec
  return Math.round(sec / step) * step
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
