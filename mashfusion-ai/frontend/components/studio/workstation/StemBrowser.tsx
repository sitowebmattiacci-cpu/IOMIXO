'use client'

import { Music2, Mic2, Drum, Waves } from 'lucide-react'
import type { ProjectStem } from '@/types/arrangement'
import { Waveform } from './Waveform'

interface Props {
  stems: ProjectStem[]
  loading?: boolean
}

const STEM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  vocals: Mic2,
  drums:  Drum,
  bass:   Waves,
  other:  Music2,
}

const SIDE_LABEL: Record<'a' | 'b', string> = {
  a: 'Track A',
  b: 'Track B',
}

export function StemBrowser({ stems, loading }: Props) {
  const grouped: Record<'a' | 'b', ProjectStem[]> = { a: [], b: [] }
  for (const s of stems) grouped[s.side]?.push(s)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-black/50">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/75">Stems</h3>
        <p className="text-[10px] text-white/40 mt-0.5">Drag onto a lane</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {loading && (
          <div className="px-3 text-xs text-white/50">Loading stems…</div>
        )}
        {!loading && stems.length === 0 && (
          <div className="px-3 text-xs text-white/40">
            Stems will appear once separation finishes.
          </div>
        )}

        {(['a', 'b'] as const).map((side) => grouped[side].length > 0 && (
          <div key={side}>
            <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-white/50">
              {SIDE_LABEL[side]}
            </div>
            <div className="space-y-1.5">
              {grouped[side].map((s) => <StemRow key={s.id} stem={s} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StemRow({ stem }: { stem: ProjectStem }) {
  const Icon = STEM_ICONS[stem.stem_name] ?? Music2
  const colour = COLOUR_MAP[stem.stem_name] ?? '#a855f7'
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!stem.signed_url) return
    e.dataTransfer.setData('application/x-mashfusion-stem', JSON.stringify({
      stem_id:    stem.id,
      asset_kind: 'stem',
      asset_ref:  stem.s3_key,
      signed_url: stem.signed_url,
      duration:   stem.duration_sec,
      label:      `${stem.side.toUpperCase()} · ${stem.stem_name}`,
    }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      draggable={!!stem.signed_url}
      onDragStart={onDragStart}
      className="group flex flex-col gap-1.5 px-2.5 py-2 rounded-lg bg-black/20 hover:bg-black/35 cursor-grab active:cursor-grabbing border border-black/50 hover:border-white/15 transition-colors"
      title={stem.s3_key}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/80 border border-black/60">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-white/85 capitalize truncate">{stem.stem_name}</div>
          {stem.duration_sec != null && (
            <div className="text-[10px] text-white/40 font-mono">{stem.duration_sec.toFixed(1)}s</div>
          )}
        </div>
      </div>
      {stem.signed_url && (
        <Waveform
          url={stem.signed_url}
          width={216}
          height={28}
          colour={colour}
          variant="browser"
          className="rounded"
        />
      )}
    </div>
  )
}

const COLOUR_MAP: Record<string, string> = {
  vocals: '#ec4899',
  drums:  '#f59e0b',
  bass:   '#22d3ee',
  other:  '#a855f7',
}
