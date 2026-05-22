'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { projects } from '@/lib/api'
import { useArrangementStore } from '@/lib/stores/useArrangementStore'
import { useEditorStore } from '@/lib/stores/useEditorStore'
import { ArrangementPlayer } from '@/lib/audio/engine'
import { Metronome } from '@/lib/audio/metronome'
import { useAssetUrls } from '@/lib/stores/useAssetUrls'
import { LibrarySidebar } from './LibrarySidebar'
import { Timeline } from './Timeline'
import { TransportBar } from './TransportBar'
import { Inspector } from './Inspector'
import { RenderProgressModal } from './RenderProgressModal'
import { AIToolsPanel } from './AIToolsPanel'
import { SoundDesignerWindow } from './SoundDesignerWindow'
import type { ProjectStem } from '@/types/arrangement'

interface Props {
  projectId: string
  stems:     ProjectStem[]
  loadingStems: boolean
}

export function Workstation({ projectId, stems, loadingStems }: Props) {
  const arrangement = useArrangementStore((s) => s.arrangement)
  const dirty       = useArrangementStore((s) => s.dirty)
  const laneRevision = useArrangementStore((s) => s.laneRevision)
  const markClean   = useArrangementStore((s) => s.markClean)
  const metronomeOn       = useEditorStore((s) => s.metronomeOn)
  const quantizePlayStart = useEditorStore((s) => s.quantizePlayStart)
  const loopOn             = useEditorStore((s) => s.loopOn)
  const loopStartSec       = useEditorStore((s) => s.loopStartSec)
  const loopEndSec         = useEditorStore((s) => s.loopEndSec)
  const selectedClipIds    = useEditorStore((s) => s.selectedClipIds)
  const removeClip         = useArrangementStore((s) => s.removeClip)

  const [isPlaying,   setPlaying]   = useState(false)
  const [isSaving,    setSaving]    = useState(false)
  const [isRendering, setRendering] = useState(false)
  const [renderJobId, setRenderJobId] = useState<string | null>(null)
  const [soundDesignerOpen, setSoundDesignerOpen] = useState(false)
  const [showBrowser, setShowBrowser] = useState(true)
  const [showAITools, setShowAITools] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)

  // Refs (not state) so the rAF playhead loop in <Timeline> + <TransportBar>
  // doesn't trigger React re-renders 60×/sec.
  const playheadRef  = useRef<number>(0)
  const isPlayingRef = useRef<boolean>(false)
  const playerRef    = useRef<ArrangementPlayer | null>(null)
  const metronomeRef = useRef<Metronome | null>(null)
  const rafRef       = useRef<number | null>(null)

  const assetUrls = useAssetUrls((s) => s.urls)

  const urlMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of stems) {
      if (s.signed_url) m.set(s.s3_key, s.signed_url)
    }
    for (const [k, v] of Array.from(assetUrls)) m.set(k, v)
    return m
  }, [stems, assetUrls])

  // Lazy-init player + metronome.
  useEffect(() => {
    const p = new ArrangementPlayer()
    p.onEnd(() => {
      setPlaying(false)
      isPlayingRef.current = false
      playheadRef.current = 0
      metronomeRef.current?.stop()
    })
    playerRef.current = p
    metronomeRef.current = new Metronome()
    return () => {
      p.dispose()
      metronomeRef.current?.dispose()
      playerRef.current = null
      metronomeRef.current = null
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const isWide = window.innerWidth >= 1280
    setShowBrowser(isWide)
    setShowAITools(isWide)
  }, [])

  // Drive the playhead REF (no React state) while playing.
  useEffect(() => {
    if (!isPlaying) return
    const tick = () => {
      const p = playerRef.current
      if (p) playheadRef.current = p.getElapsed()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isPlaying])

  // Keep both the player and metronome on the shared Transport BPM if it
  // changes mid-play. They both proxy to Tone.Transport.bpm under the hood.
  useEffect(() => {
    if (!arrangement) return
    playerRef.current?.setBpm(arrangement.bpm)
    metronomeRef.current?.setBpm(arrangement.bpm)
  }, [arrangement?.bpm, arrangement])

  // Toggling the metronome while playing starts/stops the click;
  // when not playing, just enables it for the next play.
  useEffect(() => {
    const m = metronomeRef.current
    if (!m || !arrangement) return
    if (isPlaying && metronomeOn) void m.start(arrangement.bpm)
    else m.stop()
  }, [metronomeOn, isPlaying, arrangement])

  const handlePlayToggle = useCallback(async () => {
    const p = playerRef.current
    if (!p || !arrangement) return
    if (isPlaying) {
      p.stop()
      metronomeRef.current?.stop()
      setPlaying(false)
      isPlayingRef.current = false
      return
    }
    try {
      setPlaying(true)
      isPlayingRef.current = true
      const loopValid = loopStartSec != null && loopEndSec != null && loopEndSec > loopStartSec
      playheadRef.current = loopValid && loopOn ? loopStartSec : 0
      await p.play(arrangement, urlMap, {
        quantize: quantizePlayStart,
        loop: loopValid && loopOn ? { startSec: loopStartSec, endSec: loopEndSec } : undefined,
      })
      if (metronomeOn) void metronomeRef.current?.start(arrangement.bpm)
    } catch (err) {
      setPlaying(false)
      isPlayingRef.current = false
      toast.error(err instanceof Error ? err.message : 'Playback failed')
    }
  }, [arrangement, isPlaying, urlMap, metronomeOn, quantizePlayStart, loopOn, loopStartSec, loopEndSec])

  const handleStop = useCallback(() => {
    playerRef.current?.stop()
    metronomeRef.current?.stop()
    setPlaying(false)
    isPlayingRef.current = false
    playheadRef.current = 0
  }, [])

  const handleSeek = useCallback((sec: number) => {
    const next = Math.max(0, sec)
    if (isPlayingRef.current) {
      playerRef.current?.seek(next)
    }
    playheadRef.current = next
  }, [])

  const handleSave = useCallback(async () => {
    if (!arrangement) return
    setSaving(true)
    try {
      await projects.saveArrangement(projectId, arrangement)
      markClean()
      toast.success('Arrangement saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [arrangement, projectId, markClean])

  const handleRender = useCallback(async () => {
    if (!arrangement) return
    if (dirty) {
      const ok = window.confirm('You have unsaved changes. Save and render now?')
      if (!ok) return
    }
    setRendering(true)
    try {
      if (dirty) {
        await projects.saveArrangement(projectId, arrangement)
        markClean()
      }
      const job = await projects.render(projectId, 'standard')
      setRenderJobId(job.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Render failed')
    } finally {
      setRendering(false)
    }
  }, [arrangement, dirty, projectId, markClean])

  useEffect(() => {
    if (!arrangement || !dirty || laneRevision <= 0) return
    const t = setTimeout(() => {
      projects.saveArrangement(projectId, arrangement)
        .then(() => markClean())
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : 'Auto-save failed')
        })
    }, 700)
    return () => clearTimeout(t)
  }, [arrangement, dirty, laneRevision, projectId, markClean])

  // Sync live mute/solo/volume from the store to the engine's gain nodes so
  // lane buttons react immediately during playback (no stop/start required).
  const arrangementTracks = arrangement?.tracks
  useEffect(() => {
    const player = playerRef.current
    if (!player || !arrangementTracks) return
    player.syncTrackMix(arrangementTracks)
  }, [arrangementTracks])

  // Live-sync clip FX (gain/filter/drive/pitch/envelope) while playing.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !arrangementTracks) return
    player.syncClipFx(arrangementTracks)
  }, [arrangementTracks])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    const loopValid = loopStartSec != null && loopEndSec != null && loopEndSec > loopStartSec
    if (loopOn && loopValid) player.setLoopRegion(loopStartSec, loopEndSec)
    else player.clearLoopRegion()
  }, [loopOn, loopStartSec, loopEndSec])

  // Stable callback that reads real RMS from the engine's analyser nodes.
  // Passed to <Timeline> so LaneLevelMeter can read it every rAF frame.
  const getTrackLevel = useCallback((trackId: string): number => {
    return playerRef.current?.getTrackLevel(trackId) ?? 0
  }, [])

  // Spacebar = play/pause toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        void handlePlayToggle()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!arrangement || selectedClipIds.size === 0) return
        e.preventDefault()
        arrangement.tracks.forEach((track) => {
          track.clips.forEach((clip) => {
            if (selectedClipIds.has(clip.id)) removeClip(track.id, clip.id)
          })
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlePlayToggle, arrangement, selectedClipIds, removeClip])

  if (!arrangement) return null

  return (
    <div className="daw-shell relative flex flex-col h-full overflow-hidden">
      <TransportBar
        bpm={arrangement.bpm}
        musicalKey={arrangement.musical_key ?? null}
        durationSec={arrangement.duration_sec}
        isPlaying={isPlaying}
        isSaving={isSaving}
        isRendering={isRendering}
        dirty={dirty}
        playheadRef={playheadRef}
        isPlayingRef={isPlayingRef}
        showBrowser={showBrowser}
        showAITools={showAITools}
        inspectorOpen={inspectorOpen}
        onPlayToggle={handlePlayToggle}
        onStop={handleStop}
        onSave={handleSave}
        onRender={handleRender}
        onToggleBrowser={() => setShowBrowser((v) => !v)}
        onToggleAITools={() => setShowAITools((v) => !v)}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden gap-3 px-3 py-2">
        {showBrowser && (
          <div className="h-full shrink-0">
            <LibrarySidebar stems={stems} loadingStems={loadingStems} />
          </div>
        )}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
          <div className="flex-1 min-h-0">
            <Timeline
              stems={stems}
              playheadRef={playheadRef}
              isPlayingRef={isPlayingRef}
              onSeek={handleSeek}
              getTrackLevel={getTrackLevel}
            />
          </div>
        </div>
        {(inspectorOpen || showAITools) && (
          <div className="h-full shrink-0 flex flex-col gap-2 w-[300px] xl:w-[340px]">
            {inspectorOpen && (
              <Inspector
                stems={stems}
                isOpen={inspectorOpen}
                onToggle={() => setInspectorOpen((v) => !v)}
                onOpenSoundDesigner={() => setSoundDesignerOpen(true)}
              />
            )}
            {showAITools && (
              <AIToolsPanel projectId={projectId} />
            )}
          </div>
        )}
      </div>
      <RenderProgressModal
        jobId={renderJobId}
        onClose={() => setRenderJobId(null)}
      />
      <SoundDesignerWindow
        open={soundDesignerOpen}
        onClose={() => setSoundDesignerOpen(false)}
        getTrackLevel={getTrackLevel}
      />
    </div>
  )
}
