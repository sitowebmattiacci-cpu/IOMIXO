'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Sparkles, ChevronRight, Zap, HelpCircle } from 'lucide-react'
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

const QUALITY_OPTIONS = [
  { value: 'standard',     label: 'Standard MP3',  desc: '192 kbps MP3',              plans: ['free', 'pro', 'studio'] },
  { value: 'hd',           label: 'HD MP3',         desc: '320 kbps MP3',              plans: ['pro', 'studio'] },
  { value: 'professional', label: 'Professional',   desc: 'WAV 24-bit + stem files',   plans: ['studio'] },
] as const

export default function NewStudioPage() {
  const router = useRouter()
  const { data: me } = useSWR<User>('me', () => auth.me())

  const [step,           setStep]           = useState<1 | 2 | 3>(1)
  const [projectId,      setProjectId]      = useState<string | null>(null)
  const [trackA,         setTrackA]         = useState<UploadedTrack | null>(null)
  const [trackB,         setTrackB]         = useState<UploadedTrack | null>(null)
  const [remixStyle,     setRemixStyle]     = useState<RemixStyle>('none')
  const [outputQuality,  setOutputQuality]  = useState<'standard' | 'hd' | 'professional'>('standard')
  const [remixPrompt,    setRemixPrompt]    = useState<string>('')
  const [launching,      setLaunching]      = useState(false)

  // Create project lazily when first track is uploaded
  const ensureProject = useCallback(async () => {
    if (projectId) return projectId
    const project = await projects.create(`Mashup ${new Date().toLocaleDateString()}`)
    setProjectId(project.id)
    return project.id
  }, [projectId])

  const handleTrackASuccess = useCallback(async (track: UploadedTrack) => {
    setTrackA(track)
    if (trackB) setStep(2)
  }, [trackB])

  const handleTrackBSuccess = useCallback(async (track: UploadedTrack) => {
    setTrackB(track)
    if (trackA) setStep(2)
  }, [trackA])

  const handleLaunch = async () => {
    if (!trackA || !trackB || !projectId) {
      toast.error('Please upload both tracks first')
      return
    }

    setLaunching(true)
    try {
      const job = await jobs.startRemix(projectId, remixStyle, outputQuality, remixPrompt || undefined)
      toast.success('Generating your free previews…')
      router.push(`/studio/${job.id}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to start job')
      setLaunching(false)
    }
  }

  const canLaunch = !!trackA && !!trackB

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-white/30 mb-3">
          <span>Studio</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-purple-400">New Mashup</span>
        </div>
        <h1 className="text-2xl font-black text-white">Create New Mashup</h1>
        <p className="text-sm text-white/40 mt-1">Upload two tracks and let the AI do the rest.</p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-3 mb-8">
        {[
          { n: 1, label: 'Upload Tracks' },
          { n: 2, label: 'Configure' },
          { n: 3, label: 'Launch' },
        ].map(({ n, label }, i, arr) => (
          <div key={n} className="flex items-center gap-3">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${
              step >= n
                ? 'bg-purple-600 text-white'
                : 'bg-white/5 text-white/30'
            }`}>
              {n}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${step >= n ? 'text-white/70' : 'text-white/25'}`}>
              {label}
            </span>
            {i < arr.length - 1 && (
              <div className={`h-px w-8 transition-all ${step > n ? 'bg-purple-500' : 'bg-white/10'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="space-y-6">
        {/* ── STEP 1: Upload ───────────────────────────────── */}
        <motion.div layout className="space-y-4">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Step 1 — Upload Tracks</p>

          {projectId ? (
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
          ) : (
            <div
              className="glass rounded-2xl p-8 text-center border-2 border-dashed border-white/10 cursor-pointer hover:border-purple-500/40 transition-all"
              onClick={async () => {
                try {
                  await ensureProject()
                } catch {
                  toast.error('Failed to create project')
                }
              }}
            >
              <p className="text-sm font-semibold text-white/60">Click to start — create your project</p>
              <p className="text-xs text-white/25 mt-1">You can upload tracks after</p>
            </div>
          )}

          {!projectId && (
            <Button
              className="w-full"
              variant="secondary"
              onClick={async () => {
                try { await ensureProject() }
                catch { toast.error('Failed to create project') }
              }}
            >
              Initialize Project
            </Button>
          )}
        </motion.div>

        {/* ── STEP 2: Configure ────────────────────────────── */}
        {(step >= 2 || canLaunch) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Step 2 — Configure Style</p>

            <StylePresetSelector value={remixStyle} onChange={setRemixStyle} />

            {/* Remix Director — natural language vision */}
            <RemixDirectorInput value={remixPrompt} onChange={setRemixPrompt} />

            {/* Output quality */}
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
            className="glass rounded-2xl p-6 border border-purple-500/20"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/15">
                <Sparkles className="h-6 w-6 text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-white">Generate 3 free preview teasers</h3>
                <p className="text-sm text-white/40 mt-1">
                  The AI will analyze, separate stems, and render 3 ~30-second teaser
                  variants (A / B / C). Unlock the full HQ mashup after you hear them.
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400">
                  <Zap className="h-3.5 w-3.5" />
                  <span>Free preview — no credits used. Pay only to unlock the full track.</span>
                </div>
              </div>
            </div>

            <Button
              className="w-full mt-5"
              size="lg"
              loading={launching}
              onClick={handleLaunch}
              icon={<Sparkles className="h-4 w-4" />}
            >
              Generate Free Previews
            </Button>

            <p className="mt-3 flex items-center justify-center gap-1 text-xs text-white/20">
              <HelpCircle className="h-3 w-3" />
              Preview generation typically takes 1–3 minutes.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
