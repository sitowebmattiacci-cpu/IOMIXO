'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, CheckCircle2, AlertCircle, Download, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { jobs } from '@/lib/api'
import type { RenderJob } from '@/types'

interface Props {
  jobId:     string | null
  onClose:   () => void
}

const POLL_INTERVAL_MS = 2000

export function RenderProgressModal({ jobId, onClose }: Props) {
  const [job, setJob] = useState<RenderJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      try {
        const j = await jobs.getStatus(jobId)
        if (cancelled) return
        setJob(j)
        if (j.status !== 'complete' && j.status !== 'failed') {
          timer = setTimeout(tick, POLL_INTERVAL_MS)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to fetch render status')
      }
    }
    tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [jobId])

  return (
    <AnimatePresence>
      {jobId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-2xl border border-white/10 bg-surface-900 p-6 shadow-xl"
          >
            <button
              onClick={onClose}
              className="absolute top-3 right-3 h-7 w-7 rounded-full text-white/40 hover:text-white/80 hover:bg-white/5 flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>

            <Body job={job} error={error} jobId={jobId} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Body({
  job, error, jobId,
}: { job: RenderJob | null; error: string | null; jobId: string }) {
  if (error) {
    return (
      <div className="text-center space-y-3 py-4">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
        <h3 className="font-bold text-white">Couldn&apos;t track render</h3>
        <p className="text-sm text-white/50">{error}</p>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="text-center space-y-3 py-6">
        <Sparkles className="h-10 w-10 text-purple-400 mx-auto animate-pulse" />
        <h3 className="font-bold text-white">Starting render…</h3>
      </div>
    )
  }

  if (job.status === 'failed') {
    return (
      <div className="text-center space-y-3 py-4">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
        <h3 className="font-bold text-white">Render failed</h3>
        <p className="text-sm text-white/50">{job.error_message ?? 'Unexpected error'}</p>
      </div>
    )
  }

  if (job.status === 'complete') {
    return (
      <div className="text-center space-y-4 py-2">
        <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto" />
        <h3 className="font-bold text-white">Render complete</h3>
        <p className="text-sm text-white/50">Your mashup is ready to download.</p>
        <Link
          href={`/download/${jobId}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 text-white text-sm font-semibold transition-colors"
        >
          <Download className="h-4 w-4" />
          Open download page
          <ExternalLink className="h-3.5 w-3.5 opacity-70" />
        </Link>
      </div>
    )
  }

  // Active render — show progress.
  const pct = Math.max(0, Math.min(100, job.progress ?? 0))
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-purple-300 animate-pulse" />
        </div>
        <div>
          <h3 className="font-bold text-white">Rendering your mix</h3>
          <p className="text-xs text-white/40 capitalize">{job.current_stage?.replace(/_/g, ' ') ?? 'queued'}</p>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[11px] text-white/40 mb-1.5 font-mono">
          <span>{pct.toFixed(0)}%</span>
          <span>{job.status}</span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            animate={{ width: `${pct}%` }}
            transition={{ ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
          />
        </div>
      </div>

      <p className="text-[11px] text-white/30">
        You can close this dialog — the render continues in the background and will appear in your projects when done.
      </p>
    </div>
  )
}
