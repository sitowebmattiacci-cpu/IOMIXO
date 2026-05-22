'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import toast from 'react-hot-toast'
import { Music2, Upload, Loader2, Play, Square } from 'lucide-react'
import { soundbank, samples as samplesApi } from '@/lib/api'
import type {
  SoundbankCategoryId, SoundbankSample, UserSample,
} from '@/types/arrangement'
import { useAssetUrls } from '@/lib/stores/useAssetUrls'
import { Waveform } from './Waveform'

type TabId = SoundbankCategoryId | 'user'

interface TabDef {
  id:    TabId
  label: string
  short: string
}

// Order matters — user library first so users see their own content.
const TABS: TabDef[] = [
  { id: 'user',       label: 'User Imports',     short: 'My Samples' },
  { id: 'afro_house', label: 'Afro House',       short: 'Afro' },
  { id: 'deep_house', label: 'Deep House',       short: 'Deep' },
  { id: 'edm',        label: 'Festival EDM',     short: 'EDM' },
  { id: 'chill',      label: 'Chill / Cinematic', short: 'Chill' },
  { id: 'fx',         label: 'FX / Risers',      short: 'FX' },
]

export function SamplesPanel() {
  const [active, setActive] = useState<TabId>('user')

  const { data: catalog, isLoading: catalogLoading } = useSWR(
    'soundbank',
    () => soundbank.list(),
    { revalidateOnFocus: false },
  )
  const { data: userSamples, isLoading: userLoading, mutate: refetchUser } = useSWR(
    'user_samples',
    () => samplesApi.list(),
    { revalidateOnFocus: false },
  )

  const setManyUrls = useAssetUrls((s) => s.setMany)

  // Publish all signed URLs into the asset map so the timeline / engine
  // can resolve clips back to playable URLs after drop.
  const visibleUserSamples = useMemo(
    () => (userSamples ?? []).filter((s) => !isAIGeneratedSample(s)),
    [userSamples],
  )

  const allEntries = useMemo<[string, string][]>(() => {
    const out: [string, string][] = []
    if (catalog) {
      for (const list of Object.values(catalog.categories)) {
        for (const s of list) if (s.signed_url) out.push([s.s3_key, s.signed_url])
      }
    }
    for (const s of visibleUserSamples) if (s.signed_url) out.push([s.s3_key, s.signed_url])
    return out
  }, [catalog, visibleUserSamples])

  useEffect(() => {
    if (allEntries.length) setManyUrls(allEntries)
  }, [allEntries, setManyUrls])

  const activeTab = TABS.find((t) => t.id === active)!

  const handleUpload = async (file: File) => {
    if (!isAcceptableSample(file)) {
      toast.error('Only WAV or MP3 files are supported')
      return
    }
    if (file.size > MAX_SAMPLE_BYTES) {
      toast.error(`File too large — max ${Math.round(MAX_SAMPLE_BYTES / 1024 / 1024)} MB`)
      return
    }
    const id = toast.loading('Uploading sample…')
    try {
      const contentType = file.type || (file.name.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg')
      const { upload_url, s3_key } = await samplesApi.requestUploadUrl(file.name, contentType, file.size)
      const put = await fetch(upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType },
      })
      if (!put.ok) throw new Error(`Upload failed (${put.status})`)
      const duration = await durationOfFile(file).catch(() => null)
      await samplesApi.register(file.name, s3_key, duration)
      await refetchUser()
      toast.success('Sample uploaded', { id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed', { id })
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">Samples</h3>
        <p className="text-[10px] text-white/30 mt-0.5">Drag onto a lane</p>
      </div>

      {/* Category strip */}
      <div className="border-b border-white/5 px-2 py-2 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide whitespace-nowrap transition-colors ${
                active === t.id
                  ? 'bg-purple-500/20 text-purple-100 border border-purple-400/30'
                  : 'text-white/40 hover:text-white/70 border border-transparent hover:bg-white/[0.04]'
              }`}
            >
              {t.short}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-white/40 px-1">
          {activeTab.label}
        </div>

        {active === 'user' ? (
          <UserSamplesView
            samples={visibleUserSamples}
            loading={userLoading}
            onUpload={handleUpload}
          />
        ) : (
          <SoundbankView
            samples={catalog?.categories[active] ?? []}
            loading={catalogLoading}
            categoryLabel={activeTab.label}
          />
        )}
      </div>
    </div>
  )
}

// ── User samples view ─────────────────────────────────────────
function UserSamplesView({
  samples, loading, onUpload,
}: { samples: UserSample[]; loading: boolean; onUpload: (f: File) => void }) {
  const [busy, setBusy] = useState(false)

  const handleFile = async (f: File | null) => {
    if (!f) return
    setBusy(true)
    try { await onUpload(f) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      <label
        className={`flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-lg border border-dashed transition-colors cursor-pointer ${
          busy
            ? 'border-white/10 text-white/30 cursor-wait'
            : 'border-white/15 text-white/50 hover:border-purple-400/40 hover:text-purple-200 hover:bg-purple-500/5'
        }`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        <span className="text-[11px] font-medium">{busy ? 'Uploading…' : 'Import a sample (WAV / MP3)'}</span>
        <input
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg,audio/mp3"
          className="hidden"
          disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {loading && <SkeletonRows />}
      {!loading && samples.length === 0 && (
        <p className="px-2 py-4 text-center text-[11px] text-white/30">
          Your imported samples will appear here.
        </p>
      )}
      {samples.map((s) => (
        <SampleRow
          key={s.id}
          assetKind="user_sample"
          name={s.name}
          s3Key={s.s3_key}
          durationSec={s.duration_sec}
          signedUrl={s.signed_url}
          colour="#a855f7"
        />
      ))}
    </div>
  )
}

// ── Soundbank category view ───────────────────────────────────
function SoundbankView({
  samples, loading, categoryLabel,
}: { samples: SoundbankSample[]; loading: boolean; categoryLabel: string }) {
  if (loading) return <SkeletonRows />
  if (samples.length === 0) {
    return (
      <div className="px-3 py-8 text-center rounded-xl border border-dashed border-white/10">
        <Music2 className="h-6 w-6 text-white/15 mx-auto mb-2" />
        <p className="text-[11px] font-semibold text-white/50">{categoryLabel}</p>
        <p className="text-[10px] text-white/30 mt-1">Coming soon — content in production</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {samples.map((s) => (
        <SampleRow
          key={s.id}
          assetKind="soundbank"
          name={s.name}
          s3Key={s.s3_key}
          durationSec={s.duration_sec}
          signedUrl={s.signed_url}
          subtitle={[
            s.bpm ? `${s.bpm.toFixed(0)} BPM` : null,
            s.musical_key,
            s.style,
            s.energy,
          ].filter(Boolean).join(' · ')}
          colour={COLOUR_FOR_CATEGORY[s.category] ?? '#a855f7'}
        />
      ))}
    </div>
  )
}

// ── Shared singleton audio player (one at a time across all rows) ──────────
let _previewAudio: HTMLAudioElement | null = null
let _previewUrl = ''

function previewPlay(url: string, onEnd: () => void) {
  if (_previewAudio) {
    _previewAudio.pause()
    _previewAudio.onended = null
  }
  if (_previewUrl === url && !_previewAudio?.paused) return // clicking same → already handled by stop check above
  _previewAudio = new Audio(url)
  _previewUrl = url
  _previewAudio.onended = onEnd
  _previewAudio.play().catch(() => {})
}

function previewStop() {
  if (_previewAudio) {
    _previewAudio.pause()
    _previewAudio.onended = null
    _previewAudio = null
    _previewUrl = ''
  }
}

// ── Shared row ────────────────────────────────────────────────
function SampleRow({
  assetKind, name, s3Key, durationSec, signedUrl, subtitle, colour,
}: {
  assetKind: 'soundbank' | 'user_sample'
  name: string
  s3Key: string
  durationSec: number | null
  signedUrl: string | null
  subtitle?: string
  colour: string
}) {
  const [playing, setPlaying] = useState(false)

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!signedUrl) return
    if (playing) {
      previewStop()
      setPlaying(false)
    } else {
      // Stop any other row that may be playing
      previewStop()
      setPlaying(true)
      previewPlay(signedUrl, () => setPlaying(false))
    }
  }

  // Clean up if this row unmounts while playing
  useEffect(() => {
    return () => {
      if (playing) previewStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!signedUrl) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('application/x-mashfusion-sample', JSON.stringify({
      asset_kind: assetKind,
      asset_ref:  s3Key,
      signed_url: signedUrl,
      duration:   durationSec,
      label:      name,
    }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      draggable={!!signedUrl}
      onDragStart={onDragStart}
      className="group flex flex-col gap-1.5 px-2.5 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] cursor-grab active:cursor-grabbing border border-transparent hover:border-white/10 transition-colors"
      title={s3Key}
    >
      <div className="flex items-center gap-2">
        {/* Play / Stop preview button */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handlePreview}
          disabled={!signedUrl}
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
            playing
              ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-400/40'
              : 'border border-transparent hover:bg-white/10 text-white/40 hover:text-white/80'
          } disabled:opacity-30 disabled:cursor-default`}
          title={playing ? 'Stop preview' : 'Preview sound'}
          style={{ background: playing ? `${colour}30` : undefined, color: playing ? colour : undefined }}
        >
          {playing
            ? <Square className="h-3 w-3 fill-current" />
            : <Play className="h-3 w-3 fill-current" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-white/80 truncate">{name}</div>
          <div className="text-[10px] text-white/30 font-mono truncate">
            {durationSec != null ? `${durationSec.toFixed(1)}s` : '—'}
            {subtitle ? ` · ${subtitle}` : ''}
          </div>
        </div>
      </div>
      {signedUrl && (
        <Waveform url={signedUrl} width={216} height={24} colour={colour} variant="browser" className="rounded" />
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-12 rounded-lg bg-white/[0.03] animate-pulse" />
      ))}
    </div>
  )
}

const COLOUR_FOR_CATEGORY: Record<SoundbankCategoryId, string> = {
  afro_house: '#f97316',
  deep_house: '#22d3ee',
  edm:        '#ec4899',
  chill:      '#a855f7',
  fx:         '#facc15',
}

// Backend mirrors this cap — keep them in sync.
const MAX_SAMPLE_BYTES = 25 * 1024 * 1024

const isAIGeneratedSample = (sample: UserSample): boolean =>
  sample.s3_key.includes('/ai-generated/') || sample.name.startsWith('AI ')
const ACCEPTED_MIME = new Set([
  'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mpeg', 'audio/mp3', 'audio/mpeg3',
])

function isAcceptableSample(f: File): boolean {
  if (f.type && ACCEPTED_MIME.has(f.type.toLowerCase())) return true
  // Some browsers omit MIME — fall back to extension.
  return /\.(wav|mp3)$/i.test(f.name)
}

// Best-effort duration probe so we can store it server-side.
async function durationOfFile(f: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const d = audio.duration
      URL.revokeObjectURL(url)
      if (Number.isFinite(d)) resolve(d)
      else reject(new Error('unknown duration'))
    }
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')) }
    audio.src = url
  })
}
