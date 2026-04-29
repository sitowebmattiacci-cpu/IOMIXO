'use client'
export const runtime = 'edge'
import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Download, Music2, FileAudio, CheckCircle2, ArrowLeft,
  Clock, Volume2, BarChart3, AlertCircle, Share2, Copy,
} from 'lucide-react'
import useSWR from 'swr'
import { jobs, auth } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { WaveformPlayer } from '@/components/studio/WaveformPlayer'
import { formatDuration, formatBytes, formatRelativeTime } from '@/lib/utils'
import toast from 'react-hot-toast'
import type { FinalOutput, RenderJob, User } from '@/types'

// ── Download links type ──────────────────────────────────────
interface DownloadLinks { mp3_url: string | null; wav_url: string | null; expires_at: string }

export default function DownloadPage({ params }: { params: { jobId: string } }) {
  const { jobId } = params

  const [downloading, setDownloading] = useState<'mp3' | 'wav' | null>(null)

  const { data: job, isLoading: jobLoading } = useSWR<RenderJob>(
    `job-dl-${jobId}`,
    () => jobs.getStatus(jobId),
    { revalidateOnFocus: false }
  )

  const { data: output } = useSWR<FinalOutput>(
    job?.status === 'complete' ? `preview-${jobId}` : null,
    () => jobs.getPreview(jobId),
    { revalidateOnFocus: false }
  )

  const { data: me } = useSWR<User>('me', () => auth.me(), { revalidateOnFocus: false })

  const handleDownload = async (format: 'mp3' | 'wav') => {
    setDownloading(format)
    try {
      const links: DownloadLinks = await jobs.getDownloadLinks(jobId)
      const url = format === 'wav' ? links.wav_url : links.mp3_url
      if (!url) { toast.error(`${format.toUpperCase()} not available for this quality tier`); return }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(null)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    toast.success('Link copied to clipboard')
  }

  // ── Loading ──────────────────────────────────────────────────
  if (jobLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    )
  }

  // ── Job not found ────────────────────────────────────────────
  if (!job) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
          <h2 className="font-bold text-white">Job not found</h2>
          <p className="text-sm text-white/40">This job may have been deleted or doesn&apos;t belong to your account.</p>
          <Link href="/dashboard">
            <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    )
  }

  // ── Still processing ─────────────────────────────────────────
  if (job.status !== 'complete') {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-sm">
          {job.status === 'failed' ? (
            <>
              <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
              <h2 className="font-bold text-white">Processing failed</h2>
              <p className="text-sm text-white/40">{job.error_message ?? 'An unexpected error occurred.'}</p>
            </>
          ) : (
            <>
              <div className="flex items-end justify-center gap-0.5 h-12">
                {Array.from({ length: 10 }).map((_, i) => (
                  <span
                    key={i}
                    className="waveform-bar"
                    style={{ height: `${40 + Math.sin(i * 0.7) * 35}%`, animationDelay: `${i * 0.08}s` }}
                  />
                ))}
              </div>
              <h2 className="font-bold text-white">Still processing…</h2>
              <p className="text-sm text-white/40">{job.current_stage || `${job.progress}% complete`}</p>
            </>
          )}
          <Link href={`/studio/${jobId}`}>
            <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>View progress</Button>
          </Link>
        </div>
      </div>
    )
  }

  // ── Complete ──────────────────────────────────────────────────
  const qualityLabel: Record<string, string> = {
    standard:     'Standard MP3',
    hd:           'HD MP3',
    professional: 'Professional WAV',
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full">
      {/* Back nav */}
      <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-white/30 hover:text-white/60 transition-colors mb-6">
        <ArrowLeft className="h-3.5 w-3.5" />
        Projects
      </Link>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
              <Badge variant="complete">Ready to download</Badge>
            </div>
            <h1 className="text-3xl font-black text-white">Your Mashup</h1>
            <p className="text-sm text-white/40 mt-1 font-mono">
              #{jobId.slice(0, 8)} · {job.completed_at ? formatRelativeTime(job.completed_at) : ''}
            </p>
          </div>
          <button
            onClick={handleCopyLink}
            className="p-2 glass rounded-xl text-white/30 hover:text-white/60 transition-colors"
            title="Copy share link"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      <div className="space-y-5">
        {/* Waveform player */}
        {output?.preview_mp3_url && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="glass rounded-2xl p-6 border border-purple-500/20">
              <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
                <Music2 className="h-4 w-4 text-purple-400" />
                Preview
              </h2>
              <WaveformPlayer audioUrl={output.preview_mp3_url} label="AI Mashup" color="#a855f7" />
            </div>
          </motion.div>
        )}

        {/* Audio metadata */}
        {output && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <div className="glass rounded-2xl p-6">
              <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-purple-400" />
                Audio specs
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat icon={<Clock className="h-4 w-4" />} label="Duration" value={formatDuration(output.duration_seconds)} />
                <Stat icon={<Volume2 className="h-4 w-4" />} label="Loudness" value={`${output.loudness_lufs?.toFixed(1)} LUFS`} />
                <Stat icon={<FileAudio className="h-4 w-4" />} label="Sample rate" value={`${output.sample_rate / 1000} kHz`} />
                <Stat icon={<FileAudio className="h-4 w-4" />} label="Quality" value={qualityLabel[job.output_quality ?? 'standard'] ?? job.output_quality ?? '—'} />
              </div>
            </div>
          </motion.div>
        )}

        {/* Download buttons */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Download className="h-4 w-4 text-purple-400" />
              Download files
            </h2>

            {/* MP3 */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/4 border border-white/6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Music2 className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">MP3 Audio</p>
                  <p className="text-xs text-white/30">
                    {job.output_quality === 'standard' ? '192 kbps' : '320 kbps'} · Best for streaming & sharing
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                loading={downloading === 'mp3'}
                onClick={() => handleDownload('mp3')}
                icon={<Download className="h-3.5 w-3.5" />}
              >
                Download
              </Button>
            </div>

            {/* WAV — only for hd / professional */}
            {output?.full_wav_url && (
              <div className="flex items-center justify-between p-4 rounded-xl bg-white/4 border border-white/6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <FileAudio className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">WAV Audio</p>
                    <p className="text-xs text-white/30">
                      {output.bit_depth}-bit / {output.sample_rate / 1000} kHz · Lossless master
                      {output.file_size_bytes ? ` · ${formatBytes(output.file_size_bytes)}` : ''}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={downloading === 'wav'}
                  onClick={() => handleDownload('wav')}
                  icon={<Download className="h-3.5 w-3.5" />}
                >
                  Download
                </Button>
              </div>
            )}

            {/* Upgrade prompt if on free plan */}
            {me?.plan === 'free' && !output?.full_wav_url && (
              <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 text-sm text-white/60">
                <span className="text-purple-300 font-medium">Upgrade to Pro</span> to unlock WAV downloads
                and 320 kbps MP3.{' '}
                <Link href="/billing" className="text-purple-400 hover:text-purple-300 underline underline-offset-2">
                  See plans →
                </Link>
              </div>
            )}
          </div>
        </motion.div>

        {/* Copy share / next actions */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <div className="glass rounded-2xl p-6 space-y-3">
            <h2 className="font-semibold text-white text-sm">What&apos;s next?</h2>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/8 text-sm text-white/60 hover:text-white/90 hover:bg-white/8 transition-all"
              >
                <Copy className="h-3.5 w-3.5" /> Copy share link
              </button>
              <Link href="/studio/new">
                <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/15 border border-purple-500/25 text-sm text-purple-300 hover:bg-purple-500/20 transition-all">
                  <Music2 className="h-3.5 w-3.5" /> Create another mashup
                </button>
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

// ── Sub-component: stat cell ──────────────────────────────────
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-white/30">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm font-semibold text-white">{value}</p>
    </div>
  )
}
