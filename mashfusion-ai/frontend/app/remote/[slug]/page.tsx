'use client'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { useState } from 'react'
import {
  Heart, MessageSquare, Sparkles, Image as ImageIcon,
  Play, RotateCw, SkipForward, Check, X, Trash2, ListChecks,
  Footprints, Wifi, Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { LiveRequestStatus } from '@/lib/api'
import {
  WeddingShell, WeddingCard, WeddingButton, WeddingBadge,
} from '@/components/wedding/WeddingUI'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

// ── Public API client (no auth) ────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

interface PublicSessionData {
  session: {
    id: string
    event_name: string
    dj_name: string | null
    couple_names: string | null
    wedding_date: string | null
    venue_name: string | null
    is_active: boolean
    session_type: string
  }
  profile: any
  events: any[]
  plan: string
  features: any
}

async function publicFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  const json = await res.json()
  return json.data
}

const remoteApi = {
  async getSessionBySlug(slug: string): Promise<PublicSessionData> {
    return publicFetch<PublicSessionData>(`/api/live/public/${slug}`)
  },
  async listRequests(slug: string) {
    return publicFetch<any[]>(`/api/live/public/${slug}/requests`)
  },
  async updateRequest(slug: string, requestId: string, status: LiveRequestStatus) {
    return publicFetch<any>(`/api/live/public/${slug}/requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },
  async listDedications(slug: string) {
    return publicFetch<any[]>(`/api/live/public/${slug}/dedications`)
  },
  async updateDedication(slug: string, dedicationId: string, status: 'approved' | 'rejected') {
    return publicFetch<any>(`/api/live/public/${slug}/dedications/${dedicationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },
  async listPhotos(slug: string) {
    return publicFetch<any[]>(`/api/live/public/${slug}/photos`)
  },
  async updatePhoto(slug: string, photoId: string, status: 'approved' | 'rejected') {
    return publicFetch<any>(`/api/live/public/${slug}/photos/${photoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },
  async startRoulette(slug: string, categories: string[]) {
    return publicFetch<any>(`/api/live/public/${slug}/games/roulette/start`, {
      method: 'POST',
      body: JSON.stringify({ categories }),
    })
  },
  async spinRoulette(slug: string) {
    return publicFetch<any>(`/api/live/public/${slug}/games/roulette/spin`, { method: 'POST' })
  },
  async resetRoulette(slug: string) {
    return publicFetch<any>(`/api/live/public/${slug}/games/roulette/reset`, { method: 'POST' })
  },
  async getShoeState(slug: string) {
    return publicFetch<any>(`/api/live/public/${slug}/games/shoe`)
  },
  async startShoe(slug: string) {
    return publicFetch<any>(`/api/live/public/${slug}/games/shoe/start`, { method: 'POST' })
  },
  async nextShoe(slug: string) {
    return publicFetch<any>(`/api/live/public/${slug}/games/shoe/next`, { method: 'POST' })
  },
  async resetShoe(slug: string) {
    return publicFetch<any>(`/api/live/public/${slug}/games/shoe/reset`, { method: 'POST' })
  },
  async getStandUpGuess(slug: string) {
    return publicFetch<any | null>(`/api/live/public/${slug}/games/stand-up-guess`)
  },
  async updateStandUpGuess(slug: string, stand_up_guess: any) {
    return publicFetch<any | null>(`/api/live/public/${slug}/games/stand-up-guess`, {
      method: 'PATCH',
      body: JSON.stringify({ stand_up_guess }),
    })
  },
}

export default function RemoteControlPage() {
  const { slug } = useParams<{ slug: string }>()
  const { t } = useI18n()
  const [tab, setTab] = useState<'games' | 'requests' | 'dedications' | 'photos'>('games')

  // Ottieni la sessione tramite slug pubblico
  const { data: sessionData, error } = useSWR(
    slug ? ['remote-session', slug] : null,
    () => remoteApi.getSessionBySlug(slug!),
    { refreshInterval: 10_000 },
  )

  const session = sessionData?.session

  const { data: requests } = useSWR(
    slug ? ['remote-requests', slug] : null,
    () => remoteApi.listRequests(slug!),
    { refreshInterval: 5_000 },
  )

  const { data: dedications } = useSWR(
    slug ? ['remote-dedications', slug] : null,
    () => remoteApi.listDedications(slug!),
    { refreshInterval: 5_000 },
  )

  const { data: photos } = useSWR(
    slug ? ['remote-photos', slug] : null,
    () => remoteApi.listPhotos(slug!),
    { refreshInterval: 5_000 },
  )

  const pending = requests?.filter((r: any) => r.status === 'pending') ?? []

  if (error || !session) {
    return (
      <WeddingShell>
        <div className="flex items-center justify-center min-h-screen p-6">
          <WeddingCard className="text-center max-w-md">
            <p className="text-wedding-ink/70 mb-4">
              {error ? t('remote.notFound') : t('remote.loading')}
            </p>
          </WeddingCard>
        </div>
      </WeddingShell>
    )
  }

  return (
    <WeddingShell className="pb-20">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex justify-center mb-4">
          <LanguageSwitcher variant="light" />
        </div>
        {/* Header compatto */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-wedding-gold/10 border border-wedding-gold/30 mb-3">
            <Wifi className="h-4 w-4 text-wedding-gold animate-pulse" />
            <span className="text-xs uppercase tracking-wider text-wedding-gold font-semibold">
              {t('remote.djRemote')}
            </span>
          </div>
          <h1 className="font-wedding text-2xl text-wedding-ink mb-1">{session.event_name}</h1>
          {session.couple_names && (
            <p className="font-wedding text-base italic text-wedding-muted">{session.couple_names}</p>
          )}
        </div>

        {/* Tab navigation */}
        <div className="mb-4 flex overflow-x-auto gap-2 pb-2">
          <TabButton
            active={tab === 'games'}
            onClick={() => setTab('games')}
            icon={<Sparkles className="h-4 w-4" />}
            label={t('remote.tabGames')}
          />
          <TabButton
            active={tab === 'requests'}
            onClick={() => setTab('requests')}
            icon={<MessageSquare className="h-4 w-4" />}
            label={`${t('remote.tabRequests')} ${pending.length > 0 ? `(${pending.length})` : ''}`}
          />
          <TabButton
            active={tab === 'dedications'}
            onClick={() => setTab('dedications')}
            icon={<Heart className="h-4 w-4" />}
            label={t('remote.tabDedications')}
          />
          <TabButton
            active={tab === 'photos'}
            onClick={() => setTab('photos')}
            icon={<ImageIcon className="h-4 w-4" />}
            label={t('remote.tabPhotos')}
          />
        </div>

        {/* Content panels */}
        <div className="space-y-4">
          {tab === 'games' && slug && <RemoteGamesPanel slug={slug} sessionType={session.session_type} />}
          {tab === 'requests' && slug && <RemoteRequestsPanel slug={slug} requests={requests ?? []} />}
          {tab === 'dedications' && slug && <RemoteDedicationsPanel slug={slug} dedications={dedications ?? []} />}
          {tab === 'photos' && slug && <RemotePhotosPanel slug={slug} photos={photos ?? []} />}
        </div>
      </div>
    </WeddingShell>
  )
}

function TabButton({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition whitespace-nowrap ${
        active
          ? 'bg-wedding-gold text-white shadow-wedding'
          : 'bg-white border border-wedding-champagne text-wedding-ink hover:bg-wedding-blush/20'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function RemoteGamesPanel({ slug, sessionType }: { slug: string; sessionType: string }) {
  const { t } = useI18n()
  const [activeGame, setActiveGame] = useState<'roulette' | 'shoe' | 'standup' | null>(null)

  return (
    <div className="space-y-3">
      <WeddingCard>
        <button
          onClick={() => setActiveGame(activeGame === 'roulette' ? null : 'roulette')}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-wedding-gold" />
            <span className="font-wedding text-xl text-wedding-ink">{t('remote.roulettePenalties')}</span>
          </div>
          <span className="text-wedding-gold">
            {activeGame === 'roulette' ? '−' : '+'}
          </span>
        </button>
        {activeGame === 'roulette' && (
          <div className="mt-4 pt-4 border-t border-wedding-champagne">
            <RemoteRouletteControls slug={slug} />
          </div>
        )}
      </WeddingCard>

      <WeddingCard>
        <button
          onClick={() => setActiveGame(activeGame === 'shoe' ? null : 'shoe')}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Footprints className="h-5 w-5 text-wedding-gold" />
            <span className="font-wedding text-xl text-wedding-ink">{t('remote.shoeGame')}</span>
          </div>
          <span className="text-wedding-gold">
            {activeGame === 'shoe' ? '−' : '+'}
          </span>
        </button>
        {activeGame === 'shoe' && (
          <div className="mt-4 pt-4 border-t border-wedding-champagne">
            <RemoteShoeControls slug={slug} />
          </div>
        )}
      </WeddingCard>

      {sessionType === 'wedding' && (
        <WeddingCard>
          <button
            onClick={() => setActiveGame(activeGame === 'standup' ? null : 'standup')}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-wedding-gold" />
              <span className="font-wedding text-xl text-wedding-ink">{t('weddingPanels.standUpGuessName')}</span>
            </div>
            <span className="text-wedding-gold">
              {activeGame === 'standup' ? '−' : '+'}
            </span>
          </button>
          {activeGame === 'standup' && (
            <div className="mt-4 pt-4 border-t border-wedding-champagne">
              <RemoteStandUpGuessControls slug={slug} />
            </div>
          )}
        </WeddingCard>
      )}
    </div>
  )
}

function RemoteStandUpGuessControls({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data: cfg, mutate: refresh } = useSWR(
    ['remote-standup', slug],
    () => remoteApi.getStandUpGuess(slug),
    { refreshInterval: 3_000 },
  )
  const [busy, setBusy] = useState(false)

  const rounds = Array.isArray(cfg?.rounds) ? cfg.rounds : []
  const currentIndex = Number(cfg?.current_index ?? 0)
  const currentRound = rounds.find((r: any) => r?.id === cfg?.current_round_id) ?? rounds[currentIndex] ?? rounds[0] ?? null

  const save = async (next: any, okMsg?: string) => {
    setBusy(true)
    try {
      await remoteApi.updateStandUpGuess(slug, {
        ...(cfg ?? {}),
        ...next,
        updated_at: new Date().toISOString(),
      })
      await refresh()
      if (okMsg) toast.success(okMsg)
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const moveRound = async (dir: -1 | 1) => {
    if (!rounds.length) return
    let idx = currentIndex + dir
    while (idx >= 0 && idx < rounds.length && rounds[idx]?.enabled === false) idx += dir
    if (idx < 0 || idx >= rounds.length) return
    await save({
      status: 'instruction',
      current_index: idx,
      current_round_id: rounds[idx]?.id ?? null,
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-wedding-gold/10 border border-wedding-gold/30 p-4 text-center">
        <p className="text-xs uppercase tracking-wider text-wedding-gold mb-1">{t('weddingPanels.standUpGuessStatus')}</p>
        <p className="text-sm text-wedding-ink mb-2">{String(cfg?.status ?? 'idle')}</p>
        {currentRound ? (
          <>
            <p className="text-xs uppercase tracking-wider text-wedding-gold mb-1">{t('weddingPanels.standUpGuessGuestInstructionLabel')}</p>
            <p className="font-wedding text-lg text-wedding-ink">{currentRound.guest_instruction}</p>
          </>
        ) : (
          <p className="text-sm text-wedding-muted">{t('weddingPanels.standUpGuessNoRounds')}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <WeddingButton onClick={() => save({ status: 'instruction' })} variant="outline" loading={busy}>
          {t('weddingPanels.standUpGuessShowInstruction')}
        </WeddingButton>
        <WeddingButton onClick={() => save({ status: 'guessing' })} variant="outline" loading={busy}>
          {t('weddingPanels.standUpGuessGoGuessing')}
        </WeddingButton>
        <WeddingButton onClick={() => save({ status: 'reveal' })} variant="gold" loading={busy}>
          {t('weddingPanels.standUpGuessRevealAnswer')}
        </WeddingButton>
        <WeddingButton onClick={() => save({ status: 'finished' })} variant="ghost" loading={busy}>
          {t('weddingPanels.standUpGuessFinished')}
        </WeddingButton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <WeddingButton
          onClick={() => save({ score: { guessed: Number(cfg?.score?.guessed ?? 0) + 1, missed: Number(cfg?.score?.missed ?? 0) } })}
          variant="outline"
          loading={busy}
          icon={<Check className="h-4 w-4" />}
        >
          {t('weddingPanels.standUpGuessCorrect')}
        </WeddingButton>
        <WeddingButton
          onClick={() => save({ score: { guessed: Number(cfg?.score?.guessed ?? 0), missed: Number(cfg?.score?.missed ?? 0) + 1 } })}
          variant="ghost"
          loading={busy}
          icon={<X className="h-4 w-4" />}
        >
          {t('weddingPanels.standUpGuessWrong')}
        </WeddingButton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <WeddingButton onClick={() => moveRound(-1)} variant="outline" loading={busy}>
          {t('weddingPanels.standUpGuessPrevRound')}
        </WeddingButton>
        <WeddingButton onClick={() => moveRound(1)} variant="outline" loading={busy}>
          {t('weddingPanels.standUpGuessNextRound')}
        </WeddingButton>
      </div>

      <WeddingButton
        onClick={() => save({ status: 'idle', current_index: 0, current_round_id: rounds[0]?.id ?? null, score: { guessed: 0, missed: 0 } }, t('weddingPanels.standUpGuessResetDone'))}
        variant="ghost"
        icon={<RotateCw className="h-4 w-4" />}
        className="w-full"
        loading={busy}
      >
        {t('weddingPanels.standUpGuessReset')}
      </WeddingButton>
    </div>
  )
}

function RemoteRouletteControls({ slug }: { slug: string }) {
  const { t } = useI18n()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [categories] = useState<string[]>(['soft', 'party'])

  const start = async () => {
    setRunning(true)
    setResult(null)
    try {
      await remoteApi.startRoulette(slug, categories)
      const r: any = await remoteApi.spinRoulette(slug)
      toast.success(t('remote.rouletteStarted'))
      setTimeout(() => {
        if (r?.result?.slot_label) setResult(r.result.slot_label)
      }, 17000)
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setRunning(false)
    }
  }

  const reset = async () => {
    try {
      await remoteApi.resetRoulette(slug)
      setResult(null)
      toast.success(t('remote.resetDone'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    }
  }

  return (
    <div className="space-y-3">
      {result && (
        <div className="rounded-xl bg-wedding-gold/10 border border-wedding-gold/30 p-4 text-center">
          <p className="text-xs uppercase tracking-wider text-wedding-gold mb-1">{t('remote.penalty')}</p>
          <p className="font-wedding text-2xl text-wedding-ink">{result}</p>
        </div>
      )}
      <div className="flex gap-2">
        <WeddingButton
          onClick={start}
          variant="gold"
          loading={running}
          icon={<Play className="h-4 w-4" />}
          className="flex-1"
        >
          {t('remote.spin')}
        </WeddingButton>
        <WeddingButton onClick={reset} variant="outline" icon={<RotateCw className="h-4 w-4" />}>
          {t('remote.reset')}
        </WeddingButton>
      </div>
    </div>
  )
}

function RemoteShoeControls({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data: round, mutate: refresh } = useSWR(
    ['remote-shoe-game', slug],
    () => remoteApi.getShoeState(slug),
    { refreshInterval: 4_000 },
  )
  const [busy, setBusy] = useState(false)

  const questions = round?.config?.questions ?? []
  const currentIndex = round?.config?.current_index ?? 0
  const isActive = round?.status === 'running' && round?.config?.is_active

  const start = async () => {
    setBusy(true)
    try {
      await remoteApi.startShoe(slug)
      toast.success(t('remote.gameStarted'))
      refresh()
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const next = async () => {
    setBusy(true)
    try {
      await remoteApi.nextShoe(slug)
      refresh()
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await remoteApi.resetShoe(slug)
      refresh()
      toast.success(t('remote.resetDone'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {isActive && questions.length > 0 && (
        <div className="rounded-xl bg-wedding-gold/10 border border-wedding-gold/30 p-4 text-center">
          <p className="text-xs uppercase tracking-wider text-wedding-gold mb-1">
            {t('remote.question')} {currentIndex + 1}/{questions.length}
          </p>
          <p className="font-wedding text-xl text-wedding-ink">{questions[currentIndex]}</p>
        </div>
      )}
      <div className="flex gap-2">
        <WeddingButton
          onClick={start}
          variant="outline"
          loading={busy}
          icon={<Play className="h-4 w-4" />}
          className="flex-1"
        >
          {isActive ? t('remote.restart') : t('remote.start')}
        </WeddingButton>
        <WeddingButton
          onClick={next}
          variant="gold"
          loading={busy}
          disabled={!isActive || currentIndex >= questions.length - 1}
          icon={<SkipForward className="h-4 w-4" />}
          className="flex-1"
        >
          {t('remote.next')}
        </WeddingButton>
      </div>
      <WeddingButton onClick={reset} variant="ghost" icon={<RotateCw className="h-4 w-4" />} className="w-full">
        {t('remote.reset')}
      </WeddingButton>
    </div>
  )
}

function RemoteRequestsPanel({ slug, requests }: { slug: string; requests: any[] }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)

  const updateRequest = async (id: string, status: LiveRequestStatus) => {
    setBusy(id)
    try {
      await remoteApi.updateRequest(slug, id, status)
      toast.success(t('remote.updated'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(null)
    }
  }

  const pending = requests.filter((r) => r.status === 'pending')

  if (pending.length === 0) {
    return (
      <WeddingCard className="text-center py-8">
        <p className="text-wedding-muted">{t('remote.noRequests')}</p>
      </WeddingCard>
    )
  }

  return (
    <div className="space-y-2">
      {pending.map((req) => (
        <WeddingCard key={req.id} tone="ivory">
          <div className="flex items-start gap-3">
            <MessageSquare className="h-4 w-4 text-wedding-gold mt-1 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-wedding-ink">{req.song_title}</p>
              {req.artist_name && (
                <p className="text-xs text-wedding-muted">{req.artist_name}</p>
              )}
              {req.guest_name && (
                <p className="text-xs text-wedding-gold mt-1">— {req.guest_name}</p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => updateRequest(req.id, 'approved')}
                disabled={busy === req.id}
                className="p-2 rounded-full bg-wedding-sage/30 text-[#5f6f59] hover:bg-wedding-sage/50 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => updateRequest(req.id, 'rejected')}
                disabled={busy === req.id}
                className="p-2 rounded-full bg-wedding-taupe/20 text-wedding-ink/70 hover:bg-wedding-taupe/40 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </WeddingCard>
      ))}
    </div>
  )
}

function RemoteDedicationsPanel({ slug, dedications }: { slug: string; dedications: any[] }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)

  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    setBusy(id)
    try {
      await remoteApi.updateDedication(slug, id, status)
      toast.success(t('remote.updated'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(null)
    }
  }

  const pending = dedications.filter((d) => d.status === 'pending')

  if (pending.length === 0) {
    return (
      <WeddingCard className="text-center py-8">
        <p className="text-wedding-muted">{t('remote.noDedications')}</p>
      </WeddingCard>
    )
  }

  return (
    <div className="space-y-2">
      {pending.map((ded) => (
        <WeddingCard key={ded.id} tone="ivory">
          <div className="flex items-start gap-3">
            <Heart className="h-4 w-4 text-wedding-gold mt-1 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-wedding text-base italic text-wedding-ink leading-snug">"{ded.message}"</p>
              <p className="text-xs text-wedding-gold mt-2">— {ded.guest_name ?? t('common.anonymous')}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => setStatus(ded.id, 'approved')}
                disabled={busy === ded.id}
                className="p-2 rounded-full bg-wedding-sage/30 text-[#5f6f59] hover:bg-wedding-sage/50 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => setStatus(ded.id, 'rejected')}
                disabled={busy === ded.id}
                className="p-2 rounded-full bg-wedding-taupe/20 text-wedding-ink/70 hover:bg-wedding-taupe/40 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </WeddingCard>
      ))}
    </div>
  )
}

function RemotePhotosPanel({ slug, photos }: { slug: string; photos: any[] }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)

  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    setBusy(id)
    try {
      await remoteApi.updatePhoto(slug, id, status)
      toast.success(t('remote.updated'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(null)
    }
  }

  const pending = photos.filter((p) => p.status === 'pending')

  if (pending.length === 0) {
    return (
      <WeddingCard className="text-center py-8">
        <p className="text-wedding-muted">{t('remote.noPhotos')}</p>
      </WeddingCard>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {pending.map((photo) => (
        <WeddingCard key={photo.id} className="p-0 overflow-hidden">
          {photo.url ? (
            <img src={photo.url} alt={photo.caption ?? ''} className="w-full aspect-square object-cover" />
          ) : (
            <div className="w-full aspect-square bg-wedding-champagne/20 flex items-center justify-center">
              <ImageIcon className="h-8 w-8 text-wedding-muted" />
            </div>
          )}
          <div className="p-3">
            {photo.caption && (
              <p className="text-xs text-wedding-ink line-clamp-2 mb-2">{photo.caption}</p>
            )}
            <div className="flex gap-1">
              <button
                onClick={() => setStatus(photo.id, 'approved')}
                disabled={busy === photo.id}
                className="flex-1 p-2 rounded-lg bg-wedding-sage/30 text-[#5f6f59] hover:bg-wedding-sage/50 disabled:opacity-50"
              >
                <Check className="h-4 w-4 mx-auto" />
              </button>
              <button
                onClick={() => setStatus(photo.id, 'rejected')}
                disabled={busy === photo.id}
                className="flex-1 p-2 rounded-lg bg-wedding-taupe/20 text-wedding-ink/70 hover:bg-wedding-taupe/40 disabled:opacity-50"
              >
                <X className="h-4 w-4 mx-auto" />
              </button>
            </div>
          </div>
        </WeddingCard>
      ))}
    </div>
  )
}
