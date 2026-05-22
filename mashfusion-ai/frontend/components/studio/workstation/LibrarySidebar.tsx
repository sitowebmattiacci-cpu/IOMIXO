'use client'

import { useState } from 'react'
import { Music2, Library } from 'lucide-react'
import type { ProjectStem } from '@/types/arrangement'
import { StemBrowser } from './StemBrowser'
import { SamplesPanel } from './SamplesPanel'

type Tab = 'stems' | 'samples'

interface Props {
  stems: ProjectStem[]
  loadingStems: boolean
}

export function LibrarySidebar({ stems, loadingStems }: Props) {
  const [tab, setTab] = useState<Tab>('stems')

  return (
    <aside className="w-72 shrink-0 daw-panel flex flex-col overflow-hidden">
      <div className="flex daw-panel-header">
        <TabButton
          active={tab === 'stems'}
          onClick={() => setTab('stems')}
          icon={<Music2 className="h-3.5 w-3.5" />}
          label="Stems"
          count={stems.length}
        />
        <TabButton
          active={tab === 'samples'}
          onClick={() => setTab('samples')}
          icon={<Library className="h-3.5 w-3.5" />}
          label="Samples"
        />
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'stems' ? (
          <StemBrowser stems={stems} loading={loadingStems} />
        ) : (
          <SamplesPanel />
        )}
      </div>
    </aside>
  )
}

function TabButton({
  active, onClick, icon, label, count,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold tracking-wide transition-colors ${
        active
          ? 'text-emerald-100 bg-black/20 border-b-2 border-emerald-300/70'
          : 'text-white/40 hover:text-white/70 border-b-2 border-transparent'
      }`}
    >
      {icon}
      {label}
      {count != null && (
        <span className="text-[10px] font-mono text-white/40">{count}</span>
      )}
    </button>
  )
}
