'use client'
import { useParams } from 'next/navigation'
import useSWR, { mutate } from 'swr'
import { useEffect, useState } from 'react'
import {
  Heart, MessageSquare, Sparkles, Image as ImageIcon,
  Play, RotateCw, SkipForward, Check, X,
  Footprints, Users, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { live, liveDedications, liveGames, livePhotos, type LiveRequestStatus } from '@/lib/api'
import { eventIdForSlug } from '@/lib/events/photoService'
import { resolveOwnerEvent } from '@/lib/events/ownerService'
import { AuthGate } from '@/lib/auth/AuthGate'
import { DjOnly } from '@/components/auth/RoleGuard'
import {
  RemoteShell, RemoteHeader, RemoteTab, RemoteCard, RemoteButton, RemoteStatus, RemoteEmpty, RemoteAccordion,
} from '@/components/remote/RemoteUI'
import { useI18n } from '@/lib/i18n'
import { useLiveEvent } from '@/lib/events/useLiveEvent'
import { useLatestGames, preferRealtime } from '@/lib/events/useGames'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

// ── DJ remote on Firebase: the DJ signs in on the phone, every action is an owner operation (same as the dashboard) ──
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
}

/** slug → event id, only when the signed-in account owns the event. */
async function ownedEventId(slug: string): Promise<string> {
  const id = await eventIdForSlug(slug)
  const ev = id ? await resolveOwnerEvent(id) : null
  if (!ev) throw new Error('Sessione non trovata')
  return ev.id
}

const remoteApi = {
  async getSessionBySlug(slug: string): Promise<PublicSessionData> {
    return { session: (await live.getSession(await ownedEventId(slug))) as unknown as PublicSessionData['session'] }
  },
  async listRequests(slug: string) {
    return live.listRequests(await ownedEventId(slug))
  },
  async updateRequest(_slug: string, requestId: string, status: LiveRequestStatus) {
    return live.updateRequest(requestId, status)
  },
  async listDedications(slug: string) {
    return liveDedications.listForDj(await ownedEventId(slug))
  },
  async updateDedication(_slug: string, dedicationId: string, status: 'approved' | 'rejected') {
    return liveDedications.setStatus(dedicationId, status)
  },
  async listPhotos(slug: string) {
    return livePhotos.listForDj(await ownedEventId(slug))
  },
  async updatePhoto(_slug: string, photoId: string, status: 'approved' | 'rejected') {
    return livePhotos.setStatus(photoId, status)
  },
  async startRoulette(slug: string, categories: string[]) {
    return liveGames.startRoulette(await ownedEventId(slug), categories)
  },
  async spinRoulette(slug: string) {
    return liveGames.spinRoulette(await ownedEventId(slug))
  },
  async resetRoulette(slug: string) {
    return liveGames.resetRoulette(await ownedEventId(slug))
  },
  async getShoeState(slug: string) {
    return liveGames.getShoeState(await ownedEventId(slug))
  },
  async startShoe(slug: string) {
    return liveGames.startShoe(await ownedEventId(slug))
  },
  async nextShoe(slug: string) {
    return liveGames.nextShoe(await ownedEventId(slug))
  },
  async resetShoe(slug: string) {
    return liveGames.resetShoe(await ownedEventId(slug))
  },
  async getStandUpGuess(slug: string) {
    return (await live.getSession(await ownedEventId(slug))).screen_config?.stand_up_guess ?? null
  },
  async updateStandUpGuess(slug: string, stand_up_guess: any) {
    const id = await ownedEventId(slug)
    const cur = (await live.getSession(id)).screen_config ?? {}
    await live.updateSession(id, { screen_config: { ...cur, stand_up_guess } })
    return stand_up_guess
  },
}

// DJ-only: a Sposi account is redirected to its home before any remote UI (or data) is rendered.
export default function RemoteControlPage() {
  return <AuthGate><DjOnly><RemoteControl /></DjOnly></AuthGate>
}

function RemoteControl() {
  const { slug } = useParams<{ slug: string }>()
  const { t } = useI18n()
  // The DJ remote is an IOMIXO tool: live entertainment only, no photo moderation (photos belong to MIOLOVE albums).
  const [tab, setTab] = useState<'games' | 'requests' | 'dedications'>('games')

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

  const pending = requests?.filter((r: any) => r.status === 'pending') ?? []

  if (error || !session) {
    return (
      <RemoteShell theme="party">
        <div className="flex min-h-[70vh] items-center justify-center">
          <RemoteCard className="max-w-md text-center">
            <p className="text-[16px] text-[#9A9AA3]">{error ? t('remote.notFound') : t('remote.loading')}</p>
          </RemoteCard>
        </div>
      </RemoteShell>
    )
  }

  const isPartySession = session.session_type !== 'wedding'

  return (
    <RemoteShell theme={isPartySession ? 'party' : 'wedding'}>
      <RemoteHeader
        title={session.event_name}
        subtitle={!isPartySession ? session.couple_names : null}
        live={session.is_active}
        liveLabel={session.is_active ? t('sessions.active') : t('sessions.closed')}
        remoteLabel={t('remote.djRemote')}
        languageSlot={<LanguageSwitcher large variant={isPartySession ? 'party' : 'wedding'} />}
      />

      {/* Tab navigation */}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-2">
        <RemoteTab active={tab === 'games'} onClick={() => setTab('games')} icon={<Sparkles className="h-4 w-4" />} label={t('remote.tabGames')} />
        <RemoteTab active={tab === 'requests'} onClick={() => setTab('requests')} icon={<MessageSquare className="h-4 w-4" />} label={t('remote.tabRequests')} badge={pending.length} />
        {!isPartySession && (
          <RemoteTab active={tab === 'dedications'} onClick={() => setTab('dedications')} icon={<Heart className="h-4 w-4" />} label={t('remote.tabDedications')} />
        )}
      </div>

      {/* Content panels */}
      <div className="space-y-4">
        {tab === 'games' && slug && <RemoteGamesPanel slug={slug} sessionType={session.session_type} />}
        {tab === 'requests' && slug && <RemoteRequestsPanel slug={slug} requests={requests ?? []} />}
        {!isPartySession && tab === 'dedications' && slug && <RemoteDedicationsPanel slug={slug} dedications={dedications ?? []} />}
      </div>
    </RemoteShell>
  )
}

function RemoteGamesPanel({ slug, sessionType }: { slug: string; sessionType: string }) {
  const { t } = useI18n()
  const [activeGame, setActiveGame] = useState<'roulette' | 'shoe' | 'standup' | null>(null)
  const toggle = (g: 'roulette' | 'shoe' | 'standup') => setActiveGame(activeGame === g ? null : g)

  return (
    <div className="space-y-3">
      <RemoteAccordion icon={<Sparkles className="h-5 w-5" />} title={t('remote.roulettePenalties')} open={activeGame === 'roulette'} onToggle={() => toggle('roulette')}>
        <RemoteRouletteControls slug={slug} />
      </RemoteAccordion>

      {sessionType === 'wedding' && (
        <RemoteAccordion icon={<Footprints className="h-5 w-5" />} title={t('remote.shoeGame')} open={activeGame === 'shoe'} onToggle={() => toggle('shoe')}>
          <RemoteShoeControls slug={slug} />
        </RemoteAccordion>
      )}

      {sessionType === 'wedding' && (
        <RemoteAccordion icon={<Users className="h-5 w-5" />} title={t('weddingPanels.standUpGuessName')} open={activeGame === 'standup'} onToggle={() => toggle('standup')}>
          <RemoteStandUpGuessControls slug={slug} />
        </RemoteAccordion>
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

  const status = String(cfg?.status ?? 'idle')
  const isOn = (s: string) => status === s

  return (
    <div className="space-y-3">
      <RemoteStatus label={t('weddingPanels.standUpGuessStatus')}>
        <p className="text-[15px] uppercase tracking-wide">{status}</p>
        {currentRound ? (
          <>
            <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.14em] opacity-70">{t('weddingPanels.standUpGuessGuestInstructionLabel')}</p>
            <p className="mt-1">{currentRound.guest_instruction}</p>
          </>
        ) : (
          <p className="mt-2 text-[15px] font-normal opacity-70">{t('weddingPanels.standUpGuessNoRounds')}</p>
        )}
      </RemoteStatus>

      <div className="grid grid-cols-2 gap-2">
        <RemoteButton onClick={() => save({ status: 'instruction' })} variant={isOn('instruction') ? 'primary' : 'secondary'} loading={busy}>
          {t('weddingPanels.standUpGuessShowInstruction')}
        </RemoteButton>
        <RemoteButton onClick={() => save({ status: 'guessing' })} variant={isOn('guessing') ? 'primary' : 'secondary'} loading={busy}>
          {t('weddingPanels.standUpGuessGoGuessing')}
        </RemoteButton>
        <RemoteButton onClick={() => save({ status: 'reveal' })} variant={isOn('reveal') ? 'primary' : 'secondary'} loading={busy}>
          {t('weddingPanels.standUpGuessRevealAnswer')}
        </RemoteButton>
        <RemoteButton onClick={() => save({ status: 'finished' })} variant={isOn('finished') ? 'primary' : 'secondary'} loading={busy}>
          {t('weddingPanels.standUpGuessFinished')}
        </RemoteButton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RemoteButton
          onClick={() => save({ score: { guessed: Number(cfg?.score?.guessed ?? 0) + 1, missed: Number(cfg?.score?.missed ?? 0) } })}
          variant="secondary"
          loading={busy}
          icon={<Check className="h-5 w-5" />}
        >
          {t('weddingPanels.standUpGuessCorrect')}
        </RemoteButton>
        <RemoteButton
          onClick={() => save({ score: { guessed: Number(cfg?.score?.guessed ?? 0), missed: Number(cfg?.score?.missed ?? 0) + 1 } })}
          variant="secondary"
          loading={busy}
          icon={<X className="h-5 w-5" />}
        >
          {t('weddingPanels.standUpGuessWrong')}
        </RemoteButton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RemoteButton onClick={() => moveRound(-1)} variant="secondary" loading={busy}>
          {t('weddingPanels.standUpGuessPrevRound')}
        </RemoteButton>
        <RemoteButton onClick={() => moveRound(1)} variant="secondary" loading={busy}>
          {t('weddingPanels.standUpGuessNextRound')}
        </RemoteButton>
      </div>

      <RemoteButton
        onClick={() => save({ status: 'idle', current_index: 0, current_round_id: rounds[0]?.id ?? null, score: { guessed: 0, missed: 0 } }, t('weddingPanels.standUpGuessResetDone'))}
        variant="ghost"
        icon={<RotateCw className="h-5 w-5" />}
        className="w-full"
        loading={busy}
      >
        {t('weddingPanels.standUpGuessReset')}
      </RemoteButton>
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
      {result && <RemoteStatus label={t('remote.penalty')}>{result}</RemoteStatus>}
      <div className="flex gap-2">
        <RemoteButton onClick={start} variant="primary" loading={running} icon={<Play className="h-5 w-5" />} className="flex-1">
          {t('remote.spin')}
        </RemoteButton>
        <RemoteButton onClick={reset} variant="secondary" icon={<RotateCw className="h-5 w-5" />}>
          {t('remote.reset')}
        </RemoteButton>
      </div>
    </div>
  )
}

function RemoteShoeControls({ slug }: { slug: string }) {
  const { t } = useI18n()
  // Realtime shoe-game round (Firestore) once projected; otherwise the legacy polling.
  const rtRound = useLatestGames(useLiveEvent(slug)?.id)?.shoeGame ?? null
  const { data: legacyRound, mutate: refresh } = useSWR(
    ['remote-shoe-game', slug],
    () => remoteApi.getShoeState(slug),
    { refreshInterval: rtRound ? 0 : 4_000 },
  )
  const round = preferRealtime(rtRound, legacyRound)
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
        <RemoteStatus label={`${t('remote.question')} ${currentIndex + 1}/${questions.length}`}>{questions[currentIndex]}</RemoteStatus>
      )}
      <div className="flex gap-2">
        <RemoteButton onClick={start} variant={isActive ? 'secondary' : 'primary'} loading={busy} icon={<Play className="h-5 w-5" />} className="flex-1">
          {isActive ? t('remote.restart') : t('remote.start')}
        </RemoteButton>
        <RemoteButton
          onClick={next}
          variant="primary"
          loading={busy}
          disabled={!isActive || currentIndex >= questions.length - 1}
          icon={<SkipForward className="h-5 w-5" />}
          className="flex-1"
        >
          {t('remote.next')}
        </RemoteButton>
      </div>
      <RemoteButton onClick={reset} variant="ghost" icon={<RotateCw className="h-5 w-5" />} className="w-full">
        {t('remote.reset')}
      </RemoteButton>
    </div>
  )
}

/** Approve / reject pair: labelled, 52px touch targets. */
function ModerationButtons({ busy, onApprove, onReject }: { busy: boolean; onApprove: () => void; onReject: () => void }) {
  const { t } = useI18n()
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <RemoteButton variant="primary" onClick={onApprove} disabled={busy} icon={<Check className="h-5 w-5" />}>{t('common.approve')}</RemoteButton>
      <RemoteButton variant="secondary" onClick={onReject} disabled={busy} icon={<X className="h-5 w-5" />}>{t('common.reject')}</RemoteButton>
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

  if (pending.length === 0) return <RemoteEmpty>{t('remote.noRequests')}</RemoteEmpty>

  return (
    <div className="space-y-3">
      {pending.map((req) => (
        <RemoteCard key={req.id}>
          <div className="flex items-start gap-3">
            <MessageSquare className="mt-1 h-5 w-5 shrink-0 opacity-70" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-[17px] font-semibold leading-snug">{req.track_title ?? req.song_title}</p>
              {(req.artist ?? req.artist_name) && <p className="text-[15px] opacity-70">{req.artist ?? req.artist_name}</p>}
              {req.message && <p className="mt-1 break-words text-[14px] opacity-70">“{req.message}”</p>}
              {req.guest_name && <p className="mt-1 text-[14px] opacity-70">— {req.guest_name}</p>}
            </div>
          </div>
          <ModerationButtons busy={busy === req.id} onApprove={() => updateRequest(req.id, 'approved')} onReject={() => updateRequest(req.id, 'rejected')} />
        </RemoteCard>
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

  if (pending.length === 0) return <RemoteEmpty>{t('remote.noDedications')}</RemoteEmpty>

  return (
    <div className="space-y-3">
      {pending.map((ded) => (
        <RemoteCard key={ded.id}>
          <div className="flex items-start gap-3">
            <Heart className="mt-1 h-5 w-5 shrink-0 opacity-70" />
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line break-words text-[17px] leading-snug">"{ded.message}"</p>
              <p className="mt-2 text-[14px] opacity-70">— {ded.guest_name ?? t('common.anonymous')}</p>
            </div>
          </div>
          <ModerationButtons busy={busy === ded.id} onApprove={() => setStatus(ded.id, 'approved')} onReject={() => setStatus(ded.id, 'rejected')} />
        </RemoteCard>
      ))}
    </div>
  )
}

function RemotePhotosPanel({ slug, photos, isWedding }: { slug: string; photos: any[]; isWedding: boolean }) {
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

  const removePhoto = async (id: string) => {
    if (!confirm(t('wdAdmin.photos.confirmDelete'))) return
    setBusy(id)
    try {
      await livePhotos.remove(id)
      mutate(['remote-photos', slug])
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(null)
    }
  }

  // Wedding: no moderation, the latest guest photos with a delete shortcut.
  if (isWedding) {
    const latest = photos.filter((p) => p.url).slice(0, 12)
    if (latest.length === 0) return <RemoteEmpty>{t('remote.noPhotosWedding')}</RemoteEmpty>
    return (
      <div className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3">
        {latest.map((photo) => (
          <RemoteCard key={photo.id} className="relative overflow-hidden p-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={photo.caption ?? ''} loading="lazy" className="aspect-square w-full object-cover" />
            <button
              type="button"
              onClick={() => removePhoto(photo.id)}
              disabled={busy === photo.id}
              aria-label={t('remote.deletePhoto')}
              title={t('remote.deletePhoto')}
              className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-red-600 shadow disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </RemoteCard>
        ))}
      </div>
    )
  }

  const pending = photos.filter((p) => p.status === 'pending')

  if (pending.length === 0) return <RemoteEmpty>{t('remote.noPhotos')}</RemoteEmpty>

  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
      {pending.map((photo) => (
        <RemoteCard key={photo.id} className="overflow-hidden p-0">
          {photo.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt={photo.caption ?? ''} className="aspect-square w-full object-cover" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center opacity-50">
              <ImageIcon className="h-8 w-8" />
            </div>
          )}
          <div className="p-3">
            {photo.caption && <p className="line-clamp-2 text-[14px] opacity-80">{photo.caption}</p>}
            <ModerationButtons busy={busy === photo.id} onApprove={() => setStatus(photo.id, 'approved')} onReject={() => setStatus(photo.id, 'rejected')} />
          </div>
        </RemoteCard>
      ))}
    </div>
  )
}
