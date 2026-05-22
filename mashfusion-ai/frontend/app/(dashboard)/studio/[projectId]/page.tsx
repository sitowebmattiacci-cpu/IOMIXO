'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, AlertTriangle, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'

import { projects } from '@/lib/api'
import { Workstation } from '@/components/studio/workstation/Workstation'
import { useArrangementStore } from '@/lib/stores/useArrangementStore'
import { Button } from '@/components/ui/Button'
import type { Project } from '@/types'

const SEED_POLL_MS    = 4_000
const SEED_TIMEOUT_MS = 5 * 60_000   // give up after 5 minutes

export default function WorkstationPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params
  const load  = useArrangementStore((s) => s.load)
  const reset = useArrangementStore((s) => s.reset)
  const arrangement = useArrangementStore((s) => s.arrangement)

  const { data: project } = useSWR<Project>(
    `project-${projectId}`,
    () => projects.get(projectId),
  )

  // NOTE: do NOT raise dedupingInterval here. SWR dedupes ALL requests
  // (including polled ones) within the interval, so a long value silently
  // suppresses the polling that's supposed to catch up once Demucs finishes.
  const { data: stems = [], isLoading: loadingStems, mutate: refetchStems } = useSWR(
    `stems-${projectId}`,
    () => projects.getStems(projectId),
    {
      refreshInterval: (data) => (data && data.length > 0 ? 0 : SEED_POLL_MS),
      revalidateOnFocus: false,
    },
  )

  // Once we have the arrangement we stop polling — refreshInterval becomes 0.
  // This keeps the network quiet for the rest of the editing session.
  const { data: storedArrangement, error: arrErr, mutate: refetchArr } = useSWR(
    `arrangement-${projectId}`,
    () => projects.getArrangement(projectId),
    {
      refreshInterval: arrangement ? 0 : SEED_POLL_MS,
      revalidateOnFocus: false,
    },
  )

  // Poll the latest seed job so we can surface a real failure (with the
  // engine's error_message) instead of waiting for the 5-minute timeout.
  const { data: seedJob } = useSWR(
    `seed-job-${projectId}`,
    () => projects.getSeedJob(projectId),
    {
      refreshInterval: arrangement ? 0 : SEED_POLL_MS,
      revalidateOnFocus: false,
    },
  )

  // Hydrate the store the first time we receive a saved arrangement.
  useEffect(() => {
    if (storedArrangement?.doc && !arrangement) {
      load(storedArrangement.doc)
      // Arrangement just landed — make sure stems are fresh so the player
      // has signed URLs for every clip without waiting for the next poll.
      refetchStems()
    }
  }, [storedArrangement, arrangement, load, refetchStems])

  // Reset store when navigating away.
  useEffect(() => () => reset(), [reset])

  // Track how long we've been waiting so we can stop polling and surface
  // a clear error if the seed never lands (e.g. AI engine crashed).
  const [waitedMs, setWaitedMs] = useState(0)
  useEffect(() => {
    if (arrangement) return
    const t = setInterval(() => setWaitedMs((ms) => ms + 1000), 1000)
    return () => clearInterval(t)
  }, [arrangement])

  const timedOut = !arrangement && waitedMs >= SEED_TIMEOUT_MS
  const jobFailed = seedJob?.status === 'failed'
  const hasError  = !!arrErr || timedOut || jobFailed
  const seeding   = !arrangement && !hasError

  const errorMessage = jobFailed
    ? (seedJob?.error_message ?? 'The AI seed job failed.')
    : timedOut
      ? 'Seeding is taking longer than expected. The AI worker may have failed.'
      : (arrErr instanceof Error ? arrErr.message : 'Failed to load arrangement.')

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-6 py-3 border-b border-white/8 bg-[#0a0a0f]">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
          <span className="text-white/15">/</span>
          <h1 className="text-sm font-semibold text-white truncate">
            {project?.title ?? 'Workstation'}
          </h1>
          {project?.mode && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${
                project.mode === 'remix'
                  ? 'border-purple-500/30 bg-purple-500/10 text-purple-200'
                  : 'border-pink-500/30 bg-pink-500/10 text-pink-200'
              }`}
            >
              {project.mode}
            </span>
          )}
        </div>
        <div className="text-[10px] text-white/25 font-mono">IOMIXO STUDIO · # {projectId.slice(0, 8)}</div>
      </header>

      {seeding && (
        <SeedingScreen
          waitedMs={waitedMs}
          stage={seedJob?.current_stage ?? null}
          progress={seedJob?.progress ?? null}
          onRetry={() => {
            setWaitedMs(0)
            refetchArr()
            toast('Refreshing…', { icon: '↻' })
          }}
        />
      )}

      {hasError && !arrangement && (
        <ErrorScreen
          message={errorMessage}
          onRetry={() => {
            setWaitedMs(0)
            refetchArr()
          }}
        />
      )}

      {arrangement && (
        <div className="flex-1 min-h-0">
          <Workstation
            projectId={projectId}
            stems={stems}
            loadingStems={loadingStems}
          />
        </div>
      )}
    </div>
  )
}

function SeedingScreen({ waitedMs, stage, progress, onRetry }: {
  waitedMs: number
  stage:    string | null
  progress: number | null
  onRetry:  () => void
}) {
  const elapsed = Math.floor(waitedMs / 1000)
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-purple-500/15 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-purple-300 animate-pulse" />
        </div>
        <h2 className="text-lg font-semibold text-white">Building your starting arrangement…</h2>
        <p className="text-xs text-white/40 leading-relaxed">
          The AI is separating stems and seeding the timeline. This usually takes
          1–3 minutes for two tracks. The page refreshes automatically when ready.
        </p>
        <p className="text-[10px] text-white/30 font-mono">
          {elapsed}s elapsed{stage ? ` · ${stage}` : ''}{progress != null ? ` · ${progress}%` : ''}
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Refresh now
        </Button>
      </div>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-red-500/15 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-red-300" />
        </div>
        <h2 className="text-lg font-semibold text-white">Couldn't load the workstation</h2>
        <p className="text-xs text-white/50 leading-relaxed">{message}</p>
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">Back to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
