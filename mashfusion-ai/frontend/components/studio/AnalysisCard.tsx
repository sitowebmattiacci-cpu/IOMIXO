'use client'
import { cn, getKeyLabel } from '@/lib/utils'
import { Activity, Music2, Clock, Zap } from 'lucide-react'
import type { AnalysisResult } from '@/types'

interface AnalysisCardProps {
  analysis: AnalysisResult
  label: string
  accent: 'purple' | 'pink'
}

export function AnalysisCard({ analysis, label, accent }: AnalysisCardProps) {
  const accentClasses = {
    purple: { title: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    pink:   { title: 'text-pink-400',   bg: 'bg-pink-500/10',   border: 'border-pink-500/20' },
  }[accent]

  const stats = [
    {
      icon: <Activity className="h-3.5 w-3.5" />,
      label: 'BPM',
      value: analysis.bpm.toFixed(1),
      sub: `${Math.round(analysis.bpm_confidence * 100)}% conf.`,
    },
    {
      icon: <Music2 className="h-3.5 w-3.5" />,
      label: 'Key',
      value: getKeyLabel(analysis.musical_key),
      sub: `${Math.round(analysis.key_confidence * 100)}% conf.`,
    },
    {
      icon: <Clock className="h-3.5 w-3.5" />,
      label: 'Time Sig',
      value: analysis.time_signature,
      sub: 'beats/bar',
    },
    {
      icon: <Zap className="h-3.5 w-3.5" />,
      label: 'Sections',
      value: analysis.sections.length.toString(),
      sub: 'detected',
    },
  ]

  return (
    <div className={cn('glass rounded-xl p-4 border', accentClasses.border)}>
      <p className={cn('mb-3 text-xs font-semibold uppercase tracking-wider', accentClasses.title)}>
        {label}
      </p>

      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label} className={cn('rounded-lg p-2.5', accentClasses.bg)}>
            <div className={cn('flex items-center gap-1 mb-1', accentClasses.title)}>
              {s.icon}
              <span className="text-[10px] uppercase tracking-wider">{s.label}</span>
            </div>
            <p className="text-lg font-bold text-white leading-none">{s.value}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Sections timeline */}
      {analysis.sections.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] text-white/30 uppercase tracking-wider">Structure</p>
          <div className="flex gap-0.5 rounded-lg overflow-hidden h-5">
            {analysis.sections.map((sec, i) => {
              const total = analysis.sections[analysis.sections.length - 1].end_time
              const width = ((sec.end_time - sec.start_time) / total) * 100

              const colors: Record<string, string> = {
                intro:       'bg-blue-500/60',
                verse:       'bg-purple-500/60',
                pre_chorus:  'bg-violet-500/60',
                chorus:      'bg-pink-500/80',
                bridge:      'bg-amber-500/60',
                drop:        'bg-red-500/80',
                breakdown:   'bg-cyan-500/60',
                outro:       'bg-gray-500/40',
              }

              return (
                <div
                  key={i}
                  className={cn('relative group', colors[sec.label] ?? 'bg-white/20')}
                  style={{ width: `${width}%`, minWidth: 4 }}
                  title={`${sec.label} (${sec.start_time.toFixed(1)}s – ${sec.end_time.toFixed(1)}s)`}
                >
                  <span className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block text-[9px] bg-black/80 rounded px-1 whitespace-nowrap">
                    {sec.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
