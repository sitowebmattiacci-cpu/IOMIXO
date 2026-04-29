'use client'
import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Music, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn, formatBytes, truncate } from '@/lib/utils'
import { Progress } from '@/components/ui/Progress'
import { useAudioUpload } from '@/hooks/useAudioUpload'
import type { UploadedTrack } from '@/types'

interface TrackUploaderProps {
  projectId: string
  role: 'track_a' | 'track_b'
  label: string
  accent: 'purple' | 'pink'
  onSuccess: (track: UploadedTrack) => void
}

export function TrackUploader({ projectId, role, label, accent, onSuccess }: TrackUploaderProps) {
  const { state, upload, reset } = useAudioUpload({ projectId, role, onSuccess })

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) upload(accepted[0])
    },
    [upload]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/mpeg':  ['.mp3'],
      'audio/wav':   ['.wav'],
      'audio/flac':  ['.flac'],
      'audio/aiff':  ['.aif', '.aiff'],
      'audio/ogg':   ['.ogg'],
      'audio/mp4':   ['.m4a'],
    },
    maxFiles: 1,
    disabled: state.status === 'uploading' || state.status === 'done',
  })

  const accentStyles = {
    purple: {
      ring:     'border-purple-500/60',
      bg:       'bg-purple-500/10',
      text:     'text-purple-400',
      icon:     'bg-purple-500/15 text-purple-400',
      progress: 'purple' as const,
      glow:     'shadow-neon-purple',
    },
    pink: {
      ring:     'border-pink-500/60',
      bg:       'bg-pink-500/10',
      text:     'text-pink-400',
      icon:     'bg-pink-500/15 text-pink-400',
      progress: 'pink' as const,
      glow:     'shadow-neon-pink',
    },
  }[accent]

  return (
    <div className="w-full">
      {/* Label */}
      <div className="mb-3 flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', accent === 'purple' ? 'bg-purple-500' : 'bg-pink-500')} />
        <p className="text-sm font-semibold text-white/70">{label}</p>
      </div>

      <AnimatePresence mode="wait">
        {/* ── IDLE / DRAG ─────────────────────────────── */}
        {(state.status === 'idle') && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            {...(getRootProps() as object)}
            className={cn(
              'relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all duration-300',
              'border-white/10 hover:border-white/20',
              isDragActive && [accentStyles.ring, accentStyles.bg, accentStyles.glow]
            )}
          >
            <input {...getInputProps()} />

            <motion.div
              animate={isDragActive ? { scale: [1, 1.1, 1], rotate: [0, -5, 5, 0] } : {}}
              transition={{ duration: 0.5 }}
              className={cn('flex h-16 w-16 items-center justify-center rounded-2xl', accentStyles.icon)}
            >
              <Upload className="h-7 w-7" />
            </motion.div>

            <div className="text-center">
              <p className="text-sm font-semibold text-white/80">
                {isDragActive ? 'Drop it here' : 'Drag & drop audio'}
              </p>
              <p className="mt-1 text-xs text-white/30">
                MP3, WAV, FLAC, AIFF — max 100 MB
              </p>
            </div>

            <button
              type="button"
              className={cn('btn-secondary text-xs px-4 py-1.5', accentStyles.text)}
            >
              Browse Files
            </button>
          </motion.div>
        )}

        {/* ── UPLOADING ────────────────────────────────── */}
        {state.status === 'uploading' && (
          <motion.div
            key="uploading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', accentStyles.icon)}>
                <Music className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{truncate(state.file?.name ?? '', 35)}</p>
                <p className="text-xs text-white/30">{formatBytes(state.file?.size ?? 0)}</p>
              </div>
            </div>
            <Progress value={state.progress} color={accentStyles.progress} animated showLabel />
            <p className="text-xs text-white/40 text-center">Uploading to secure cloud storage…</p>
          </motion.div>
        )}

        {/* ── DONE ─────────────────────────────────────── */}
        {state.status === 'done' && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass rounded-2xl p-5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/15">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{truncate(state.file?.name ?? '', 35)}</p>
                <p className="text-xs text-green-400">Ready for processing</p>
              </div>
              <button onClick={reset} className="text-white/20 hover:text-white/50 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* ── ERROR ─────────────────────────────────────── */}
        {state.status === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass rounded-2xl p-5 border border-red-500/20"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400">Upload failed</p>
                <p className="text-xs text-white/30">{state.error}</p>
              </div>
              <button onClick={reset} className="text-white/20 hover:text-white/50 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
