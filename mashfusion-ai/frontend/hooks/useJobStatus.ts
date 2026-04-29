'use client'
import { useEffect, useRef, useCallback } from 'react'
import useSWR from 'swr'
import { jobs } from '@/lib/api'
import { getAccessToken } from '@/lib/supabase'
import type { RenderJob, JobStatus } from '@/types'

const TERMINAL_STATES: JobStatus[] = ['complete', 'failed']
const POLL_INTERVAL_MS = 5_000   // fallback if SSE not available

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

interface UseJobStatusOptions {
  jobId: string | null
  onComplete?: (job: RenderJob) => void
  onFailed?:   (job: RenderJob) => void
}

export function useJobStatus({ jobId, onComplete, onFailed }: UseJobStatusOptions) {
  const calledRef    = useRef<{ complete: boolean; failed: boolean }>({ complete: false, failed: false })
  const sseActiveRef = useRef(false)
  const esRef        = useRef<EventSource | null>(null)

  const fetcher = useCallback(
    (id: string) => jobs.getStatus(id),
    []
  )

  const { data: job, error, isLoading, mutate } = useSWR<RenderJob>(
    jobId ? `job-status-${jobId}` : null,
    () => fetcher(jobId!),
    {
      // Slower poll — SSE handles real-time updates
      refreshInterval: (data) => {
        if (!data) return POLL_INTERVAL_MS
        return TERMINAL_STATES.includes(data.status) ? 0 : POLL_INTERVAL_MS
      },
      revalidateOnFocus: false,
      dedupingInterval: 1_000,
    }
  )

  // ── SSE subscription ─────────────────────────────────────────
  useEffect(() => {
    if (!jobId || sseActiveRef.current) return
    if (job && TERMINAL_STATES.includes(job.status)) return

    let cancelled = false
    sseActiveRef.current = true
    const url = `${API_URL}/jobs/${jobId}/stream`

    ;(async () => {
      const token = await getAccessToken()
      if (!token || cancelled) { sseActiveRef.current = false; return }
      const es = new EventSource(`${url}?token=${encodeURIComponent(token)}`)
      esRef.current = es

      es.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data) as Partial<RenderJob>
          mutate((prev) => prev ? { ...prev, ...update } : prev, false)
        } catch { /* ignore malformed events */ }
      }

      es.onerror = () => {
        es.close()
        esRef.current = null
        sseActiveRef.current = false
      }
    })()

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
      sseActiveRef.current = false
    }
  }, [jobId, job, mutate])

  useEffect(() => {
    if (!job) return

    if (job.status === 'complete' && !calledRef.current.complete) {
      calledRef.current.complete = true
      onComplete?.(job)
    }

    if (job.status === 'failed' && !calledRef.current.failed) {
      calledRef.current.failed = true
      onFailed?.(job)
    }
  }, [job, onComplete, onFailed])

  const isTerminal = job ? TERMINAL_STATES.includes(job.status) : false

  return {
    job,
    error,
    isLoading,
    isTerminal,
    refresh: mutate,
  }
}
