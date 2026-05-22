'use client'

import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Sparkles, Zap, Magnet, Loader2 } from 'lucide-react'
import { useArrangementStore } from '@/lib/stores/useArrangementStore'
import { useEditorStore } from '@/lib/stores/useEditorStore'
import { projects } from '@/lib/api'

type Scope = 'selected' | 'all'

type SyncGrid = 'bar' | 'beat' | 'half'

const RESOLUTIONS: { value: SyncGrid; label: string; description: string }[] = [
  { value: 'bar',  label: '1 Bar',     description: '4 beats' },
  { value: 'beat', label: '1/4',       description: 'Quarter note' },
  { value: 'half', label: '1/8',       description: 'Eighth note' },
]

interface Props {
  projectId: string
}

export function AIToolsPanel({ projectId }: Props) {
  const arrangement     = useArrangementStore((s) => s.arrangement)
  const applySync       = useArrangementStore((s) => s.applySyncSuggestions)
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds)
  const editorResolution = useEditorStore((s) => s.resolution)

  const initialResolution: SyncGrid =
    editorResolution === 'bar' || editorResolution === 'half' ? editorResolution : 'beat'
  const [resolution, setResolution] = useState<SyncGrid>(initialResolution)
  const [scope, setScope]           = useState<Scope>('selected')
  const [busy, setBusy]             = useState(false)
  const [activeSection, setActiveSection] = useState<'sync' | null>('sync')

  const totalClips    = useMemo(
    () => arrangement?.tracks.reduce((n, t) => n + t.clips.length, 0) ?? 0,
    [arrangement],
  )
  const selectedCount = selectedClipIds.size
  const targetCount = scope === 'all' ? totalClips : selectedCount

  const handleSync = async () => {
    if (!arrangement || busy) return
    if (totalClips === 0) {
      toast.error('No clips to sync')
      return
    }
    let clipIds: string[] = []
    if (scope === 'selected') {
      if (selectedCount === 0) {
        toast.error('Select a clip first')
        return
      }
      clipIds = Array.from(selectedClipIds)
    } else {
      clipIds = arrangement.tracks.flatMap((t) => t.clips.map((c) => c.id))
    }

    const snapshot = useArrangementStore.getState().arrangement
    const loadingId = toast.loading('Analyzing beats…')
    setBusy(true)
    try {
      const { suggestions } = await projects.syncClipsToBeat(projectId, {
        grid: resolution, clip_ids: clipIds,
      })
      if (!suggestions.length) {
        toast.error('No sync suggestions returned', { id: loadingId })
        return
      }

      const updated = applySync(suggestions)
      const arr = useArrangementStore.getState().arrangement
      if (arr) {
        try {
          await projects.saveArrangement(projectId, arr)
          useArrangementStore.getState().markClean()
        } catch (saveErr) {
          // Roll back to snapshot on persistence failure
          if (snapshot) useArrangementStore.getState().load(snapshot)
          throw saveErr
        }
      }

      const lowConf = suggestions.filter((s) => s.confidence < 0.5).length
      const noun = updated === 1 ? 'clip' : 'clips'
      if (lowConf > 0) {
        toast(
          `Synced ${updated} ${noun} — low confidence on ${lowConf}`,
          { id: loadingId, icon: '⚠️' },
        )
      } else if (updated === 1) {
        toast.success('Clip synced to beat', { id: loadingId })
      } else {
        toast.success(`Synced ${updated} clips to beat`, { id: loadingId })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      toast.error(msg, { id: loadingId })
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="daw-panel flex flex-col h-full min-h-0 overflow-hidden">
      <div className="daw-panel-header px-4 py-3 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-200" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/80">AI Tools</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AccordionSection
          title="Sync to Beat"
          subtitle="Lock clip audio to the metronome"
          icon={<Magnet className="h-4 w-4 text-purple-300" />}
          isOpen={activeSection === 'sync'}
          onToggle={() => setActiveSection((s) => (s === 'sync' ? null : 'sync'))}
        >
          <div>
            <label className="text-[10px] uppercase tracking-wider text-white/40">Scope</label>
            <div className="mt-1 flex rounded-md border border-black/60 bg-white/[0.03] p-0.5">
              <ScopeButton
                active={scope === 'selected'}
                onClick={() => setScope('selected')}
                label="Selected"
                count={selectedCount}
              />
              <ScopeButton
                active={scope === 'all'}
                onClick={() => setScope('all')}
                label="All"
                count={totalClips}
              />
            </div>
            {scope === 'selected' && selectedCount === 0 && (
              <p className="mt-1.5 text-[10px] text-white/30">
                Select a clip on the timeline to enable sync.
              </p>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-white/40">Grid</label>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setResolution(r.value)}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-mono transition-colors ${
                    resolution === r.value
                      ? 'bg-amber-500/20 text-amber-100 border border-amber-300/40'
                      : 'border border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
                  }`}
                  title={r.description}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSync}
            disabled={!arrangement || totalClips === 0 || busy || (scope === 'selected' && selectedCount === 0)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-amber-500/80 hover:bg-amber-400 disabled:bg-white/5 disabled:text-white/30 text-white text-xs font-semibold transition-colors"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {busy ? 'Analyzing…' : `Sync ${targetCount} clip${targetCount === 1 ? '' : 's'}`}
          </button>
          {arrangement && (
            <p className="text-[10px] text-white/30 text-center">
              BPM {arrangement.bpm.toFixed(0)} · step {(60 / arrangement.bpm).toFixed(2)}s
            </p>
          )}
        </AccordionSection>

        {/* Temporarily disabled - will be reintroduced later */}
      </div>
    </aside>
  )
}

function AccordionSection({
  title,
  subtitle,
  icon,
  isOpen,
  onToggle,
  children,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border border-black/50 ${
      isOpen ? 'bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10' : 'bg-white/[0.02]'
    } p-3 space-y-3`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-black/40 border border-black/60 flex items-center justify-center">
            {icon}
          </div>
          <div className="text-left">
            <h4 className="text-sm font-semibold text-white">{title}</h4>
            <p className="text-[10px] text-white/40">{subtitle}</p>
          </div>
        </div>
        <span className="text-[10px] text-white/35">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="space-y-3">{children}</div>}
    </div>
  )
}

function ScopeButton({
  active, onClick, label, count,
}: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] transition-colors ${
        active
          ? 'bg-amber-500/15 text-amber-100 shadow-sm'
          : 'text-white/40 hover:text-white/70'
      }`}
    >
      {label}
      <span className={`text-[10px] font-mono ${active ? 'text-white/60' : 'text-white/30'}`}>
        {count}
      </span>
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-white/35">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

