'use client'

import { create } from 'zustand'
import type { Arrangement, Clip, ClipFx, ClipSyncSuggestion, ProjectStem, Track } from '@/types/arrangement'

// One arrangement at a time. The store owns the in-memory edit state;
// persistence is the route's responsibility (see studio/[projectId]/page.tsx).
interface ArrangementState {
  arrangement: Arrangement | null
  dirty: boolean
  laneRevision: number

  load: (arr: Arrangement) => void
  reset: () => void

  addClipToTrack: (trackId: string, clip: Clip) => void
  removeClip: (trackId: string, clipId: string) => void
  moveClip: (trackId: string, clipId: string, startSec: number) => void
  resizeClip: (trackId: string, clipId: string, edge: 'start' | 'end', sec: number) => void
  setClipGain: (trackId: string, clipId: string, gainDb: number) => void
  setClipPitch: (trackId: string, clipId: string, semitones: number) => void
  patchClipFx: (trackId: string, clipId: string, patch: Partial<ClipFx>) => void
  setTrackVolume: (trackId: string, volumeDb: number) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
  updateMaster: (patch: Partial<Arrangement['master']>) => void
  setBpm: (bpm: number) => void
  /**
   * Snap clip start positions to the nearest multiple of `stepSec`.
   * Length and offset_sec are preserved. `scope` selects either every clip
   * in the arrangement or a specific set by id. Returns the number of clips
   * actually moved.
   */
  quantizeClips: (
    stepSec: number,
    scope: { type: 'all' } | { type: 'ids'; ids: Set<string> }
  ) => number
  /**
   * Apply real audio sync suggestions returned by the AI engine. Updates
   * start_sec (snap), offset_sec (trim pre-beat), time_stretch_ratio
   * (BPM match) and fade_in_sec (click-killer) for matched clip ids.
   * Returns the number of clips updated.
   */
  applySyncSuggestions: (suggestions: ClipSyncSuggestion[]) => number
  /**
   * Append a new empty track at the bottom of the lane stack. Returns the
   * id of the created track so the caller can focus / scroll to it.
   */
  addTrack: (name?: string) => string | null
  ensureStemTracks: (stems: ProjectStem[]) => number
  /**
   * Remove a track. Returns false if the track has clips (caller should
   * either confirm or refuse) — caller can pass `force` to delete anyway.
   */
  removeTrack: (trackId: string, opts?: { force?: boolean }) => boolean
  markClean: () => void
}

const replaceTrack = (tracks: Track[], id: string, patch: (t: Track) => Track): Track[] =>
  tracks.map(t => (t.id === id ? patch(t) : t))

const randomId = (prefix: string): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const titleCase = (v: string): string =>
  v
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ')

const normalizeTracks = (tracks: Track[]): Track[] => {
  const sorted = [...tracks].sort((a, b) => a.lane - b.lane)
  return sorted.map((t, i) => ({
    ...t,
    lane: i,
    volume_db: t.volume_db ?? 0,
    mute: t.mute ?? false,
    solo: t.solo ?? false,
    clips: t.clips ?? [],
  }))
}

const syncArrangementLanes = (arr: Arrangement): Arrangement => {
  const tracks = normalizeTracks(arr.tracks)
  return {
    ...arr,
    tracks,
    lanes: tracks,
  }
}

const isAIGeneratedSampleRef = (clip: Clip): boolean =>
  clip.asset_kind === 'user_sample' && clip.asset_ref.includes('/ai-generated/')

const normalizeIncomingArrangement = (arr: Arrangement): Arrangement => {
  const tracks = arr.tracks.length > 0 ? arr.tracks : (arr.lanes ?? [])
  const filteredTracks = tracks.map((t) => ({
    ...t,
    clips: t.clips.filter((c) => !isAIGeneratedSampleRef(c)),
  }))
  return syncArrangementLanes({ ...arr, tracks: filteredTracks })
}

const trackHasStem = (track: Track, stem: ProjectStem): boolean => {
  if (track.source?.s3_key === stem.s3_key) return true
  return track.clips.some((c) => c.asset_kind === 'stem' && c.asset_ref === stem.s3_key)
}

const stemLabel = (stem: ProjectStem): string => `${titleCase(stem.stem_name)} ${stem.side.toUpperCase()}`

export const useArrangementStore = create<ArrangementState>((set) => ({
  arrangement: null,
  dirty: false,
  laneRevision: 0,

  load: (arr) => set({ arrangement: normalizeIncomingArrangement(arr), dirty: false, laneRevision: 0 }),
  reset:   () => set({ arrangement: null, dirty: false, laneRevision: 0 }),
  markClean: () => set({ dirty: false }),

  addClipToTrack: (trackId, clip) =>
    set((s) => {
      if (!s.arrangement) return s
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({
        ...t,
        clips: [...t.clips, clip],
      }))
      const duration_sec = Math.max(s.arrangement.duration_sec, clip.end_sec)
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks, duration_sec }), dirty: true }
    }),

  removeClip: (trackId, clipId) =>
    set((s) => {
      if (!s.arrangement) return s
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId),
      }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  moveClip: (trackId, clipId, startSec) =>
    set((s) => {
      if (!s.arrangement) return s
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c
          const length = c.end_sec - c.start_sec
          const start  = Math.max(0, startSec)
          return { ...c, start_sec: start, end_sec: start + length }
        }),
      }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  // Resize a clip by dragging one of its edges. Trimming the start
  // advances offset_sec into the source so the audio stays anchored
  // to the same wall-clock waveform position.
  resizeClip: (trackId, clipId, edge, sec) =>
    set((s) => {
      if (!s.arrangement) return s
      const MIN_LEN = 0.001
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c
          if (edge === 'end') {
            const end = Math.max(c.start_sec + MIN_LEN, sec)
            return { ...c, end_sec: end }
          }
          const newStart = Math.max(0, Math.min(sec, c.end_sec - MIN_LEN))
          const delta    = newStart - c.start_sec
          const offset   = Math.max(0, c.offset_sec + delta)
          return { ...c, start_sec: newStart, offset_sec: offset }
        }),
      }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  toggleMute: (trackId) =>
    set((s) => {
      if (!s.arrangement) return s
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({ ...t, mute: !t.mute }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  setClipGain: (trackId, clipId, gainDb) =>
    set((s) => {
      if (!s.arrangement) return s
      const clamped = Math.max(-24, Math.min(12, gainDb))
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, gain_db: clamped } : c)),
      }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  setClipPitch: (trackId, clipId, semitones) =>
    set((s) => {
      if (!s.arrangement) return s
      const clamped = Math.max(-24, Math.min(24, semitones))
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, pitch_semitones: clamped } : c)),
      }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  patchClipFx: (trackId, clipId, patch) =>
    set((s) => {
      if (!s.arrangement) return s
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c
          return { ...c, fx: { ...(c.fx ?? {}), ...patch } as ClipFx }
        }),
      }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  setTrackVolume: (trackId, volumeDb) =>
    set((s) => {
      if (!s.arrangement) return s
      const clamped = Math.max(-24, Math.min(12, volumeDb))
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({ ...t, volume_db: clamped }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  toggleSolo: (trackId) =>
    set((s) => {
      if (!s.arrangement) return s
      const tracks = replaceTrack(s.arrangement.tracks, trackId, (t) => ({ ...t, solo: !t.solo }))
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    }),

  updateMaster: (patch) =>
    set((s) => {
      if (!s.arrangement) return s
      return {
        arrangement: syncArrangementLanes({ ...s.arrangement, master: { ...s.arrangement.master, ...patch } }),
        dirty: true,
      }
    }),

  setBpm: (bpm) =>
    set((s) => {
      if (!s.arrangement) return s
      const clamped = Math.max(20, Math.min(300, Math.round(bpm)))
      const old = s.arrangement.bpm
      if (clamped === old) return s
      // Rescale all clip times so they stay anchored to the same MUSICAL
      // position (bar/beat) when the tempo changes. Without this, a clip
      // whose start_sec sits on a beat at 120 BPM ends up between beats at
      // 130 BPM — the grid moves but the clip doesn't, and everything looks
      // out of sync. This is the "follow tempo" behaviour every DAW has.
      const ratio = old / clamped
      const tracks = s.arrangement.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({
          ...c,
          start_sec:  c.start_sec  * ratio,
          end_sec:    c.end_sec    * ratio,
          offset_sec: c.offset_sec * ratio,
        })),
      }))
      const duration_sec = s.arrangement.duration_sec * ratio
      return {
        arrangement: syncArrangementLanes({ ...s.arrangement, bpm: clamped, tracks, duration_sec }),
        dirty: true,
      }
    }),

  quantizeClips: (stepSec, scope) => {
    if (stepSec <= 0) return 0
    let moved = 0
    set((s) => {
      if (!s.arrangement) return s
      const inScope = (id: string) =>
        scope.type === 'all' ? true : scope.ids.has(id)
      const tracks = s.arrangement.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (!inScope(c.id)) return c
          const length   = c.end_sec - c.start_sec
          const newStart = Math.max(0, Math.round(c.start_sec / stepSec) * stepSec)
          if (Math.abs(newStart - c.start_sec) < 1e-6) return c
          moved += 1
          return { ...c, start_sec: newStart, end_sec: newStart + length }
        }),
      }))
      if (moved === 0) return s
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    })
    return moved
  },

  applySyncSuggestions: (suggestions) => {
    if (suggestions.length === 0) return 0
    const byId = new Map(suggestions.map((s) => [s.clip_id, s]))
    let updated = 0
    set((s) => {
      if (!s.arrangement) return s
      const tracks = s.arrangement.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          const sug = byId.get(c.id)
          if (!sug) return c
          const length     = c.end_sec - c.start_sec
          const newStart   = Math.max(0, sug.suggested_start_sec)
          const newOffset  = Math.max(0, sug.suggested_offset_sec)
          const ratio      = sug.time_stretch_ratio > 0 ? sug.time_stretch_ratio : 1
          const newFadeIn  = Math.max(c.fade_in_sec, sug.fade_in_sec)
          updated += 1
          return {
            ...c,
            start_sec:          newStart,
            end_sec:            newStart + length,
            offset_sec:         newOffset,
            time_stretch_ratio: ratio,
            fade_in_sec:        newFadeIn,
          }
        }),
      }))
      if (updated === 0) return s
      return { arrangement: syncArrangementLanes({ ...s.arrangement, tracks }), dirty: true }
    })
    return updated
  },

  addTrack: (name) => {
    const state = useArrangementStore.getState()
    if (!state.arrangement) return null
    const maxLane = state.arrangement.tracks.reduce((m, t) => Math.max(m, t.lane), -1)
    const id = randomId('track')
    const track: Track = {
      id,
      name:      name ?? `Track ${state.arrangement.tracks.length + 1}`,
      lane:      maxLane + 1,
      user_created: true,
      volume_db: 0,
      mute:      false,
      solo:      false,
      clips:     [],
    }
    set((s) => {
      if (!s.arrangement) return s
      return {
        arrangement: syncArrangementLanes({ ...s.arrangement, tracks: [...s.arrangement.tracks, track] }),
        dirty: true,
        laneRevision: s.laneRevision + 1,
      }
    })
    return id
  },

  ensureStemTracks: (stems) => {
    if (stems.length === 0) return 0
    let added = 0
    set((s) => {
      if (!s.arrangement) return s
      const next: Track[] = [...s.arrangement.tracks]
      let maxLane = next.reduce((m, t) => Math.max(m, t.lane), -1)
      for (const stem of stems) {
        if (next.some((t) => trackHasStem(t, stem))) continue
        added += 1
        maxLane += 1
        next.push({
          id: randomId('track'),
          name: stemLabel(stem),
          lane: maxLane,
          source: {
            side: stem.side,
            stem_name: stem.stem_name,
            s3_key: stem.s3_key,
          },
          user_created: false,
          volume_db: 0,
          mute: false,
          solo: false,
          clips: [],
        })
      }
      if (added === 0) return s
      return {
        arrangement: syncArrangementLanes({ ...s.arrangement, tracks: next }),
        dirty: true,
        laneRevision: s.laneRevision + 1,
      }
    })
    return added
  },

  removeTrack: (trackId, opts) => {
    let removed = false
    set((s) => {
      if (!s.arrangement) return s
      const target = s.arrangement.tracks.find((t) => t.id === trackId)
      if (!target) return s
      if (target.clips.length > 0 && !opts?.force) return s
      const tracks = s.arrangement.tracks.filter((t) => t.id !== trackId)
      removed = true
      return {
        arrangement: syncArrangementLanes({ ...s.arrangement, tracks }),
        dirty: true,
        laneRevision: s.laneRevision + 1,
      }
    })
    return removed
  },
}))
