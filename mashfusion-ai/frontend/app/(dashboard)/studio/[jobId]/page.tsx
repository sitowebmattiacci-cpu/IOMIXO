'use client'
export const runtime = 'edge'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, CheckCircle2, AlertCircle, RefreshCcw, ArrowLeft, Music2 } from 'lucide-react'
import Link from 'next/link'
import useSWR from 'swr'
import { jobs, projects } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { ProcessingTimeline } from '@/components/studio/ProcessingTimeline'
import { WaveformPlayer } from '@/components/studio/WaveformPlayer'
import { AnalysisCard } from '@/components/studio/AnalysisCard'
import { Badge } from '@/components/ui/Badge'
import { useJobStatus } from '@/hooks/useJobStatus'
import { formatDuration } from '@/lib/utils'
import toast from 'react-hot-toast'
import type { FinalOutput, Project } from '@/types'

export default function JobStatusPage({ params }: { params: { jobId: string } }) {
  const { jobId } = params
  const router    = useRouter()

  const [output,  setOutput]  = useState<FinalOutput | null>(null)
  const [downloading, setDownloading] = useState(false)

  const { job, isLoading, isTerminal } = useJobStatus({
    jobId,
    onComplete: async (j) => {
      toast.success('Your mashup is ready!')
      try {
        const out = await jobs.getPreview(j.id)
        setOutput(out)
      } catch (_) {}
    },
    onFailed: (j) => {
      toast.error(j.error_message ?? 'Processing failed')
    },
  })

  const { data: project } = useSWR<Project>(
    job?.project_id ? `project-${job.project_id}` : null,
    () => projects.get(job!.project_id)
  )

  const handleDownload = async (format: 'mp3' | 'wav') => {
    setDownloading(true)
    try {
      const links = await jobs.getDownloadLinks(jobId)
      const url   = format === 'wav' ? links.wav_url : links.mp3_url
      if (!url) { toast.error('File not available in this format'); return }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const statusBadgeVariant = (() => {
    if (!job) return 'default' as const
    const map: Record<string, 'processing' | 'complete' | 'failed' | 'queued'> = {
      complete:  'complete',
      failed:    'failed',
      queued:    'queued',
    }
    return map[job.status] ?? 'processing'
  })()

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-purple-500 border-t-transparent mx-auto" />
          <p className="text-sm text-white/40">Loading job status…</p>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
          <h2 className="font-bold text-white">Job not found</h2>
          <Link href="/dashboard"><Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>Dashboard</Button></Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="mb-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-white/30 hover:text-white/60 transition-colors mb-4">
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">{project?.title ?? 'Mashup Processing'}</h1>
            <p className="text-sm text-white/40 mt-1 font-mono"># {jobId.slice(0, 8)}</p>
          </div>
          <Badge variant={statusBadgeVariant} pulse={statusBadgeVariant === 'processing'}>
            {job.status.replace(/_/g, ' ')}
          </Badge>
        </div>
      </div>

      <div className="grid md:grid-cols-5 gap-6">
        {/* Processing timeline — left/wide column */}
        <div className="md:col-span-3 space-y-6">
          <div className="glass rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-5">Processing Pipeline</h2>
            <ProcessingTimeline job={job} />
          </div>

          {/* Analysis cards — shown when analysis is done */}
          {project?.analysis_a && project?.analysis_b && (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                <h2 className="font-semibold text-white">Audio Analysis</h2>
                <AnalysisCard analysis={project.analysis_a} label="Track A" accent="purple" />
                <AnalysisCard analysis={project.analysis_b} label="Track B" accent="pink" />
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Right column — preview + download */}
        <div className="md:col-span-2 space-y-5">
          {/* AI visualization */}
          {!isTerminal && (
            <div className="glass rounded-2xl p-6 text-center">
              <div className="flex items-end justify-center gap-0.5 h-16 mb-4">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span
                    key={i}
                    className="waveform-bar"
                    style={{
                      height: `${40 + Math.sin(i * 0.7) * 35}%`,
                      animationDelay: `${i * 0.08}s`,
                    }}
                  />
                ))}
              </div>
              <p className="text-sm font-semibold text-white">AI is composing…</p>
              <p className="text-xs text-white/30 mt-1">{job.current_stage || 'Initializing pipeline'}</p>
            </div>
          )}

          {/* Preview player */}
          {output?.preview_mp3_url && (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-4"
              >
                <div className="glass rounded-2xl p-5 border border-green-500/20">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                    <h3 className="font-semibold text-white">Preview Ready</h3>
                  </div>
                  <WaveformPlayer
                    audioUrl={output.preview_mp3_url}
                    label="AI Mashup Preview"
                    color="#a855f7"
                  />
                  {output.duration_seconds && (
                    <div className="mt-3 flex items-center gap-4 text-xs text-white/30">
                      <span>Duration: {formatDuration(output.duration_seconds)}</span>
                      <span>LUFS: {output.loudness_lufs?.toFixed(1)}</span>
                    </div>
                  )}
                </div>

                {/* Download buttons */}
                <div className="glass rounded-2xl p-5 space-y-3">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Download className="h-4 w-4 text-purple-400" />
                    Download
                  </h3>
                  <Button
                    className="w-full"
                    loading={downloading}
                    onClick={() => handleDownload('mp3')}
                    icon={<Music2 className="h-4 w-4" />}
                  >
                    Download MP3
                  </Button>
                  {output.full_wav_url && (
                    <Button
                      variant="secondary"
                      className="w-full"
                      loading={downloading}
                      onClick={() => handleDownload('wav')}
                    >
                      Download WAV (Lossless)
                    </Button>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          )}

          {/* Failed state */}
          {job.status === 'failed' && (
            <div className="glass rounded-2xl p-6 border border-red-500/20 text-center">
              <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
              <h3 className="font-semibold text-white mb-2">Processing Failed</h3>
              <p className="text-xs text-white/40 mb-4">{job.error_message ?? 'An unknown error occurred.'}</p>
              <Button
                variant="secondary"
                icon={<RefreshCcw className="h-4 w-4" />}
                onClick={() => router.push('/studio/new')}
              >
                Try again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
