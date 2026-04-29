'use client'
import { motion } from 'framer-motion'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/Progress'
import { JOB_STAGE_LABELS, type ProcessingStage, type RenderJob } from '@/types'

const STAGE_ORDER: ProcessingStage[] = [
  'stem_separation',
  'music_analysis',
  'harmonic_matching',
  'mashup_composition',
  'sound_modernization',
  'mastering',
  'rendering',
]

interface ProcessingTimelineProps {
  job: RenderJob
}

export function ProcessingTimeline({ job }: ProcessingTimelineProps) {
  return (
    <div className="space-y-3">
      {/* Overall progress */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-white/80">Overall Progress</p>
          <span className="text-sm font-mono text-purple-400">{job.progress}%</span>
        </div>
        <Progress value={job.progress} color="purple" animated height="md" />
      </div>

      {/* Stage list */}
      <div className="space-y-2">
        {STAGE_ORDER.map((stage, idx) => {
          const stageData = job.stage_progress?.[stage]
          const status    = stageData?.status ?? 'pending'
          const isRunning = status === 'running'

          return (
            <motion.div
              key={stage}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={cn(
                'flex items-center gap-3 rounded-xl p-3 transition-all',
                isRunning && 'bg-purple-500/10 border border-purple-500/20',
                status === 'complete' && 'opacity-70',
                status === 'pending'  && 'opacity-30',
              )}
            >
              {/* Icon */}
              <div className="flex-shrink-0">
                {status === 'complete' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                {status === 'running'  && (
                  <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />
                )}
                {status === 'failed'   && <XCircle    className="h-4 w-4 text-red-400" />}
                {(status === 'pending' || status === 'skipped') && (
                  <Circle className="h-4 w-4 text-white/20" />
                )}
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-sm font-medium',
                  isRunning ? 'text-white' : 'text-white/60'
                )}>
                  {JOB_STAGE_LABELS[stage]}
                </p>
                {isRunning && stageData?.message && (
                  <p className="text-xs text-purple-300/70 mt-0.5">{stageData.message}</p>
                )}
              </div>

              {/* Stage sub-progress */}
              {isRunning && (
                <div className="w-20">
                  <Progress value={stageData?.progress ?? 0} color="purple" height="xs" animated />
                </div>
              )}

              {status === 'complete' && (
                <span className="text-xs text-green-400/60 font-mono">done</span>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Current stage label */}
      {job.current_stage && job.status !== 'complete' && job.status !== 'failed' && (
        <p className="pt-2 text-center text-xs text-white/30">
          {job.current_stage}
        </p>
      )}
    </div>
  )
}
