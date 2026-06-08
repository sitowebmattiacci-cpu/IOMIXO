'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Sparkles, ChevronRight, Zap, HelpCircle, Music, Layers } from 'lucide-react'
import { projects, jobs } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { TrackUploader } from '@/components/studio/DualUploader'
import { StylePresetSelector } from '@/components/studio/StylePresetSelector'
import { RemixDirectorInput } from '@/components/studio/RemixDirectorInput'
import toast from 'react-hot-toast'
import type { RemixStyle, UploadedTrack } from '@/types'
import useSWR from 'swr'
import { auth } from '@/lib/api'
import type { User } from '@/types'

type ProjectMode = 'remix' | 'mashup'

const QUALITY_OPTIONS = [
  { value: 'standard',     label: 'Standard MP3',  desc: '192 kbps MP3',              plans: ['free', 'pro', 'studio'] },
  { value: 'hd',           label: 'HD MP3',         desc: '320 kbps MP3',              plans: ['pro', 'studio'] },
  { value: 'professional', label: 'Professional',   desc: 'WAV 24-bit + stem files',   plans: ['studio'] },
] as const

export default function NewStudioPage() {
  const router = useRouter()
  const { data: me } = useSWR<User>('me', () => auth.me())

  const [mode,           setMode]           = useState<ProjectMode | null>(null)
  const [step,           setStep]           = useState<1 | 2 | 3>(1)
  const [projectId,      setProjectId]      = useState<string | null>(null)
  const [trackA,         setTrackA]         = useState<UploadedTrack | null>(null)
  const [trackB,         setTrackB]         = useState<UploadedTrack | null>(null)
  const [remixStyle,     setRemixStyle]     = useState<RemixStyle>('none')
  const [outputQuality,  setOutputQuality]  = useState<'standard' | 'hd' | 'professional'>('standard')
  const [remixPrompt,    setRemixPrompt]    = useState<string>('')
  const [launching,      setLaunching]      = useState(false)

  // Lazily create the project once the user has chosen a mode and is about
  // to upload — so the project's `mode` is set correctly from creation.
  const ensureProject = useCallback(async (currentMode: ProjectMode) => {
    if (projectId) return projectId
    const project = await projects.create(`${currentMode === 'remix' ? 'Remix' : 'Mashup'} ${new Date().toLocaleDateString()}`, currentMode)
    setProjectId(project.id)
    return project.id
  }, [projectId])

  const handleTrackASuccess = useCallback(async (track: UploadedTrack) => {
    setTrackA(track)
    if (mode === 'remix') {
      // Remix mode: one track is enough — go straight to launch.
      setStep(3)
    } else if (trackB) {
      setStep(2)
    }
  }, [mode, trackB])

  const handleTrackBSuccess = useCallback(async (track: UploadedTrack) => {
    setTrackB(track)
    if (trackA) setStep(2)
  }, [trackA])

  const canLaunch = mode === 'remix' ? !!trackA : !!trackA && !!trackB

  const handleLaunch = async () => {
    if (!projectId || !canLaunch) {
      toast.error(mode === 'remix' ? 'Please upload your track first' : 'Please upload both tracks first')
      return
    }

    setLaunching(true)
    try {
      const job = await jobs.startRemix(projectId, remixStyle, outputQuality, remixPrompt || undefined)
      toast.success(mode === 'remix'
        ? 'Separating stems… you’ll be in the workstation in a minute'
        : 'Generating your starting arrangement…')
      router.push(`/studio/${job.project_id}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to start job')
      setLaunching(false)
    }
  }

  // ── Step 0: pick mode ──────────────────────────────────────────────
  if (!mode) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs text-white/30 mb-3">
            <span>Studio</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-purple-400">New Project</span>
          </div>
          <h1 className="text-2xl font-black text-white">What do you want to create?</h1>
          <p className="text-sm text-white/40 mt-1">
            You’re the creative director. IOMIXO is your AI co-producer.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <button
            onClick={() => setMode('remix')}
            className="glass rounded-2xl p-6 text-left border border-white/8 hover:border-purple-500/50 transition-all group"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/15 mb-4 group-hover:scale-105 transition-transform">
              <Music className="h-6 w-6 text-purple-300" />
            </div>
            <h2 className="text-lg font-semibold text-white">Remix</h2>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Upload <span className="text-white/80">one track</span>. We separate stems and drop you
              into the workstation with an empty timeline. Build your remix from scratch.
            </p>
            <div className="mt-4 flex items-center gap-1 text-[11px] text-purple-300">
              <Zap className="h-3 w-3" />
              Stems · empty timeline · soundbank · samples
            </div>
          </button>

          <button
            onClick={() => setMode('mashup')}
            className="glass rounded-2xl p-6 text-left border border-white/8 hover:border-pink-500/50 transition-all group"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pink-500/15 mb-4 group-hover:scale-105 transition-transform">
              <Layers className="h-6 w-6 text-pink-300" />
            </div>
            <h2 className="text-lg font-semibold text-white">Mashup</h2>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Upload <span className="text-white/80">two tracks</span>. AI seeds an editable starting
              arrangement on the timeline so you can sculpt the mashup from there.
            </p>
            <div className="mt-4 flex items-center gap-1 text-[11px] text-pink-300">
              <Sparkles className="h-3 w-3" />
              AI seed · pre-placed clips · harmonic match
            </div>
          </button>
        </div>
      </div>
    )
  }

  const isRemix = mode === 'remix'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-white/30 mb-3">
          <span>Studio</span>
          <ChevronRight className="h-3 w-3" />
          <button onClick={() => { setMode(null); setStep(1); setProjectId(null); setTrackA(null); setTrackB(null) }} className="hover:text-white/60">
            New Project
          </button>
          <ChevronRight className="h-3 w-3" />
          <span className={isRemix ? 'text-purple-400' : 'text-pink-400'}>{isRemix ? 'Remix' : 'Mashup'}</span>
        </div>
        <h1 className="text-2xl font-black text-white">
          {isRemix ? 'Create New Remix' : 'Create New Mashup'}
        </h1>
        <p className="text-sm text-white/40 mt-1">
          {isRemix
            ? 'Upload one track. We split it into stems for you to remix.'
            : 'Upload two tracks. AI seeds an editable starting arrangement.'}
        </p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-3 mb-8">
        {(isRemix
          ? [{ n: 1, label: 'Upload Track' }, { n: 3, label: 'Launch' }]
          : [{ n: 1, label: 'Upload Tracks' }, { n: 2, label: 'Configure' }, { n: 3, label: 'Launch' }]
        ).map(({ n, label }, i, arr) => (
          <div key={n} className="flex items-center gap-3">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${
              step >= n
                ? (isRemix ? 'bg-purple-600 text-white' : 'bg-pink-600 text-white')
                : 'bg-white/5 text-white/30'
            }`}>
              {i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${step >= n ? 'text-white/70' : 'text-white/25'}`}>
              {label}
            </span>
            {i < arr.length - 1 && (
              <div className={`h-px w-8 transition-all ${step > n ? (isRemix ? 'bg-purple-500' : 'bg-pink-500') : 'bg-white/10'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="space-y-6">
        {/* ── STEP 1: Upload ───────────────────────────────── */}
        <motion.div layout className="space-y-4">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">
            Step 1 — {isRemix ? 'Upload Track' : 'Upload Tracks'}
          </p>

          {projectId ? (
            isRemix ? (
              <TrackUploader
                projectId={projectId}
                role="track_a"
                label="Your Track"
                accent="purple"
                onSuccess={handleTrackASuccess}
              />
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                <TrackUploader
                  projectId={projectId}
                  role="track_a"
                  label="Track A — Vocals / Main Song"
                  accent="purple"
                  onSuccess={handleTrackASuccess}
                />
                <TrackUploader
                  projectId={projectId}
                  role="track_b"
                  label="Track B — Instrumental / Second Song"
                  accent="pink"
                  onSuccess={handleTrackBSuccess}
                />
              </div>
            )
          ) : (
            <div
              className="glass rounded-2xl p-8 text-center border-2 border-dashed border-white/10 cursor-pointer hover:border-purple-500/40 transition-all"
              onClick={async () => {
                try {
                  await ensureProject(mode)
                } catch {
                  toast.error('Failed to create project')
                }
              }}
            >
              <p className="text-sm font-semibold text-white/60">Click to start — create your project</p>
              <p className="text-xs text-white/25 mt-1">You can upload {isRemix ? 'your track' : 'tracks'} after</p>
            </div>
          )}

          {!projectId && (
            <Button
              className="w-full"
              variant="secondary"
              onClick={async () => {
                try { await ensureProject(mode) }
                catch { toast.error('Failed to create project') }
              }}
            >
              Initialize Project
            </Button>
          )}
        </motion.div>

        {/* ── STEP 2: Configure (mashup only) ─────────────────── */}
        {!isRemix && (step >= 2 || canLaunch) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Step 2 — Configure Style</p>

            <StylePresetSelector value={remixStyle} onChange={setRemixStyle} />

            <RemixDirectorInput value={remixPrompt} onChange={setRemixPrompt} />

            <div>
              <p className="mb-3 text-sm font-semibold text-white/70">Output Quality</p>
              <div className="grid grid-cols-3 gap-2">
                {QUALITY_OPTIONS.map((opt) => {
                  const locked   = !(opt.plans as readonly string[]).includes(me?.plan ?? 'free')
                  const selected = outputQuality === opt.value
                  return (
                    <button
                      key={opt.value}
                      disabled={locked}
                      onClick={() => !locked && setOutputQuality(opt.value)}
                      className={`relative rounded-xl border p-3 text-left transition-all ${
                        selected
                          ? 'border-purple-500/60 bg-purple-500/10'
                          : locked
                          ? 'border-white/5 opacity-40 cursor-not-allowed'
                          : 'border-white/8 hover:border-white/15'
                      }`}
                    >
                      <p className="text-xs font-semibold text-white">{opt.label}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">{opt.desc}</p>
                      {locked && (
                        <span className="absolute top-1.5 right-1.5 text-[9px] bg-amber-500/20 text-amber-400 rounded px-1">
                          Upgrade
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── STEP 3: Launch ───────────────────────────────── */}
        {canLaunch && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`glass rounded-2xl p-6 border ${isRemix ? 'border-purple-500/20' : 'border-pink-500/20'}`}
          >
            <div className="flex items-start gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${isRemix ? 'bg-purple-500/15' : 'bg-pink-500/15'}`}>
                <Sparkles className={`h-6 w-6 ${isRemix ? 'text-purple-400' : 'text-pink-400'}`} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-white">
                  {isRemix ? 'Open the workstation with your stems' : 'Generate the starting arrangement'}
                </h3>
                <p className="text-sm text-white/40 mt-1">
                  {isRemix
                    ? 'We will separate your track into stems (vocals, drums, bass, etc.) and open the workstation with an empty timeline. Drag stems and samples in to build your remix.'
                    : 'The AI will analyze, separate stems, and seed an editable arrangement on the timeline. Edit it freely and render when you’re happy.'}
                </p>
              </div>
            </div>

            <Button
              className="w-full mt-5"
              size="lg"
              loading={launching}
              onClick={handleLaunch}
              icon={<Sparkles className="h-4 w-4" />}
            >
              {isRemix ? 'Separate Stems & Open Workstation' : 'Generate Starting Arrangement'}
            </Button>

            <p className="mt-3 flex items-center justify-center gap-1 text-xs text-white/20">
              <HelpCircle className="h-3 w-3" />
              {isRemix ? 'Stem separation typically takes 1–2 minutes.' : 'Seeding typically takes 1–3 minutes.'}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
