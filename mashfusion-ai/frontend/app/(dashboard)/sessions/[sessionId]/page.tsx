'use client'
import { useParams, useRouter } from 'next/navigation'
import useSWR, { mutate } from 'swr'
import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft, Trash2, Power, Heart, MessageSquare,
  Sparkles, Image as ImageIcon, ListChecks, Play, RotateCw, Tv,
  Check, X, Plus, Copy, Download, MapPin, CalendarDays, Footprints, SkipForward, Users, Camera, Star, Music2, Youtube,
  Pause, Volume2, VolumeX, Square,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import {
  live, liveDedications, liveGames, livePolls, livePhotos,
  type LiveRequestStatus, type LivePoll,
  type StandUpGuessConfig,
  type StandUpGuessRound,
  type StandUpGuessStatus,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { QRCard } from '@/components/live/QRCard'
import { RequestItem } from '@/components/live/RequestItem'
import { useRequestsSignal } from '@/lib/events/useRequests'
import { useDedicationsSignal } from '@/lib/events/useDedications'
import { usePollsSignal } from '@/lib/events/usePolls'
import { useGamesSignal } from '@/lib/events/useGames'
import { UpgradeGate } from '@/components/live/UpgradeGate'
import { SessionLockScreen } from '@/components/live/SessionLockScreen'
import {
  WeddingCard, WeddingButton, WeddingBadge, WeddingInput, WeddingTextarea, WeddingDivider,
} from '@/components/wedding/WeddingUI'
import { WeddingAdminShell, type WeddingNavKey } from '@/components/wedding/admin/WeddingAdminShell'
import { WeddingHomePage } from '@/components/wedding/admin/WeddingHomePage'
import { publicOriginFor, djToolsOrigin } from '@/lib/portalLinks'
import { WeddingPhotosPage } from '@/components/wedding/admin/WeddingPhotosPage'
import { WeddingPosterPage } from '@/components/wedding/admin/WeddingPosterPage'
import {
  WdPage, WdCard, WdSectionCard, WdSection, WdButton, WdLinkButton, wdStatusLabel, WdToggleRow, WdDivided, WdPills, WdInput, WdSelect, WdField,
} from '@/components/wedding/admin/WeddingAdminUI'
import { WinnerAnnouncementPanel } from '@/components/wedding/WinnerAnnouncementPanel'
import {
  PartyShell, PartyCard, PartyButton, PartyBadge, PartyLivePill, PartyInput, PartyTextarea,
  PartyDivider, PartyEyebrow, PartyPaywall, PARTY,
} from '@/components/party/PartyUI'
import { useI18n } from '@/lib/i18n'
import { useEffectiveAccess, isPremiumSession } from '@/lib/access'
import { useAccountRole, isCoupleWeddingTab, COUPLE_HOME } from '@/lib/roles'
import { resolveVideoSource, formatRelativeTime } from '@/lib/utils'
import type { VideoLiveCommand } from '@/lib/api'

const newCommandId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID?.()) ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

const STAND_UP_GUESS_PRESETS: Array<{ guest_instruction: string; answer: string; hint?: string }> = [
  {
    guest_instruction: 'Si alzino tutti quelli che conoscono gli sposi da piu di 10 anni',
    answer: 'Conoscono gli sposi da piu di 10 anni',
  },
  {
    guest_instruction: 'Si alzino tutti gli amici dello sposo',
    answer: 'Sono amici dello sposo',
  },
  {
    guest_instruction: 'Si alzino tutti gli amici della sposa',
    answer: 'Sono amici della sposa',
  },
  {
    guest_instruction: 'Si alzino tutti quelli che sono venuti da fuori citta',
    answer: 'Sono venuti da fuori citta',
  },
  {
    guest_instruction: 'Si alzino tutti quelli che sono venuti in treno',
    answer: 'Sono venuti in treno',
  },
  {
    guest_instruction: 'Si alzino tutti quelli che hanno ballato almeno una volta con gli sposi',
    answer: 'Hanno ballato almeno una volta con gli sposi',
  },
]

const makeStandUpRoundId = () =>
  `sug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function defaultStandUpGuessConfig(): StandUpGuessConfig {
  const rounds: StandUpGuessRound[] = STAND_UP_GUESS_PRESETS.map((r, index) => ({
    id: makeStandUpRoundId(),
    guest_instruction: r.guest_instruction,
    answer: r.answer,
    hint: r.hint,
    enabled: true,
    order: index,
  }))
  return {
    enabled: false,
    status: 'idle',
    current_round_id: rounds[0]?.id ?? null,
    current_index: 0,
    rounds,
    score: { guessed: 0, missed: 0 },
    updated_at: new Date().toISOString(),
  }
}

function normalizeStandUpGuessConfig(raw: any): StandUpGuessConfig {
  const fallback = defaultStandUpGuessConfig()
  if (!raw || typeof raw !== 'object') return fallback

  const mappedRounds: StandUpGuessRound[] = Array.isArray(raw.rounds)
    ? raw.rounds
      .map((round: any, index: number) => {
        if (!round || typeof round !== 'object') return null
        return {
          id: typeof round.id === 'string' && round.id.trim() ? round.id : makeStandUpRoundId(),
          guest_instruction: String(round.guest_instruction ?? '').trim(),
          answer: String(round.answer ?? '').trim(),
          hint: round.hint == null ? undefined : String(round.hint),
          enabled: round.enabled !== false,
          order: typeof round.order === 'number' ? round.order : index,
        } satisfies StandUpGuessRound
      })
      .filter((round: StandUpGuessRound | null): round is StandUpGuessRound => !!round)
      .sort((a: StandUpGuessRound, b: StandUpGuessRound) => a.order - b.order)
      .map((round: StandUpGuessRound, index: number) => ({ ...round, order: index }))
      .filter((round: StandUpGuessRound) => round.guest_instruction.length > 0 && round.answer.length > 0)
    : []

  const rounds = mappedRounds.length > 0 ? mappedRounds : fallback.rounds
  const safeIndex = Math.min(Math.max(Number(raw.current_index ?? 0), 0), Math.max(rounds.length - 1, 0))
  const roundById = rounds.find((round) => round.id === raw.current_round_id)
  const statusValues: StandUpGuessStatus[] = ['idle', 'instruction', 'guessing', 'reveal', 'finished']
  const status: StandUpGuessStatus = statusValues.includes(raw.status) ? raw.status : 'idle'

  return {
    enabled: raw.enabled === true,
    status,
    current_round_id: roundById?.id ?? rounds[safeIndex]?.id ?? null,
    current_index: safeIndex,
    rounds,
    score: {
      guessed: Math.max(0, Number(raw.score?.guessed ?? 0) || 0),
      missed: Math.max(0, Number(raw.score?.missed ?? 0) || 0),
    },
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : fallback.updated_at,
  }
}

// ─────────────── VIDEO LIVE — REGIA (dashboard → Screen Mode) ───────────────
// Remote control for the public Screen Mode video. Each transport action writes
// a fresh command_id into screen_config.video_live so the live player executes
// it once; volume is applied reactively (no new command_id). Self-gating: shows
// only when Video Live is ON and the saved link is valid.
function VideoLiveController({ session, theme }: { session: any; theme: 'wedding' | 'party' }) {
  const { t } = useI18n()
  const cfg = session?.screen_config ?? {}
  const enabled = cfg.show_video_live === true && !!resolveVideoSource(cfg.video_url)
  const [volume, setVolume] = useState<number>(
    typeof cfg.video_live?.volume === 'number' ? cfg.video_live.volume : 100,
  )
  const [muted, setMuted] = useState<boolean>(cfg.video_live?.command === 'mute')
  const [busy, setBusy] = useState(false)

  const writeVideoLive = async (patch: Record<string, any>, extraConfig: Record<string, any> = {}) => {
    const current = session?.screen_config ?? {}
    const newConfig = {
      ...current,
      ...extraConfig,
      video_live: {
        ...(current.video_live ?? {}),
        volume,
        ...patch,
        updated_at: new Date().toISOString(),
      },
    }
    setBusy(true)
    try {
      await live.updateSession(session.id, { screen_config: newConfig })
      await mutate(['session', session.id])
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const sendCommand = (command: VideoLiveCommand, extraConfig: Record<string, any> = {}) =>
    writeVideoLive({ command, command_id: newCommandId() }, extraConfig)

  // Transport buttons also persist the DJ's intended playback_state so the
  // dashboard highlight reflects the real state (not just box visibility).
  const play    = () => writeVideoLive({ command: 'play',    command_id: newCommandId(), playback_state: 'playing' })
  const pause   = () => writeVideoLive({ command: 'pause',   command_id: newCommandId(), playback_state: 'paused'  })
  const restart = () => writeVideoLive({ command: 'restart', command_id: newCommandId(), playback_state: 'playing' })

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    sendCommand(next ? 'mute' : 'unmute')
  }

  const commitVolume = (vol: number) =>
    // Volume change keeps the previous command_id (does not re-trigger transport).
    writeVideoLive({ volume: vol })

  const hideVideo = () => {
    // Removes the box from the screen and stops playback.
    writeVideoLive(
      { command: 'stop', command_id: newCommandId(), playback_state: 'stopped' },
      { show_video_live: false },
    )
  }

  if (!enabled) return null

  // Real playback state chosen by the DJ — drives the Play/Pause highlight.
  const playbackState = cfg.video_live?.playback_state
  const isPlaying = playbackState === 'playing'
  const isPaused  = playbackState === 'paused'

  const isWedding = theme === 'wedding'
  const btn = isWedding
    ? 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-white text-[#8F1D2C] border border-[#E8B7C8] hover:bg-[#FBEAF0] disabled:opacity-50 transition'
    : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-black/30 text-white border border-white/15 hover:border-[#FF2D8D] disabled:opacity-50 transition'
  const activeBtn = isWedding
    ? 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-[#8F1D2C] text-white border border-[#8F1D2C] ring-2 ring-[#8F1D2C]/30 hover:bg-[#7a1726] disabled:opacity-50 transition'
    : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-[#FF2D8D] text-white border border-[#FF2D8D] ring-2 ring-[#FF2D8D]/40 hover:bg-[#e8327b] disabled:opacity-50 transition'
  const dangerBtn = isWedding
    ? 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-white text-[#8F1D2C] border border-[#E8B7C8] hover:bg-[#FBEAF0] disabled:opacity-50 transition'
    : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-black/30 text-white border border-white/15 hover:border-white/40 disabled:opacity-50 transition'
  const wrap = isWedding
    ? 'mt-3 rounded-lg border border-[#E8B7C8] bg-[#FBEAF0]/40 p-3'
    : 'mt-3 rounded-xl border border-white/10 bg-black/20 p-3'
  const subText = isWedding ? 'text-[#6F6260]' : 'text-white/60'
  const accent = isWedding ? 'text-[#8F1D2C]' : 'text-[#FF2D8D]'

  return (
    <div className={wrap}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${accent} mb-2`}>
        {t('weddingPanels.videoControlsTitle')}
      </p>
      <p className={`text-[11px] ${subText} mb-3`}>{t('weddingPanels.videoControlsHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={play} className={isPlaying ? activeBtn : btn} aria-pressed={isPlaying}>
          <Play className="h-3.5 w-3.5" /> {t('weddingPanels.videoPlay')}
        </button>
        <button type="button" disabled={busy} onClick={pause} className={isPaused ? activeBtn : btn} aria-pressed={isPaused}>
          <Pause className="h-3.5 w-3.5" /> {t('weddingPanels.videoPause')}
        </button>
        <button type="button" disabled={busy} onClick={restart} className={btn}>
          <RotateCw className="h-3.5 w-3.5" /> {t('weddingPanels.videoRestart')}
        </button>
        <button type="button" disabled={busy} onClick={toggleMute} className={btn}>
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          {muted ? t('weddingPanels.videoUnmute') : t('weddingPanels.videoMute')}
        </button>
        <button type="button" disabled={busy} onClick={hideVideo} className={dangerBtn}>
          <Square className="h-3.5 w-3.5" /> {t('weddingPanels.videoHide')}
        </button>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <Volume2 className={`h-4 w-4 ${accent}`} />
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          disabled={busy}
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={() => commitVolume(volume)}
          onKeyUp={() => commitVolume(volume)}
          className="flex-1 accent-[#FF2D8D]"
          aria-label={t('weddingPanels.videoVolume')}
        />
        <span className={`text-xs tabular-nums w-9 text-right ${subText}`}>{volume}</span>
      </div>
    </div>
  )
}

export default function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()
  const { t } = useI18n()

  const { data: session, error: sessionErr } = useSWR(
    sessionId ? ['session', sessionId] : null,
    () => live.getSession(sessionId!),
    { refreshInterval: 5_000 },
  )
  const { hasAdvanceAccess, isFree } = useEffectiveAccess()
  const { ready: roleReady, isCouple } = useAccountRole()
  // Sposi never reach Party / standard sessions: replaced before any DJ UI is rendered.
  const coupleBlocked = isCouple && !!session && session.session_type !== 'wedding'
  useEffect(() => { if (coupleBlocked) router.replace(COUPLE_HOME) }, [coupleBlocked, router])
  // Realtime change signal from Firestore for THIS event only. Supabase is still authoritative,
  // so a change triggers a re-fetch of the legacy list instead of rendering Firestore data.
  // While the signal is live the 5s polling drops to a 60s safety net (covers a missed projection).
  // DJ live control data (requests) is never read for a Sposi account: Firestore rules refuse it too.
  const requestsSignal = useRequestsSignal(isCouple ? undefined : sessionId)
  const { data: requests, mutate: refreshRequests } = useSWR(
    sessionId && !isCouple ? ['requests', sessionId] : null,
    () => live.listRequests(sessionId!),
    { refreshInterval: requestsSignal.live ? 60_000 : 5_000 },
  )
  useEffect(() => { if (requestsSignal.tick > 0) refreshRequests() }, [requestsSignal.tick, refreshRequests])

  const [busyId, setBusyId] = useState<string | null>(null)
  const [togglingActive, setTogglingActive] = useState(false)
  const [rawTab, setTab] = useState<WeddingNavKey>('home')

  if (sessionErr) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="text-center">
          <p className="text-white/70 mb-4">{t('weddingPanels.sessionNotFound')}</p>
          <Link href="/sessions"><Button variant="secondary">{t('common.back')}</Button></Link>
        </Card>
      </div>
    )
  }
  if (!session || !roleReady || coupleBlocked) return <div className="flex-1 p-8 text-white/50">{t('common.loading')}</div>

  // Sessione premium (Party/Wedding) senza accesso valido → schermata di blocco.
  // La sessione resta salvata e visibile in lista, ma non apre la regia interna
  // finché l'Event Pass 24H non viene riattivato o si passa ad Advance.
  if (isPremiumSession(session) && !hasAdvanceAccess) {
    return <SessionLockScreen sessionType={session.session_type} eventName={session.event_name} />
  }

  const isWedding = session.session_type === 'wedding'

  const toggleActive = async () => {
    setTogglingActive(true)
    try {
      await live.updateSession(session.id, { is_active: !session.is_active })
      await mutate(['session', session.id])
    } catch (err: any) {
      toast.error(err?.message ?? t('common.errorGeneric'))
    } finally { setTogglingActive(false) }
  }

  const removeSession = async () => {
    if (!confirm(t('weddingPanels.confirmDeleteSession'))) return
    try {
      await live.deleteSession(session.id)
      router.push('/sessions')
    } catch (err: any) {
      toast.error(err?.message ?? t('common.errorGeneric'))
    }
  }

  const updateRequest = async (id: string, status: LiveRequestStatus) => {
    setBusyId(id)
    try {
      await live.updateRequest(id, status)
      await mutate(['requests', session.id])
    } catch (err: any) { toast.error(err?.message ?? t('common.errorGeneric')) }
    finally { setBusyId(null) }
  }
  const deleteRequest = async (id: string) => {
    setBusyId(id)
    try {
      await live.deleteRequest(id)
      await mutate(['requests', session.id])
    } catch (err: any) { toast.error(err?.message ?? t('common.errorGeneric')) }
    finally { setBusyId(null) }
  }

  const pending  = requests?.filter((r) => r.status === 'pending')  ?? []
  const approved = requests?.filter((r) => r.status === 'approved') ?? []
  const rejected = requests?.filter((r) => r.status === 'rejected') ?? []

  // ── Party Mode (private parties / clubs / aperitivi / DJ nights) ──
  if (session.session_type === 'party') {
    return (
      <PartyDashboard
        session={session}
        isFree={isFree}
        hasAccess={hasAdvanceAccess}
        pending={pending}
        approved={approved}
        rejected={rejected}
        busyId={busyId}
        togglingActive={togglingActive}
        onToggleActive={toggleActive}
        onDeleteSession={removeSession}
        onUpdateRequest={updateRequest}
        onDeleteRequest={deleteRequest}
      />
    )
  }

  // ── Standard (DJ/Club) — untouched dark theme ──────────────────
  if (!isWedding) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto w-full">
        <div className="mb-6">
          <Link href="/sessions" className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white">
            <ArrowLeft className="h-3 w-3" /> {t('common.back')}
          </Link>
        </div>
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-black text-white">{session.event_name}</h1>
              <Badge variant={session.is_active ? 'processing' : 'complete'}>
                {session.is_active ? t('sessions.active') : t('sessions.closed')}
              </Badge>
            </div>
            {session.dj_name && <p className="text-sm text-white/50 mt-1">DJ {session.dj_name}</p>}
            {session.description && <p className="text-sm text-white/60 mt-2 max-w-2xl">{session.description}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={togglingActive} onClick={toggleActive}
              icon={<Power className="h-3.5 w-3.5" />}>
              {session.is_active ? t('common.close') : t('common.open')}
            </Button>
            <Button variant="ghost" size="sm" onClick={removeSession} icon={<Trash2 className="h-3.5 w-3.5" />}>
              {t('common.delete')}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <QRCard slug={session.public_slug} />
            <Card className="p-4 space-y-3">
              <div className="flex justify-between text-sm"><span className="text-white/50">{t('common.pending')}</span><span className="font-bold text-white">{pending.length}</span></div>
              <div className="flex justify-between text-sm"><span className="text-white/50">{t('common.approved')}</span><span className="font-bold text-emerald-300">{approved.length}</span></div>
              <div className="flex justify-between text-sm"><span className="text-white/50">{t('common.rejected')}</span><span className="font-bold text-white/50">{rejected.length}</span></div>
            </Card>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <RequestsPanel
              pending={pending} approved={approved} rejected={rejected}
              busyId={busyId} isFree={isFree}
              onUpdate={updateRequest} onDelete={deleteRequest}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── Wedding — dedicated light platform layout ──────────────────
  // A Sposi account can only ever land on its own sections, whatever `tab` holds.
  const tab = isCouple && !isCoupleWeddingTab(rawTab) ? 'home' : rawTab
  const dashSection = (
    <>
      {tab === 'home' && (
        <WeddingHomePage session={session} pendingRequests={pending.length} togglingActive={togglingActive} onToggleActive={toggleActive} couple={isCouple} />
      )}
      {tab === 'photos' && <WeddingPhotosPage session={session} />}
      {tab === 'requests' && (
        <WdPage title={t('wdAdmin.nav.requests')} subtitle={t('wdAdmin.requests.subtitle')}>
          <RequestsPanel
            pending={pending} approved={approved} rejected={rejected}
            busyId={busyId} isFree={isFree}
            onUpdate={updateRequest} onDelete={deleteRequest}
            wedding
          />
        </WdPage>
      )}
      {tab === 'dedications' && (
        <WdPage title={t('wdAdmin.nav.dedications')} subtitle={t('wdAdmin.dedications.subtitle')}>
          <DedicationsPanel sessionId={session.id} />
        </WdPage>
      )}
      {tab === 'games' && (
        <WdPage title={t('wdAdmin.nav.games')} subtitle={t('wdAdmin.games.subtitle')}>
          <GamesPanel sessionId={session.id} session={session} />
        </WdPage>
      )}
      {tab === 'privacy' && <GuestVisibilityPanel sessionId={session.id} session={session} sessionType="wedding" hasAccess={hasAdvanceAccess} couple={isCouple} />}
      {tab === 'poster' && <WeddingPosterPage session={session} />}
      {tab === 'booth' && <WeddingPhotosPage session={session} initialSource="booth" />}
      {(tab === 'settings' || tab === 'screen') && (
        <WeddingSettingsPage key={tab} mode={tab === 'screen' ? 'screen' : 'event'} session={session} togglingActive={togglingActive} onToggle={toggleActive} onDelete={removeSession} />
      )}
    </>
  )

  return (
    <WeddingAdminShell
      eventName={session.event_name}
      active={tab}
      onSelect={setTab}
      badges={{ requests: pending.length }}
      couple={isCouple}
    >
      {dashSection}
    </WeddingAdminShell>
  )
}

function WeddingSettingsPage({ session, togglingActive, onToggle, onDelete, mode }: {
  session: any; togglingActive: boolean; onToggle: () => void; onDelete: () => void; mode: 'event' | 'screen';
}) {
  const { t } = useI18n()
  const slug: string = session.public_slug
  const [saving, setSaving] = useState(false)

  // ── Event details ─────────────────────────────────────────────
  const [details, setDetails] = useState({
    event_name: session.event_name ?? '',
    couple_names: session.couple_names ?? '',
    wedding_date: (session.wedding_date ?? '').slice(0, 10),
    venue_name: session.venue_name ?? '',
    description: session.description ?? '',
  })
  const saveDetails = async () => {
    if (!details.event_name.trim()) { toast.error(t('wdAdmin.settings.nameRequired')); return }
    setSaving(true)
    try {
      await live.updateSession(session.id, {
        event_name: details.event_name.trim(),
        couple_names: details.couple_names.trim() || null,
        wedding_date: details.wedding_date || null,
        venue_name: details.venue_name.trim() || null,
        description: details.description.trim() || null,
      })
      await mutate(['session', session.id])
      toast.success(t('weddingPanels.updated'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally { setSaving(false) }
  }

  // ── Screen config (same persistence logic as before) ──────────
  const screenConfig = session?.screen_config ?? {
    show_photos: false,
    show_dedications: false,
    show_roulette: false,
    show_shoe_game: false,
    show_polls: false,
    stand_up_guess: defaultStandUpGuessConfig(),
  }
  const standUpGuessConfig = normalizeStandUpGuessConfig((screenConfig as any).stand_up_guess)

  const [videoUrlDraft, setVideoUrlDraft] = useState<string>(session?.screen_config?.video_url ?? '')
  const [videoTitleDraft, setVideoTitleDraft] = useState<string>(session?.screen_config?.video_title ?? '')
  const videoPreview = resolveVideoSource(videoUrlDraft)
  const videoLinkInvalid = videoUrlDraft.trim().length > 0 && !videoPreview

  // Costruisce sempre un config completo per non perdere campi (font, video…)
  const buildFullConfig = (overrides: Record<string, any> = {}) => ({
    show_photos: screenConfig.show_photos ?? false,
    show_dedications: screenConfig.show_dedications ?? false,
    show_roulette: screenConfig.show_roulette ?? false,
    show_shoe_game: screenConfig.show_shoe_game ?? false,
    show_polls: screenConfig.show_polls ?? false,
    stand_up_guess: standUpGuessConfig,
    show_video_live: (screenConfig as any).show_video_live ?? false,
    video_url: (screenConfig as any).video_url ?? '',
    video_title: (screenConfig as any).video_title ?? '',
    live_booth_layout: (screenConfig as any).live_booth_layout ?? 'single',
    couple_font: screenConfig.couple_font ?? 'cormorant',
    couple_font_size: screenConfig.couple_font_size ?? 'medium',
    ...overrides,
  })

  const saveConfig = async (config: Record<string, any>, okMsg = t('weddingPanels.updated')) => {
    setSaving(true)
    try {
      await live.updateSession(session.id, { screen_config: config as any })
      await mutate(['session', session.id])
      toast.success(okMsg)
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally { setSaving(false) }
  }

  const toggleScreenSection = async (key: string) => {
    const newConfig: any = buildFullConfig()
    if (typeof newConfig[key] === 'boolean') newConfig[key] = !newConfig[key]
    await saveConfig(newConfig)
  }
  const toggleStandUpGuessVisibility = () => {
    const current = normalizeStandUpGuessConfig((screenConfig as any).stand_up_guess)
    return saveConfig(buildFullConfig({ stand_up_guess: { ...current, enabled: !current.enabled, updated_at: new Date().toISOString() } }))
  }
  const saveVideoFields = () => saveConfig(buildFullConfig({ video_url: videoUrlDraft.trim(), video_title: videoTitleDraft.trim() }))
  const saveBoothLayout = (layout: 'single' | 'grid' | 'auto') => saveConfig(buildFullConfig({ live_booth_layout: layout }))
  const resetScreen = () => saveConfig(buildFullConfig({
    show_photos: false,
    show_dedications: false,
    show_roulette: false,
    show_shoe_game: false,
    show_polls: false,
    stand_up_guess: {
      ...standUpGuessConfig,
      enabled: false,
      status: 'idle',
      current_index: 0,
      current_round_id: standUpGuessConfig.rounds.find((r) => r.enabled)?.id ?? standUpGuessConfig.rounds[0]?.id ?? null,
      score: { guessed: 0, missed: 0 },
      updated_at: new Date().toISOString(),
    },
    show_video_live: false,
  }), t('weddingPanels.resetDone'))
  const saveFontField = (field: 'couple_font' | 'couple_font_size', value: string) =>
    saveConfig({ ...screenConfig, [field]: value }, t('weddingPanels.fontUpdated'))

  const screenToggles: Array<{ key: string; icon: React.ReactNode; label: string }> = [
    { key: 'show_photos',     icon: <ImageIcon className="h-[18px] w-[18px]" />,  label: t('weddingPanels.photos') },
    { key: 'show_dedications', icon: <Heart className="h-[18px] w-[18px]" />,      label: t('weddingPanels.dedications') },
    { key: 'show_roulette',   icon: <Sparkles className="h-[18px] w-[18px]" />,   label: t('weddingPanels.roulette') },
    { key: 'show_shoe_game',  icon: <Footprints className="h-[18px] w-[18px]" />, label: t('weddingPanels.shoeGame') },
    { key: 'show_polls',      icon: <ListChecks className="h-[18px] w-[18px]" />, label: t('weddingPanels.polls') },
  ]
  const boothLayout = ((screenConfig as any).live_booth_layout ?? 'single') as 'single' | 'grid' | 'auto'

  return (
    <WdPage width="narrow" title={mode === 'screen' ? t('wdAdmin.nav.screen') : t('wdAdmin.settings.pageTitle')} subtitle={mode === 'screen' ? t('wdAdmin.screen.subtitle') : undefined}>
      {(mode === 'event' || session.screen_mode_enabled) && (
      <WdSectionCard>
        {mode === 'event' && (<>
        <WdSection title={t('wdAdmin.settings.eventName')} description={t('wdAdmin.settings.eventNameDesc')}>
          <WdInput value={details.event_name} maxLength={200} onChange={(e) => setDetails({ ...details, event_name: e.target.value })} />
        </WdSection>
        <WdSection title={t('wdAdmin.settings.coupleNames')} description={t('wdAdmin.settings.coupleNamesDesc')}>
          <WdInput value={details.couple_names} maxLength={200} onChange={(e) => setDetails({ ...details, couple_names: e.target.value })} />
        </WdSection>
        <WdSection title={t('wdAdmin.settings.date')} description={t('wdAdmin.settings.dateDesc')}>
          <WdInput type="date" value={details.wedding_date} onChange={(e) => setDetails({ ...details, wedding_date: e.target.value })} />
        </WdSection>
        <WdSection title={t('wdAdmin.settings.venue')} description={t('wdAdmin.settings.venueDesc')}>
          <WdInput value={details.venue_name} maxLength={200} onChange={(e) => setDetails({ ...details, venue_name: e.target.value })} />
        </WdSection>
        <WdSection title={t('wdAdmin.settings.description')} description={t('wdAdmin.settings.descriptionDesc')}>
          <WdInput value={details.description} maxLength={2000} onChange={(e) => setDetails({ ...details, description: e.target.value })} />
          <WdButton className="mt-5" onClick={saveDetails} disabled={saving}>{t('wdAdmin.settings.save')}</WdButton>
        </WdSection>

        </>)}

        {mode === 'screen' && session.screen_mode_enabled && (
          <>
            <WdSection title={t('wdAdmin.screen.namesTitle')} description={t('wdAdmin.screen.namesDesc')}>
              <p className="rounded-xl border border-wd-border bg-wd-bg px-4 py-3 text-base font-bold text-wd-ink">{session.couple_names ?? session.event_name}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <WdLinkButton href={`/screen/${slug}`} size="sm" icon={<Tv className="h-3.5 w-3.5" />}>{t('wdAdmin.home.openScreen')}</WdLinkButton>
                <WdLinkButton href={`${djToolsOrigin()}/remote/${slug}`} size="sm" icon={<Users className="h-3.5 w-3.5" />}>{t('weddingPanels.djRemoteCtrl')}</WdLinkButton>
              </div>
            </WdSection>
            <WdSection
              title={t('weddingPanels.screenVisibility')}
              description={t('wdAdmin.settings.screenDesc')}
              action={
                <div className="flex shrink-0 items-center gap-2">
                  <WdButton size="sm" variant="ghost" onClick={resetScreen} disabled={saving}>{t('weddingPanels.reset')}</WdButton>
                  <WdLinkButton href={`/screen/${slug}`} size="sm" icon={<Tv className="h-3.5 w-3.5" />}>{t('weddingPanels.open')}</WdLinkButton>
                </div>
              }
            >
              <WdDivided>
                {screenToggles.map((s) => (
                  <div key={s.key}>
                    <WdToggleRow
                      icon={s.icon}
                      title={s.label}
                      checked={Boolean((screenConfig as any)[s.key])}
                      onChange={() => toggleScreenSection(s.key)}
                      disabled={saving}
                    />
                    {s.key === 'show_photos' && Boolean(screenConfig.show_photos) && (
                      <div className="pb-4 pl-8">
                        <p className="mb-2 text-xs font-medium text-wd-muted">{t('weddingPanels.boothLayout')}</p>
                        <WdPills
                          value={boothLayout}
                          onChange={saveBoothLayout}
                          options={[
                            { value: 'single', label: t('weddingPanels.boothSingle') },
                            { value: 'grid', label: t('weddingPanels.boothGrid') },
                            { value: 'auto', label: t('weddingPanels.boothAuto') },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <WdToggleRow
                  icon={<Users className="h-[18px] w-[18px]" />}
                  title={t('weddingPanels.standUpGuessName')}
                  checked={standUpGuessConfig.enabled === true}
                  onChange={toggleStandUpGuessVisibility}
                  disabled={saving}
                />
              </WdDivided>
            </WdSection>

            <WdSection title={t('weddingPanels.videoLive')} description={t('weddingPanels.videoLiveHint')}>
              <WdToggleRow
                icon={<Youtube className="h-[18px] w-[18px]" />}
                title={t('weddingPanels.videoLive')}
                checked={Boolean((screenConfig as any).show_video_live)}
                onChange={() => toggleScreenSection('show_video_live')}
                disabled={saving}
              />
              <div className="mt-4 grid gap-4">
                <WdField label={t('weddingPanels.videoUrlPlaceholder')}>
                  <WdInput type="url" value={videoUrlDraft} onChange={(e) => setVideoUrlDraft(e.target.value)} onBlur={saveVideoFields} disabled={saving} />
                </WdField>
                <WdField label={t('weddingPanels.videoTitlePlaceholder')}>
                  <WdInput value={videoTitleDraft} onChange={(e) => setVideoTitleDraft(e.target.value)} onBlur={saveVideoFields} disabled={saving} />
                </WdField>
              </div>
              {videoLinkInvalid && <p className="mt-2 text-xs text-red-600">{t('weddingPanels.videoInvalid')}</p>}
              {videoPreview ? (
                <div className="mt-4 relative w-full aspect-video rounded-2xl overflow-hidden border border-wd-border bg-black">
                  {videoPreview.kind === 'youtube' ? (
                    <iframe
                      src={videoPreview.embedUrl}
                      title="preview"
                      className="absolute inset-0 w-full h-full"
                      allow="encrypted-media; picture-in-picture"
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  ) : (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={videoPreview.url} className="absolute inset-0 w-full h-full object-contain" muted loop playsInline controls />
                  )}
                </div>
              ) : (screenConfig as any).show_video_live && !videoUrlDraft.trim() ? (
                <div className="mt-4 rounded-2xl border border-dashed border-wd-border bg-wd-bg py-5 text-center">
                  <p className="text-sm text-wd-muted">{t('weddingPanels.videoNoLink')}</p>
                </div>
              ) : null}
              <VideoLiveController session={session} theme="wedding" />
            </WdSection>

            <WdSection title={t('wdAdmin.settings.namesStyle')} description={t('wdAdmin.settings.namesStyleDesc')}>
              <div className="grid gap-4">
                <WdField label={t('weddingPanels.coupleFont')}>
                  <WdSelect value={screenConfig.couple_font ?? 'cormorant'} disabled={saving} onChange={(e) => saveFontField('couple_font', e.target.value)}>
                    <option value="cormorant">{t('weddingPanels.fontCormorant')}</option>
                    <option value="playfair">{t('weddingPanels.fontPlayfair')}</option>
                    <option value="great-vibes">{t('weddingPanels.fontGreatVibes')}</option>
                    <option value="dancing">{t('weddingPanels.fontDancing')}</option>
                    <option value="cinzel">{t('weddingPanels.fontCinzel')}</option>
                    <option value="tangerine">{t('weddingPanels.fontTangerine')}</option>
                  </WdSelect>
                </WdField>
                <WdField label={t('weddingPanels.coupleFontSize')}>
                  <WdSelect value={screenConfig.couple_font_size ?? 'medium'} disabled={saving} onChange={(e) => saveFontField('couple_font_size', e.target.value)}>
                    <option value="small">{t('weddingPanels.fontSizeSmall')}</option>
                    <option value="medium">{t('weddingPanels.fontSizeMedium')}</option>
                    <option value="large">{t('weddingPanels.fontSizeLarge')}</option>
                    <option value="xlarge">{t('weddingPanels.fontSizeXlarge')}</option>
                  </WdSelect>
                </WdField>
              </div>
            </WdSection>
          </>
        )}
      </WdSectionCard>
      )}

      {mode === 'screen' && !session.screen_mode_enabled && (
        <WdCard><p className="text-sm text-wd-muted">{t('wdAdmin.home.screenOff')}</p></WdCard>
      )}

      {mode === 'event' && (
      <WdCard title={t('wdAdmin.settings.eventStatus')} description={t('wdAdmin.settings.eventStatusDesc')}>
        <div className="flex flex-wrap gap-3">
          <WdButton variant="secondary" onClick={onToggle} disabled={togglingActive} icon={<Power className="h-4 w-4" />}>
            {session.is_active ? t('common.close') : t('common.open')}
          </WdButton>
          <WdButton variant="danger" onClick={onDelete} icon={<Trash2 className="h-4 w-4" />}>{t('common.delete')}</WdButton>
        </div>
      </WdCard>
      )}
    </WdPage>
  )
}

function RequestsPanel({ pending, approved, rejected, busyId, isFree, onUpdate, onDelete, wedding }: any) {
  const { t } = useI18n()
  const headingClass = wedding ? 'font-wedding text-2xl font-semibold text-[#2B2424] mb-3' : 'font-bold text-white mb-3'
  const mutedHeadingClass = wedding ? 'font-wedding text-2xl font-semibold text-[#6F6260] mb-3' : 'font-bold text-white/60 mb-3'
  const emptyCard = wedding
    ? <div className="rounded-[18px] bg-[#F7F4F3] border border-[#E7D8D2] text-center py-8 text-sm text-[#6F6260]">{t('common.loading')}…</div>
    : <Card className="text-center py-8 text-sm text-white/40">{t('common.loading')}…</Card>
  return (
    <>
      <section>
        <h2 className={headingClass}>{t('common.pending')} ({pending.length})</h2>
        {pending.length === 0 ? emptyCard : (
          <div className="space-y-2">
            {pending.map((r: any) => (
              <RequestItem key={r.id} request={r} busy={busyId === r.id} readOnly={isFree} wedding={wedding}
                onUpdate={(s: LiveRequestStatus) => onUpdate(r.id, s)} onDelete={() => onDelete(r.id)} />
            ))}
          </div>
        )}
        {isFree && pending.length > 0 && (
          <div className="mt-3"><UpgradeGate compact title={t('weddingPanels.approveRejectPro')} message={t('weddingPanels.approveRejectProMsg')} /></div>
        )}
      </section>
      {approved.length > 0 && (
        <section>
          <h2 className={headingClass}>{t('common.approved')} ({approved.length})</h2>
          <div className="space-y-2">
            {approved.map((r: any) => (
              <RequestItem key={r.id} request={r} busy={busyId === r.id} readOnly={isFree} wedding={wedding}
                onUpdate={(s: LiveRequestStatus) => onUpdate(r.id, s)} onDelete={() => onDelete(r.id)} />
            ))}
          </div>
        </section>
      )}
      {rejected.length > 0 && (
        <section>
          <h2 className={mutedHeadingClass}>{t('common.rejected')} ({rejected.length})</h2>
          <div className="space-y-2">
            {rejected.map((r: any) => (
              <RequestItem key={r.id} request={r} busy={busyId === r.id} readOnly={isFree} wedding={wedding}
                onUpdate={(s: LiveRequestStatus) => onUpdate(r.id, s)} onDelete={() => onDelete(r.id)} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function DedicationsPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const dedSignal = useDedicationsSignal(sessionId)
  const { data, mutate: refresh } = useSWR(
    ['dedications', sessionId],
    () => liveDedications.listForDj(sessionId),
    { refreshInterval: dedSignal.live ? 60_000 : 5_000 },
  )
  useEffect(() => { if (dedSignal.tick > 0) refresh() }, [dedSignal.tick, refresh])
  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    try { await liveDedications.setStatus(id, status); refresh() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }
  const remove = async (id: string) => {
    try { await liveDedications.remove(id); refresh() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }
  const items = data ?? []
  if (items.length === 0) {
    return <WeddingCard tone="ivory" className="text-center py-8 text-sm text-wedding-ink/50">{t('wedding.dedications.empty')}</WeddingCard>
  }
  return (
    <section className="space-y-3">
      <h2 className="font-wedding text-2xl font-semibold text-[#2B2424] mb-1">{t('wedding.tabDedications')}</h2>
      {items.map((d) => (
        <WeddingCard key={d.id} tone="ivory">
          <div className="flex items-start gap-3">
            <Heart className="h-4 w-4 text-[#8F1D2C] mt-1 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-wedding text-lg italic text-[#2B2424] whitespace-pre-line leading-snug">
                "{d.message}"
              </p>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#8F1D2C] mt-2">
                — {d.guest_name ?? t('weddingPanels.anonymous')}
                <span className="ml-2 normal-case tracking-normal">
                  <WeddingBadge tone={d.status === 'approved' ? 'sage' : d.status === 'rejected' ? 'taupe' : 'gold'}>
                    {wdStatusLabel(t, d.status)}
                  </WeddingBadge>
                </span>
              </p>
            </div>
            <div className="flex gap-1">
              {d.status !== 'approved' && (
                <button onClick={() => setStatus(d.id, 'approved')} className="p-2 rounded-full bg-wedding-sage/30 text-[#5f6f59] hover:bg-wedding-sage/50 transition" title={t('common.approve')}>
                  <Check className="h-4 w-4" />
                </button>
              )}
              {d.status !== 'rejected' && (
                <button onClick={() => setStatus(d.id, 'rejected')} className="p-2 rounded-full bg-wedding-taupe/20 text-wedding-ink/70 hover:bg-wedding-taupe/40 transition" title={t('common.reject')}>
                  <X className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => remove(d.id)} className="p-2 rounded-full bg-wedding-blush/40 text-[#8a4f4a] hover:bg-wedding-blush/60 transition" title={t('common.delete')}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </WeddingCard>
      ))}
    </section>
  )
}

function ScreenControlsPanel({ sessionId, session }: { sessionId: string; session: any }) {
  const { t } = useI18n()
  const [saving, setSaving] = useState(false)

  const screenConfig = session?.screen_config ?? {
    show_photos: false,
    show_dedications: false,
    show_roulette: false,
    show_shoe_game: false,
    show_polls: false,
  }

  const toggle = async (key: keyof typeof screenConfig) => {
    setSaving(true)
    try {
      const newConfig = { ...screenConfig, [key]: !screenConfig[key] }
      await live.updateSession(sessionId, { screen_config: newConfig })
      await mutate(['session', sessionId])
      toast.success(t('weddingPanels.configUpdated'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <WeddingCard tone="cream">
      <h2 className="font-wedding text-2xl text-wedding-ink mb-2 inline-flex items-center gap-2">
        <Tv className="h-5 w-5 text-wedding-gold" /> {t('weddingPanels.screenVisibilityLive')}
      </h2>
      <p className="text-xs text-wedding-ink/60 mb-5">
        {t('weddingPanels.screenChoose')}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_photos ?? false}
            onChange={() => toggle('show_photos')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <ImageIcon className="h-4 w-4 text-wedding-gold" />
            {t('weddingPanels.latestPhotos')}
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_dedications ?? false}
            onChange={() => toggle('show_dedications')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <Heart className="h-4 w-4 text-wedding-gold" />
            {t('weddingPanels.latestDedications')}
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_roulette ?? false}
            onChange={() => toggle('show_roulette')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-wedding-gold" />
            {t('weddingPanels.roulette')}
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_shoe_game ?? false}
            onChange={() => toggle('show_shoe_game')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <Footprints className="h-4 w-4 text-wedding-gold" />
            {t('weddingPanels.shoeGame')}
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_polls ?? false}
            onChange={() => toggle('show_polls')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <ListChecks className="h-4 w-4 text-wedding-gold" />
            {t('weddingPanels.polls')}
          </span>
        </label>
      </div>
    </WeddingCard>
  )
}

// ─────────────── GUEST VISIBILITY PANEL ───────────────
// Controls which interactive functions guests see on the public live page
// (QR Code). Independent from screen_config (TV view). Gated behind premium
// access (Advance plan OR active Event Pass 24H).
function GuestVisibilityPanel({
  sessionId, session, sessionType, hasAccess, couple = false,
}: { sessionId: string; session: any; sessionType: 'wedding' | 'party'; hasAccess: boolean; couple?: boolean }) {
  const { t } = useI18n()
  const [saving, setSaving] = useState(false)
  const cfg: Record<string, boolean | undefined> = session?.guest_config ?? {}

  // Song requests are visible by default; every other function is hidden until enabled.
  const isOn = (key: string) => (key === 'requests' ? cfg.requests !== false : cfg[key] === true)

  const toggle = async (key: string) => {
    setSaving(true)
    try {
      const next = { ...cfg, [key]: !isOn(key) }
      await live.updateSession(sessionId, { guest_config: next })
      await mutate(['session', sessionId])
      toast.success(t('guestVisibility.saved'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  const weddingItems = [
    { key: 'requests',    icon: <Music2 className="h-4 w-4" />,     label: t('guestVisibility.requests') },
    { key: 'dedications', icon: <Heart className="h-4 w-4" />,      label: t('guestVisibility.dedications') },
    { key: 'shoe_game',   icon: <Footprints className="h-4 w-4" />, label: t('guestVisibility.shoeGame') },
    { key: 'polls',       icon: <ListChecks className="h-4 w-4" />, label: t('guestVisibility.polls') },
    { key: 'live_booth',  icon: <Camera className="h-4 w-4" />,     label: t('guestVisibility.liveBooth') },
  ]
  const partyItems = [
    { key: 'requests',     icon: <Music2 className="h-4 w-4" />,     label: t('guestVisibility.requests') },
    { key: 'live_booth',   icon: <Camera className="h-4 w-4" />,     label: t('guestVisibility.liveBooth') },
    { key: 'music_battle', icon: <ListChecks className="h-4 w-4" />, label: t('guestVisibility.musicBattle') },
    { key: 'roulette',     icon: <Sparkles className="h-4 w-4" />,   label: t('guestVisibility.roulette') },
  ]
  // Sposi only manage the photo entry point; request / dedication / game visibility belongs to the DJ.
  const items = sessionType === 'wedding' ? (couple ? weddingItems.filter((i) => i.key === 'live_booth') : weddingItems) : partyItems

  // ── Party theme ──────────────────────────────────────────────
  if (sessionType === 'party') {
    if (!hasAccess) {
      return (
        <PartyPaywall
          title={t('guestVisibility.lockedTitle')}
          message={t('guestVisibility.lockedMsg')}
        />
      )
    }
    return (
      <PartyCard>
        <PartyEyebrow>{t('guestVisibility.tab')}</PartyEyebrow>
        <h2 className="text-2xl font-black text-white mt-2">{t('guestVisibility.title')}</h2>
        <p className="text-sm text-white/60 mt-1 mb-5">{t('guestVisibility.desc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((it) => (
            <label
              key={it.key}
              className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white/5 border border-white/10 px-4 py-3 hover:border-[#FF2D8D]/50 transition"
            >
              <input
                type="checkbox"
                checked={isOn(it.key)}
                onChange={() => toggle(it.key)}
                disabled={saving}
                className="rounded border-white/20 bg-transparent text-[#FF2D8D] focus:ring-[#FF2D8D]"
              />
              <span className="text-sm text-white flex items-center gap-1.5">
                <span className="text-[#FF2D8D]">{it.icon}</span>
                {it.label}
              </span>
            </label>
          ))}
        </div>
      </PartyCard>
    )
  }

  // ── Wedding theme ────────────────────────────────────────────
  const weddingDescKey: Record<string, string> = {
    requests: 'wdAdmin.privacy.requestsDesc',
    dedications: 'wdAdmin.privacy.dedicationsDesc',
    shoe_game: 'wdAdmin.privacy.shoeGameDesc',
    polls: 'wdAdmin.privacy.pollsDesc',
    live_booth: 'wdAdmin.privacy.liveBoothDesc',
  }
  return (
    <WdPage width="narrow" title={t('wdAdmin.privacy.pageTitle')}>
      {!hasAccess ? (
        <WdCard title={t('guestVisibility.lockedTitle')} description={t('guestVisibility.lockedMsg')}>
          <Link href="/billing"><WdButton>{t('guestVisibility.lockedCta')}</WdButton></Link>
        </WdCard>
      ) : (
        <WdSectionCard>
          {items.map((it) => (
            <WdToggleRow
              key={it.key}
              section
              title={it.label}
              description={t(weddingDescKey[it.key] ?? '')}
              status={isOn(it.key) ? t('wdAdmin.privacy.on') : t('wdAdmin.privacy.off')}
              checked={isOn(it.key)}
              onChange={() => toggle(it.key)}
              disabled={saving}
            />
          ))}
        </WdSectionCard>
      )}
    </WdPage>
  )
}

function GamesPanel({ sessionId, session }: { sessionId: string; session: any }) {  const { t } = useI18n()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>(['soft', 'party'])
  const [showPenitenzaEditor, setShowPenitenzaEditor] = useState(false)
  const [customPenitenze, setCustomPenitenze] = useState<any[]>([])
  const [editingPenitenze, setEditingPenitenze] = useState(false)

  const [showQuestionsEditor, setShowQuestionsEditor] = useState(false)
  const [customQuestions, setCustomQuestions] = useState<string[]>([])
  const [editingQuestions, setEditingQuestions] = useState(false)

  // Carica penitenze custom dalla sessione
  const loadedPenitenze = session?.roulette_penitenze ?? null

  // Carica domande custom dalla sessione
  const loadedQuestions = session?.shoe_game_questions ?? null
  const DEFAULT_SHOE_QUESTIONS = [
    'Chi ha fatto il primo passo?',
    'Chi è più geloso?',
    'Chi ha sempre ragione?',
    'Chi è più romantico?',
    'Chi cucina meglio?',
    'Chi spende più soldi?',
    'Chi è più disordinato?',
    'Chi guida meglio?',
    'Chi è più puntuale?',
    'Chi dorme di più?',
    'Chi è più social?',
    'Chi ha più pazienza?',
    'Chi decide cosa guardare in TV?',
    'Chi ha scelto questa musica?',
    'Chi ama di più l\'altro? ❤️',
  ]

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    )
  }

  const savePenitenze = async () => {
    setEditingPenitenze(true)
    try {
      await live.updateSession(sessionId, { roulette_penitenze: customPenitenze.length > 0 ? customPenitenze : null })
      await mutate(['session', sessionId])
      toast.success(t('weddingPanels.forfeitsSaved'))
      setShowPenitenzaEditor(false)
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setEditingPenitenze(false)
    }
  }

  const resetToDefault = async () => {
    setEditingPenitenze(true)
    try {
      await live.updateSession(sessionId, { roulette_penitenze: null })
      await mutate(['session', sessionId])
      setCustomPenitenze([])
      toast.success(t('weddingPanels.defaultForfeitsRestored'))
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setEditingPenitenze(false)
    }
  }

  const start = async () => {
    setRunning(true)
    setResult(null) // Nasconde il risultato precedente
    try {
      // Prepara la roulette
      const selectedCats = categories.length > 0 ? categories : ['soft', 'party']
      await liveGames.startRoulette(sessionId, selectedCats)

      // Esegui lo spin per ottenere il risultato
      const r = await liveGames.spinRoulette(sessionId)

      toast.success(t('weddingPanels.rouletteStarted'))

      // Mostra il risultato SOLO DOPO che la roulette finisce (17 secondi: 12s spin + 5s popup)
      setTimeout(() => {
        if (r.result?.slot_label) {
          setResult(r.result.slot_label)
        }
      }, 17000)
    }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
    finally { setRunning(false) }
  }

  const spin = async () => {
    setRunning(true)
    try {
      const r = await liveGames.spinRoulette(sessionId)
      if (r.result?.slot_label) setResult(r.result.slot_label)
    } catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
    finally { setRunning(false) }
  }

  const reset = async () => {
    try { await liveGames.resetRoulette(sessionId); setResult(null) }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }

  return (
    <section className="space-y-4">
      <WeddingCard tone="active">
        <h2 className="font-wedding text-2xl font-semibold text-[#2B2424] mb-2 inline-flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#8F1D2C]" /> {t('wedding.roulette.title')}
        </h2>
        <p className="text-xs text-[#6F6260] mb-4">{t('weddingPanels.rouletteSubtitle')}</p>

        <div className="mb-5 pb-4 border-b border-wedding-champagne/50">
          <button
            onClick={() => {
              setShowPenitenzaEditor(!showPenitenzaEditor)
              if (!showPenitenzaEditor && loadedPenitenze) {
                setCustomPenitenze(loadedPenitenze)
              } else if (!showPenitenzaEditor) {
                // Carica le default come base
                setCustomPenitenze([
                  { label: 'Brindisi agli sposi 🥂', category: 'soft', enabled: true },
                  { label: 'Foto di gruppo 📸', category: 'soft', enabled: true },
                  { label: 'Discorso romantico 💌', category: 'soft', enabled: true },
                  { label: 'Ballo di gruppo 🕺', category: 'party', enabled: true },
                  { label: 'Discorso ubriaco 😂', category: 'party', enabled: true },
                  { label: 'Servi da bere 🍾', category: 'party', enabled: true },
                  { label: 'Fai cantare il tavolo 🎤', category: 'party', enabled: true },
                  { label: 'Corri dagli sposi 🏃', category: 'wild', enabled: true },
                  { label: 'Shot misterioso 🎯', category: 'wild', enabled: true },
                ])
              }
            }}
            className="text-xs text-[#8F1D2C] hover:underline inline-flex items-center gap-1 font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            {loadedPenitenze ? t('weddingPanels.editCustomForfeits') : t('weddingPanels.customizeForfeits')}
          </button>

          {showPenitenzaEditor && (
            <div className="mt-4 p-4 rounded-xl bg-white border border-wedding-champagne">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-wedding-ink">{t('weddingPanels.editForfeitsTitle')}</h3>
                <div className="flex gap-2">
                  <button onClick={resetToDefault} disabled={editingPenitenze} className="text-xs text-wedding-taupe hover:underline">
                    {t('weddingPanels.resetDefaults')}
                  </button>
                  <button onClick={savePenitenze} disabled={editingPenitenze} className="text-xs text-wedding-gold hover:underline font-semibold">
                    {t('weddingPanels.save')}
                  </button>
                </div>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {customPenitenze.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg hover:bg-wedding-blush/20">
                    <input
                      type="text"
                      value={p.label}
                      onChange={(e) => {
                        const updated = [...customPenitenze]
                        updated[i].label = e.target.value
                        setCustomPenitenze(updated)
                      }}
                      className="flex-1 text-sm px-3 py-1.5 rounded border border-wedding-champagne focus:border-wedding-gold focus:ring-1 focus:ring-wedding-gold"
                      placeholder={t('weddingPanels.forfeitPlaceholder')}
                    />
                    <select
                      value={p.category}
                      onChange={(e) => {
                        const updated = [...customPenitenze]
                        updated[i].category = e.target.value
                        setCustomPenitenze(updated)
                      }}
                      className="text-xs px-2 py-1.5 rounded border border-wedding-champagne focus:border-wedding-gold"
                    >
                      <option value="soft">{t('weddingPanels.catSoft')}</option>
                      <option value="party">{t('weddingPanels.catParty')}</option>
                      <option value="wild">{t('weddingPanels.catWild')}</option>
                    </select>
                    <button
                      onClick={() => {
                        setCustomPenitenze(customPenitenze.filter((_, idx) => idx !== i))
                      }}
                      className="p-1.5 text-wedding-taupe hover:text-wedding-ink"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  setCustomPenitenze([...customPenitenze, { label: '', category: 'soft', enabled: true }])
                }}
                className="mt-3 text-xs text-wedding-gold hover:underline inline-flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> {t('weddingPanels.addForfeit')}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-5 pb-4 border-b border-[#E8B7C8]/50">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-full bg-white border border-[#E8B7C8] hover:bg-[#FBEAF0] transition">
            <input
              type="checkbox"
              checked={categories.includes('soft')}
              onChange={() => toggleCategory('soft')}
              className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
            />
            <span className="text-sm text-[#2B2424] font-medium">{t('weddingPanels.catSoftLabel')}</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-full bg-white border border-[#E8B7C8] hover:bg-[#FBEAF0] transition">
            <input
              type="checkbox"
              checked={categories.includes('party')}
              onChange={() => toggleCategory('party')}
              className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
            />
            <span className="text-sm text-[#2B2424] font-medium">{t('weddingPanels.catPartyLabel')}</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-full bg-white border border-[#E8B7C8] hover:bg-[#FBEAF0] transition">
            <input
              type="checkbox"
              checked={categories.includes('wild')}
              onChange={() => toggleCategory('wild')}
              className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
            />
            <span className="text-sm text-[#2B2424] font-semibold">{t('weddingPanels.catWildLabel')}</span>
          </label>
        </div>

        {result && (
          <div className="rounded-2xl border-2 border-[#E8B7C8] bg-white p-8 text-center mb-5 shadow-lg">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#8F1D2C] mb-3 font-semibold">{t('weddingPanels.result')}</p>
            <p className="text-4xl font-semibold text-[#2B2424] leading-tight">{result}</p>
            <p className="text-xs text-[#6F6260] mt-3 italic">{t('weddingPanels.visibleOnScreen')}</p>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <WeddingButton onClick={start} variant="outline" loading={running} icon={<Play className="h-4 w-4" />}>{t('wedding.roulette.start')}</WeddingButton>
          <WeddingButton onClick={spin} variant="gold" loading={running} icon={<Sparkles className="h-4 w-4" />}>{t('wedding.roulette.spin')}</WeddingButton>
          <WeddingButton onClick={reset} variant="ghost" icon={<RotateCw className="h-4 w-4" />}>{t('wedding.roulette.reset')}</WeddingButton>
        </div>
      </WeddingCard>

      <ShoeGamePanel sessionId={sessionId} />

      <StandUpGuessPanel sessionId={sessionId} />

      <PollsPanel sessionId={sessionId} />

      {/* Wedding · Strumenti finali — Proclamazione Vincitore (NON un gioco). */}
      <WinnerAnnouncementPanel sessionId={sessionId} />
    </section>
  )
}

function ShoeGamePanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const { data: session, mutate: mutateSession } = useSWR(['session', sessionId], () => live.getSession(sessionId))
  // Realtime change signal (Firestore games) → re-fetch of the authoritative legacy state; slow safety poll while live.
  const gamesSignal = useGamesSignal(sessionId)
  const { data: round, mutate: refresh } = useSWR(
    ['shoe-game', sessionId],
    () => liveGames.getShoeState(sessionId),
    { refreshInterval: gamesSignal.live ? 30_000 : 4_000 },
  )
  useEffect(() => { if (gamesSignal.tick > 0) refresh() }, [gamesSignal.tick, refresh])
  const [busy, setBusy] = useState(false)
  const [showQuestionsEditor, setShowQuestionsEditor] = useState(false)
  const [customQuestions, setCustomQuestions] = useState<string[]>([])
  const [editingQuestions, setEditingQuestions] = useState(false)

  const loadedQuestions = session?.shoe_game_questions ?? null
  const DEFAULT_SHOE_QUESTIONS = [
    'Chi ha fatto il primo passo?',
    'Chi è più geloso?',
    'Chi ha sempre ragione?',
    'Chi è più romantico?',
    'Chi cucina meglio?',
    'Chi spende più soldi?',
    'Chi è più disordinato?',
    'Chi guida meglio?',
    'Chi è più puntuale?',
    'Chi dorme di più?',
    'Chi è più social?',
    'Chi ha più pazienza?',
    'Chi decide cosa guardare in TV?',
    'Chi ha scelto questa musica?',
    'Chi ama di più l\'altro? ❤️',
  ]

  const questions: string[] = round?.config?.questions ?? []
  const currentIndex: number = round?.config?.current_index ?? 0
  const isActive = round?.status === 'running' && round?.config?.is_active

  const start = async () => {
    setBusy(true)
    try { await liveGames.startShoe(sessionId); toast.success(t('weddingPanels.shoeStarted')); refresh() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
    finally { setBusy(false) }
  }
  const next = async () => {
    setBusy(true)
    try { await liveGames.nextShoe(sessionId); refresh() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
    finally { setBusy(false) }
  }
  const reset = async () => {
    setBusy(true)
    try { await liveGames.resetShoe(sessionId); refresh() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
    finally { setBusy(false) }
  }

  const saveCustomQuestions = async () => {
    if (customQuestions.length === 0) return
    setEditingQuestions(true)
    try {
      await live.updateSession(sessionId, { shoe_game_questions: customQuestions })
      await mutateSession()
      toast.success(t('weddingPanels.questionsSaved'))
    } catch (e: any) {
      toast.error(e?.message ?? t('weddingPanels.saveError'))
    } finally {
      setEditingQuestions(false)
    }
  }

  const resetQuestionsToDefault = async () => {
    setEditingQuestions(true)
    try {
      await live.updateSession(sessionId, { shoe_game_questions: null })
      await mutateSession()
      setCustomQuestions(DEFAULT_SHOE_QUESTIONS)
      toast.success(t('weddingPanels.questionsRestored'))
    } catch (e: any) {
      toast.error(e?.message ?? t('weddingPanels.genericError'))
    } finally {
      setEditingQuestions(false)
    }
  }

  return (
    <WeddingCard tone="active">
      <h2 className="font-wedding text-2xl font-semibold text-[#2B2424] mb-2 inline-flex items-center gap-2">
        <Footprints className="h-5 w-5 text-[#8F1D2C]" /> {t('weddingPanels.shoeGameTitle')}
      </h2>
      <p className="text-xs text-[#6F6260] mb-5">
        {t('weddingPanels.shoeGameDesc')}
      </p>

      {isActive && questions.length > 0 && (
        <div className="rounded-2xl border-2 border-[#E8B7C8] bg-white p-8 text-center mb-5 shadow-lg">
          <p className="text-[10px] uppercase tracking-[0.28em] text-[#8F1D2C] mb-3 font-semibold">
            {t('weddingPanels.question')} {currentIndex + 1}/{questions.length}
          </p>
          <p className="text-3xl font-semibold text-[#2B2424] leading-tight">{questions[currentIndex]}</p>
        </div>
      )}

      <div className="flex gap-2 flex-wrap mb-5">
        <WeddingButton onClick={start} variant="outline" loading={busy} icon={<Play className="h-4 w-4" />}>
          {isActive ? t('weddingPanels.restartGame') : t('weddingPanels.startGame')}
        </WeddingButton>
        <WeddingButton
          onClick={next}
          variant="gold"
          loading={busy}
          disabled={!isActive || currentIndex >= questions.length - 1}
          icon={<SkipForward className="h-4 w-4" />}
        >
          {t('weddingPanels.nextQuestion')}
        </WeddingButton>
        <WeddingButton onClick={reset} variant="ghost" icon={<RotateCw className="h-4 w-4" />}>
          {t('weddingPanels.reset')}
        </WeddingButton>
        <button
          onClick={() => {
            setShowQuestionsEditor(!showQuestionsEditor)
            if (!showQuestionsEditor && loadedQuestions) {
              setCustomQuestions(loadedQuestions)
            } else if (!showQuestionsEditor) {
              setCustomQuestions(DEFAULT_SHOE_QUESTIONS)
            }
          }}
          className="text-xs text-wedding-taupe hover:underline"
        >
          {showQuestionsEditor ? t('weddingPanels.close') : t('weddingPanels.customizeQuestions')}
        </button>
      </div>

      {showQuestionsEditor && (
        <div className="mb-5 p-4 rounded-xl bg-white border border-wedding-champagne">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-wedding-ink">{t('weddingPanels.editQuestions')}</h3>
            <div className="flex gap-2">
              <button onClick={resetQuestionsToDefault} disabled={editingQuestions} className="text-xs text-wedding-taupe hover:underline">
                {t('weddingPanels.resetDefault')}
              </button>
              <button
                onClick={saveCustomQuestions}
                disabled={editingQuestions || customQuestions.length === 0}
                className="text-xs px-3 py-1 bg-wedding-gold text-white rounded-lg hover:bg-wedding-gold/90 disabled:opacity-50"
              >
                {editingQuestions ? t('weddingPanels.saving') : t('weddingPanels.save')}
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {customQuestions.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs tabular-nums w-6 text-wedding-gold">{i + 1}.</span>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => {
                    const newQuestions = [...customQuestions]
                    newQuestions[i] = e.target.value
                    setCustomQuestions(newQuestions)
                  }}
                  className="flex-1 px-3 py-2 text-sm border border-wedding-champagne rounded-lg focus:outline-none focus:ring-2 focus:ring-wedding-gold"
                />
                <button
                  onClick={() => {
                    setCustomQuestions(customQuestions.filter((_, idx) => idx !== i))
                  }}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setCustomQuestions([...customQuestions, t('weddingPanels.newQuestion')])}
            className="mt-3 text-xs text-wedding-gold hover:underline flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> {t('weddingPanels.addQuestion')}
          </button>
        </div>
      )}

      {questions.length > 0 && (
        <ol className="space-y-1 text-sm">
          {questions.map((q, i) => {
            const done = isActive && i < currentIndex
            const current = isActive && i === currentIndex
            return (
              <li key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                current ? 'bg-wedding-gold/20 border border-wedding-gold/50 font-semibold text-wedding-ink'
                : done ? 'text-wedding-ink/40 line-through'
                : 'text-wedding-ink/70'
              }`}>
                <span className="text-[11px] tabular-nums w-6 text-wedding-gold">{i + 1}.</span>
                <span className="flex-1">{q}</span>
                {current && <Sparkles className="h-3.5 w-3.5 text-wedding-gold shrink-0" />}
              </li>
            )
          })}
        </ol>
      )}
    </WeddingCard>
  )
}

function StandUpGuessPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const { data: session, mutate: mutateSession } = useSWR(['session', sessionId], () => live.getSession(sessionId))
  const [busy, setBusy] = useState(false)
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null)
  const [roundDrafts, setRoundDrafts] = useState<Record<string, { guest_instruction: string; answer: string; hint: string }>>({})

  const cfg = normalizeStandUpGuessConfig(session?.screen_config?.stand_up_guess)
  const rounds = [...cfg.rounds].sort((a, b) => a.order - b.order)
  const enabledRounds = rounds.filter((round) => round.enabled)
  const currentByIdIndex = enabledRounds.findIndex((round) => round.id === cfg.current_round_id)
  const clampedEnabledIndex = enabledRounds.length > 0
    ? Math.min(Math.max(Number(cfg.current_index ?? 0), 0), enabledRounds.length - 1)
    : -1
  const currentIndex = currentByIdIndex >= 0 ? currentByIdIndex : clampedEnabledIndex
  const currentRound = currentIndex >= 0 ? enabledRounds[currentIndex] : null

  const persist = async (next: StandUpGuessConfig, successToast?: string) => {
    setBusy(true)
    try {
      const currentScreenConfig = session?.screen_config ?? {}
      await live.updateSession(sessionId, {
        screen_config: {
          ...currentScreenConfig,
          stand_up_guess: {
            ...next,
            updated_at: new Date().toISOString(),
          },
        },
      })
      await mutateSession()
      if (successToast) toast.success(successToast)
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const updateRounds = async (nextRounds: StandUpGuessRound[]) => {
    const sorted = [...nextRounds].sort((a, b) => a.order - b.order).map((round, index) => ({ ...round, order: index }))
    const nextEnabled = sorted.filter((round) => round.enabled)
    const safeCurrentId = nextEnabled.find((round) => round.id === cfg.current_round_id)?.id
      ?? nextEnabled[Math.min(Math.max(cfg.current_index, 0), Math.max(nextEnabled.length - 1, 0))]?.id
      ?? null
    const safeCurrentIndex = safeCurrentId ? nextEnabled.findIndex((round) => round.id === safeCurrentId) : 0
    await persist({
      ...cfg,
      rounds: sorted,
      current_index: Math.max(safeCurrentIndex, 0),
      current_round_id: safeCurrentId,
    })
  }

  const startOrNext = async () => {
    if (enabledRounds.length === 0) {
      toast.error(t('weddingPanels.standUpGuessNoRounds'))
      return
    }

    const isNotStarted = cfg.status === 'idle' || cfg.status === 'finished' || currentIndex < 0
    if (isNotStarted) {
      const firstRound = enabledRounds[0]
      await persist({
        ...cfg,
        status: 'instruction',
        current_round_id: firstRound.id,
        current_index: 0,
      }, t('weddingPanels.standUpGuessStarted'))
      return
    }

    const nextIndex = currentIndex + 1
    if (nextIndex >= enabledRounds.length) {
      await persist({
        ...cfg,
        status: 'finished',
        current_round_id: enabledRounds[Math.max(enabledRounds.length - 1, 0)]?.id ?? null,
        current_index: Math.max(enabledRounds.length - 1, 0),
      })
      return
    }

    const nextRound = enabledRounds[nextIndex]
    await persist({
      ...cfg,
      status: 'instruction',
      current_round_id: nextRound.id,
      current_index: nextIndex,
    })
  }

  const goToRound = async (direction: -1 | 1) => {
    if (!enabledRounds.length) return
    const idx = currentIndex + direction
    if (idx < 0 || idx >= enabledRounds.length) return
    await persist({
      ...cfg,
      status: 'instruction',
      current_index: idx,
      current_round_id: enabledRounds[idx].id,
    })
  }

  const markAnswer = async (_kind: 'guessed' | 'missed') => {
    const score = {
      guessed: cfg.score.guessed + (_kind === 'guessed' ? 1 : 0),
      missed: cfg.score.missed + (_kind === 'missed' ? 1 : 0),
    }
    await persist({ ...cfg, score })
  }
  void markAnswer
  const resetGame = async () => {
    const firstEnabled = enabledRounds[0] ?? null
    await persist({
      ...cfg,
      status: 'idle',
      current_index: 0,
      current_round_id: firstEnabled?.id ?? null,
      score: { guessed: 0, missed: 0 },
    }, t('weddingPanels.standUpGuessResetDone'))
  }

  const setEnabled = async (enabled: boolean) => {
    await persist({ ...cfg, enabled })
  }

  const addRound = async () => {
    const next: StandUpGuessRound = {
      id: makeStandUpRoundId(),
      guest_instruction: t('weddingPanels.standUpGuessInstructionSeed'),
      answer: t('weddingPanels.standUpGuessAnswerSeed'),
      hint: '',
      enabled: true,
      order: rounds.length,
    }
    await updateRounds([...rounds, next])
    setEditingRoundId(next.id)
  }

  const updateRound = async (id: string, patch: Partial<StandUpGuessRound>) => {
    const nextRounds = rounds.map((round) => round.id === id ? { ...round, ...patch } : round)
    await updateRounds(nextRounds)
  }

  const deleteRound = async (id: string) => {
    const nextRounds = rounds.filter((round) => round.id !== id)
    await updateRounds(nextRounds)
  }

  const moveRound = async (id: string, direction: -1 | 1) => {
    const idx = rounds.findIndex((round) => round.id === id)
    if (idx < 0) return
    const target = idx + direction
    if (target < 0 || target >= rounds.length) return
    const reordered = [...rounds]
    const [item] = reordered.splice(idx, 1)
    reordered.splice(target, 0, item)
    await updateRounds(reordered)
  }

  const statusLabel: Record<StandUpGuessStatus, string> = {
    idle: t('weddingPanels.standUpGuessStateIdle'),
    instruction: t('weddingPanels.standUpGuessStateActive'),
    guessing: t('weddingPanels.standUpGuessStateActive'),
    reveal: t('weddingPanels.standUpGuessStateActive'),
    finished: t('weddingPanels.standUpGuessStateFinished'),
  }

  return (
    <WeddingCard tone="active">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="font-wedding text-2xl font-semibold text-[#2B2424] inline-flex items-center gap-2">
            <Users className="h-5 w-5 text-[#8F1D2C]" /> {t('weddingPanels.standUpGuessName')}
          </h2>
          <p className="text-xs text-[#6F6260] mt-1">{t('weddingPanels.standUpGuessSubtitle')}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-[#2B2424] bg-white border border-[#E8B7C8] rounded-full px-3 py-1.5">
          <input
            type="checkbox"
            checked={cfg.enabled === true}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy}
            className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
          />
          {t('weddingPanels.standUpGuessShowOnScreen')}
        </label>
      </div>

      <div className="rounded-xl border border-[#E8B7C8] bg-white p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8F1D2C] font-semibold">
            {t('weddingPanels.standUpGuessStatus')}: <span className="normal-case tracking-normal text-[#2B2424]">{statusLabel[cfg.status]}</span>
          </p>
          <p className="text-[11px] text-[#6F6260]">
            {t('weddingPanels.standUpGuessScore')}: {cfg.score.guessed} / {cfg.score.guessed + cfg.score.missed}
          </p>
        </div>

        <div className="mt-3 rounded-lg border border-[#F0D7E2] bg-[#FBEAF0]/35 px-3 py-3">
          {currentRound ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#8F1D2C] font-semibold mb-1">
                {t('weddingPanels.standUpGuessCurrentRound')} {Math.max(currentIndex + 1, 1)} / {Math.max(enabledRounds.length, 1)}
              </p>
              <p className="text-sm text-[#2B2424]"><strong>{t('weddingPanels.standUpGuessGuestInstructionLabel')}:</strong> {currentRound.guest_instruction}</p>
              <p className="text-sm text-[#2B2424] mt-1"><strong>{t('weddingPanels.standUpGuessAnswerLabel')}:</strong> {currentRound.answer || t('weddingPanels.standUpGuessAnswerMissing')}</p>
              {currentRound.hint && <p className="text-xs text-[#6F6260] mt-1"><strong>{t('weddingPanels.standUpGuessHintLabel')}:</strong> {currentRound.hint}</p>}
            </>
          ) : (
            <p className="text-sm text-[#6F6260]">{t('weddingPanels.standUpGuessNoRounds')}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <WeddingButton
            onClick={() => goToRound(-1)}
            variant="ghost"
            loading={busy}
            disabled={currentIndex <= 0}
            icon={<ArrowLeft className="h-4 w-4" />}
          >
            {t('weddingPanels.standUpGuessBack')}
          </WeddingButton>
          <WeddingButton
            onClick={startOrNext}
            variant="outline"
            loading={busy}
            disabled={enabledRounds.length === 0}
            icon={cfg.status === 'idle' || cfg.status === 'finished' ? <Play className="h-4 w-4" /> : <SkipForward className="h-4 w-4" />}
          >
            {t('weddingPanels.standUpGuessNextRound')}
          </WeddingButton>
          <WeddingButton onClick={resetGame} variant="ghost" loading={busy} icon={<RotateCw className="h-4 w-4" />}>
            {t('weddingPanels.standUpGuessReset')}
          </WeddingButton>
        </div>
      </div>

      <div className="rounded-xl border border-[#E8B7C8] bg-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8F1D2C] font-semibold">
            {t('weddingPanels.standUpGuessRoundsTitle')}
          </p>
          <WeddingButton onClick={addRound} size="sm" variant="outline" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>
            {t('weddingPanels.standUpGuessAddRound')}
          </WeddingButton>
        </div>

        {rounds.length === 0 && (
          <p className="text-sm text-[#6F6260]">{t('weddingPanels.standUpGuessNoRounds')}</p>
        )}

        <div className="space-y-2">
          {rounds.map((round, index) => {
            const editing = editingRoundId === round.id
            return (
              <div key={round.id} className="rounded-lg border border-[#E8B7C8] p-3 bg-[#FFFDFB]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[#8F1D2C] font-semibold">
                      {t('weddingPanels.standUpGuessRoundLabel')} {index + 1}
                    </p>
                    {!editing && (
                      <>
                        <p className="text-sm text-[#2B2424] mt-1"><strong>{t('weddingPanels.standUpGuessGuestInstructionLabel')}:</strong> {round.guest_instruction}</p>
                        <p className="text-sm text-[#2B2424] mt-1"><strong>{t('weddingPanels.standUpGuessAnswerLabel')}:</strong> {round.answer}</p>
                        {round.hint && <p className="text-xs text-[#6F6260] mt-1"><strong>{t('weddingPanels.standUpGuessHintLabel')}:</strong> {round.hint}</p>}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="inline-flex items-center gap-1 text-[11px] text-[#6F6260] mr-1">
                      <input
                        type="checkbox"
                        checked={round.enabled}
                        onChange={(e) => updateRound(round.id, { enabled: e.target.checked })}
                        disabled={busy}
                        className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
                      />
                      {t('weddingPanels.standUpGuessEnabled')}
                    </label>
                    <button type="button" onClick={() => moveRound(round.id, -1)} disabled={busy || index === 0} className="p-1.5 rounded hover:bg-[#FBEAF0] disabled:opacity-40">
                      <span className="sr-only">{t('weddingPanels.standUpGuessMoveUp')}</span>
                      ↑
                    </button>
                    <button type="button" onClick={() => moveRound(round.id, 1)} disabled={busy || index >= rounds.length - 1} className="p-1.5 rounded hover:bg-[#FBEAF0] disabled:opacity-40">
                      <span className="sr-only">{t('weddingPanels.standUpGuessMoveDown')}</span>
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (editing) {
                          setEditingRoundId(null)
                          return
                        }
                        setRoundDrafts((prev) => ({
                          ...prev,
                          [round.id]: {
                            guest_instruction: round.guest_instruction,
                            answer: round.answer,
                            hint: round.hint ?? '',
                          },
                        }))
                        setEditingRoundId(round.id)
                      }}
                      className="p-1.5 rounded hover:bg-[#FBEAF0] text-xs"
                    >
                      {editing ? t('weddingPanels.close') : t('weddingPanels.editQuestions')}
                    </button>
                    <button type="button" onClick={() => deleteRound(round.id)} disabled={busy} className="p-1.5 rounded hover:bg-[#FBEAF0] text-[#8F1D2C]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {editing && (
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <WeddingInput
                      value={roundDrafts[round.id]?.guest_instruction ?? ''}
                      onChange={(e) => setRoundDrafts((prev) => ({
                        ...prev,
                        [round.id]: {
                          guest_instruction: e.target.value,
                          answer: prev[round.id]?.answer ?? round.answer,
                          hint: prev[round.id]?.hint ?? (round.hint ?? ''),
                        },
                      }))}
                      placeholder={t('weddingPanels.standUpGuessGuestInstructionPlaceholder')}
                    />
                    <WeddingInput
                      value={roundDrafts[round.id]?.answer ?? ''}
                      onChange={(e) => setRoundDrafts((prev) => ({
                        ...prev,
                        [round.id]: {
                          guest_instruction: prev[round.id]?.guest_instruction ?? round.guest_instruction,
                          answer: e.target.value,
                          hint: prev[round.id]?.hint ?? (round.hint ?? ''),
                        },
                      }))}
                      placeholder={t('weddingPanels.standUpGuessAnswerPlaceholder')}
                    />
                    <WeddingInput
                      value={roundDrafts[round.id]?.hint ?? ''}
                      onChange={(e) => setRoundDrafts((prev) => ({
                        ...prev,
                        [round.id]: {
                          guest_instruction: prev[round.id]?.guest_instruction ?? round.guest_instruction,
                          answer: prev[round.id]?.answer ?? round.answer,
                          hint: e.target.value,
                        },
                      }))}
                      placeholder={t('weddingPanels.standUpGuessHintPlaceholder')}
                    />
                    <div>
                      <WeddingButton
                        size="sm"
                        variant="outline"
                        loading={busy}
                        onClick={async () => {
                          const draft = roundDrafts[round.id]
                          if (!draft) return
                          await updateRound(round.id, {
                            guest_instruction: draft.guest_instruction,
                            answer: draft.answer,
                            hint: draft.hint,
                          })
                          setEditingRoundId(null)
                        }}
                      >
                        {t('weddingPanels.save')}
                      </WeddingButton>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </WeddingCard>
  )
}

function PollsPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  // Realtime change signal (Firestore: polls + tally of open polls) → re-fetch of the authoritative legacy list.
  const pollSignal = usePollsSignal(sessionId)
  const { data: polls, mutate: refresh } = useSWR(
    ['polls', sessionId],
    () => livePolls.list(sessionId),
    { refreshInterval: pollSignal.live ? 60_000 : 6_000 },
  )
  useEffect(() => { if (pollSignal.tick > 0) refresh() }, [pollSignal.tick, refresh])
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [creating, setCreating] = useState(false)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = options.map((o) => o.trim()).filter(Boolean)
    if (!question.trim() || trimmed.length < 2) return
    setCreating(true)
    try {
      await livePolls.create(sessionId, { question: question.trim(), options: trimmed })
      setQuestion(''); setOptions(['', ''])
      refresh()
    } catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
    finally { setCreating(false) }
  }
  const toggle = async (p: LivePoll) => {
    try { await livePolls.setActive(p.id, !p.is_active); refresh() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }

  return (
    <WeddingCard tone="ivory">
      <h2 className="font-wedding text-2xl font-semibold text-[#2B2424] mb-3 inline-flex items-center gap-2">
        <ListChecks className="h-5 w-5 text-[#8F1D2C]" /> {t('wedding.polls.title')}
      </h2>

      <form onSubmit={create} className="space-y-2 mb-5 rounded-2xl border border-wedding-champagne/60 bg-white/60 p-4">
        <p className="text-[11px] uppercase tracking-[0.22em] text-wedding-gold mb-1">{t('wedding.polls.newPoll')}</p>
        <WeddingInput value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('wedding.polls.question')} />
        {options.map((opt, i) => (
          <WeddingInput key={i} value={opt}
            onChange={(e) => setOptions(options.map((o, j) => j === i ? e.target.value : o))}
            placeholder={`${t('weddingPanels.option')} ${i + 1}`} />
        ))}
        <div className="flex gap-2 pt-1">
          {options.length < 4 && (
            <WeddingButton type="button" variant="ghost" size="sm" icon={<Plus className="h-3 w-3" />}
              onClick={() => setOptions([...options, ''])}>{t('wedding.polls.addOption')}</WeddingButton>
          )}
          <WeddingButton type="submit" size="sm" loading={creating}>{t('common.submit')}</WeddingButton>
        </div>
      </form>

      <div className="space-y-2">
        {(polls ?? []).map((p) => (
          <div key={p.id} className="rounded-xl border border-wedding-champagne/50 bg-white/50 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-wedding text-lg text-wedding-ink truncate italic">{p.question}</p>
              <p className="text-xs text-wedding-ink/50">{p.options.join(' · ')}</p>
            </div>
            <WeddingButton size="sm" variant={p.is_active ? 'gold' : 'outline'} onClick={() => toggle(p)}>
              {p.is_active ? t('wedding.polls.close') : t('common.open')}
            </WeddingButton>
          </div>
        ))}
      </div>
    </WeddingCard>
  )
}

// ════════════════════════════════════════════════════════════════
// PARTY DASHBOARD — for session_type === 'party'
// Tabs: Richieste · Live Booth · Music Battle · Party Games · Screen
// ════════════════════════════════════════════════════════════════

const PARTY_PRESETS: Array<{ q: string; opts: [string, string] }> = [
  { q: 'Anni 90 vs Anni 2000',          opts: ['Anni 90', 'Anni 2000'] },
  { q: 'Latino vs Commerciale',         opts: ['Latino', 'Commerciale'] },
  { q: 'House vs Revival',              opts: ['House', 'Revival'] },
  { q: 'Dance vs Reggaeton',            opts: ['Dance', 'Reggaeton'] },
  { q: 'Uomo Ragno vs Nord Sud Ovest Est', opts: ['Uomo Ragno', 'Nord Sud Ovest Est'] },
]

const PARTY_PENITENZE_DEFAULT = [
  'Tutti in pista!',
  'Brindisi generale',
  'Foto di gruppo con il DJ',
  'Canta il ritornello al microfono',
  'Scegli un amico e ballate insieme',
  'Il tavolo più rumoroso vince un drink',
  'Sfida di applausi',
  'Il DJ sceglie la prossima hit',
]

function PartyDashboard({
  session, isFree, hasAccess, pending, approved, rejected, busyId,
  togglingActive, onToggleActive, onDeleteSession,
  onUpdateRequest, onDeleteRequest,
}: any) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'requests' | 'booth' | 'battle' | 'games' | 'screen' | 'guests'>('requests')

  const origin = publicOriginFor('party')
  const liveUrl = `${origin}/live/${session.public_slug}`
  const boothUrl = `${origin}/booth/${session.public_slug}`
  const screenUrl = `${origin}/screen/${session.public_slug}`

  const copy = (url: string, label = 'Link copiato') => {
    navigator.clipboard.writeText(url).then(() => toast.success(label)).catch(() => {})
  }

  return (
    <PartyShell>
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-4">
          <Link href="/sessions" className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white">
            <ArrowLeft className="h-3 w-3" /> {t('common.back')}
          </Link>
        </div>

        {/* TOP BAR */}
        <PartyCard tone="hi" className="mb-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <PartyLivePill live={session.is_active} label={session.is_active ? 'LIVE' : 'CHIUSA'} />
                <PartyEyebrow>Party Mode</PartyEyebrow>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-[#F8F8FA] mt-2 leading-tight truncate">{session.event_name}</h1>
              {session.dj_name && <p className="text-sm text-[#9A9AA3] mt-1">DJ {session.dj_name}</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <PartyButton variant="outline" size="sm" onClick={() => copy(liveUrl)} icon={<Copy className="h-3.5 w-3.5" />}>Copia link</PartyButton>
              <PartyButton variant="outline" size="sm" loading={togglingActive} onClick={onToggleActive}
                icon={<Power className="h-3.5 w-3.5" />}>
                {session.is_active ? t('common.close') : t('common.open')}
              </PartyButton>
              <PartyButton variant="ghost" size="sm" onClick={onDeleteSession} icon={<Trash2 className="h-3.5 w-3.5" />}>
                {t('common.delete')}
              </PartyButton>
              <a href={screenUrl} target="_blank" rel="noreferrer">
                <PartyButton variant="fuchsia" size="sm" icon={<Tv className="h-3.5 w-3.5" />}>Apri Schermo</PartyButton>
              </a>
            </div>
          </div>

          <PartyDivider className="my-5" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <PartyLinkRow label="Pagina Live" desc="Link ospiti per partecipare" url={liveUrl} onCopy={() => copy(liveUrl)} />
            <PartyLinkRow label="Live Booth" desc="Foto live dagli ospiti" url={boothUrl} onCopy={() => copy(boothUrl)} />
            <PartyLinkRow label="Schermo TV" desc="Apri sul TV o proiettore" url={screenUrl} onCopy={() => copy(screenUrl)} external />
          </div>
        </PartyCard>

        {/* STATS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <PartyStat icon={<Music2 className="h-4 w-4" />} label="In attesa" value={pending.length.toString()} pulse={pending.length > 0} accent={pending.length > 0} />
          <PartyStat icon={<Music2 className="h-4 w-4" />} label="Richieste" value={(pending.length + approved.length + rejected.length).toString()} />
          <PartyStatPhotos sessionId={session.id} />
          <PartyStatPolls sessionId={session.id} />
        </div>

        {/* TABS */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <PartyTabBtn active={tab === 'requests'} onClick={() => setTab('requests')} icon={<Music2 className="h-3.5 w-3.5" />}>Richieste {pending.length > 0 && <span className="ml-1 text-[10px] text-[#FF2D8D]">({pending.length})</span>}</PartyTabBtn>
          <PartyTabBtn active={tab === 'booth'} onClick={() => setTab('booth')} icon={<Camera className="h-3.5 w-3.5" />}>Live Booth</PartyTabBtn>
          <PartyTabBtn active={tab === 'battle'} onClick={() => setTab('battle')} icon={<ListChecks className="h-3.5 w-3.5" />}>Music Battle</PartyTabBtn>
          <PartyTabBtn active={tab === 'games'} onClick={() => setTab('games')} icon={<Sparkles className="h-3.5 w-3.5" />}>Party Games</PartyTabBtn>
          <PartyTabBtn active={tab === 'screen'} onClick={() => setTab('screen')} icon={<Tv className="h-3.5 w-3.5" />}>Schermo</PartyTabBtn>
          <PartyTabBtn active={tab === 'guests'} onClick={() => setTab('guests')} icon={<Users className="h-3.5 w-3.5" />}>{t('guestVisibility.tab')}</PartyTabBtn>
        </div>

        {/* QR card on the right (visible on requests tab only, to keep things focused) */}
        {tab === 'requests' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-1 space-y-5">
              <PartyCard>
                <PartyEyebrow>QR per i guests</PartyEyebrow>
                <div className="bg-white p-3 rounded-2xl mt-3 mx-auto w-fit">
                  <QRCodeSVG value={liveUrl} size={170} level="M" />
                </div>
                <p className="mt-3 text-xs text-center text-white/60">Link ospiti per partecipare</p>
                <PartyButton variant="outline" size="sm" className="w-full mt-3" onClick={() => copy(liveUrl)} icon={<Copy className="h-3.5 w-3.5" />}>
                  Copia link
                </PartyButton>
              </PartyCard>
              <PartyActivity items={[...pending, ...approved, ...rejected]} />
            </div>
            <div className="lg:col-span-2">
              <RequestsPanel
                pending={pending} approved={approved} rejected={rejected}
                busyId={busyId} isFree={isFree}
                onUpdate={onUpdateRequest} onDelete={onDeleteRequest}
              />
            </div>
          </div>
        )}

        {tab === 'booth' && <PartyBoothPanel session={session} boothUrl={boothUrl} onCopy={() => copy(boothUrl)} isFree={isFree} />}
        {tab === 'battle' && <PartyBattlePanel sessionId={session.id} isFree={isFree} />}
        {tab === 'games' && <PartyGamesPanel session={session} isFree={isFree} onJumpToBattle={() => setTab('battle')} />}
        {tab === 'screen' && <PartyScreenPanel session={session} screenUrl={screenUrl} />}
        {tab === 'guests' && <GuestVisibilityPanel sessionId={session.id} session={session} sessionType="party" hasAccess={hasAccess} />}
      </div>
    </PartyShell>
  )
}

function PartyActivity({ items }: { items: any[] }) {
  const recent = [...items].sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at)).slice(0, 6)
  const dot: Record<string, string> = { pending: 'bg-[#F4FF3A]', approved: 'bg-[#43E08D]', rejected: 'bg-[#FF5C75]' }
  return (
    <PartyCard>
      <PartyEyebrow>Attività live</PartyEyebrow>
      {recent.length === 0 ? (
        <p className="mt-3 text-sm text-[#9A9AA3]">Nessuna attività ancora.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {recent.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot[r.status] ?? 'bg-[#9A9AA3]'}`} />
              <span className="min-w-0 flex-1 truncate text-[#F8F8FA]">{r.track_title}</span>
              <span className="shrink-0 text-[11px] text-[#9A9AA3]">{formatRelativeTime(r.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </PartyCard>
  )
}

function PartyTabBtn({ active, onClick, icon, children }: any) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors border ${
        active ? 'bg-[#FF2D8D] text-white border-transparent'
               : 'bg-[#15151B] text-[#9A9AA3] border-[#2A2A33] hover:text-white hover:border-[#FF2D8D]/50'
      }`}>
      {icon}{children}
    </button>
  )
}

function PartyLinkRow({ label, desc, url, onCopy, external }: { label: string; desc: string; url: string; onCopy: () => void; external?: boolean }) {
  return (
    <div className="rounded-xl bg-[#0A0A0D] border border-[#2A2A33] p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#FF2D8D]">{label}</p>
      <p className="text-xs text-white/60 mt-1">{desc}</p>
      <div className="flex gap-1.5 mt-2">
        <button onClick={onCopy} className="text-[10px] px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 inline-flex items-center gap-1">
          <Copy className="h-3 w-3" /> Copia
        </button>
        {external && (
          <a href={url} target="_blank" rel="noreferrer" className="text-[10px] px-2.5 py-1 rounded-md bg-[#FF2D8D]/20 border border-[#FF2D8D]/40 text-[#FF2D8D] hover:bg-[#FF2D8D]/30 inline-flex items-center gap-1">
            <Tv className="h-3 w-3" /> Apri
          </a>
        )}
      </div>
    </div>
  )
}

function PartyStat({ icon, label, value, hint, pulse, accent }: { icon: React.ReactNode; label: string; value: string; hint?: string; pulse?: boolean; accent?: boolean }) {
  return (
    <div className={`relative rounded-2xl bg-[#15151B] border p-5 ${pulse ? 'notify-pulse-party border-[#FF2D8D]' : 'border-[#2A2A33]'}`}>
      <div className="flex items-center gap-2 text-[#9A9AA3]">{icon}<span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span></div>
      <p className={`text-4xl font-black mt-2 tabular-nums ${accent ? 'text-[#F4FF3A]' : 'text-[#F8F8FA]'}`}>{value}</p>
      {hint && <p className="text-[11px] text-[#9A9AA3] mt-1">{hint}</p>}
    </div>
  )
}

function PartyStatPhotos({ sessionId }: { sessionId: string }) {
  const { data } = useSWR(['booth-photos', sessionId], () => livePhotos.listBoothPhotos(sessionId).catch(() => []), { refreshInterval: 8_000 })
  const pendingCount = (data ?? []).filter((p) => p.status === 'pending').length
  return <PartyStat icon={<Camera className="h-4 w-4" />} label="Foto Booth" value={String(data?.length ?? 0)} pulse={pendingCount > 0} />
}

function PartyStatPolls({ sessionId }: { sessionId: string }) {
  const pollSignal = usePollsSignal(sessionId)
  const { data, mutate: refreshPolls } = useSWR(['polls', sessionId], () => livePolls.list(sessionId).catch(() => []), { refreshInterval: pollSignal.live ? 60_000 : 8_000 })
  useEffect(() => { if (pollSignal.tick > 0) refreshPolls() }, [pollSignal.tick, refreshPolls])
  const active = (data ?? []).filter((p) => p.is_active).length
  return <PartyStat icon={<ListChecks className="h-4 w-4" />} label="Battle attive" value={String(active)} />
}

// ─────────────── BOOTH PANEL ───────────────
function PartyBoothPanel({ session, boothUrl, onCopy, isFree }: any) {
  const { data: photos, mutate: refreshPhotos } = useSWR(
    ['booth-photos', session.id],
    () => livePhotos.listBoothPhotos(session.id),
    { refreshInterval: 5_000 },
  )

  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    try { await livePhotos.setStatus(id, status); await refreshPhotos() } catch (e: any) { toast.error(e?.message ?? 'Errore') }
  }
  const setFeatured = async (id: string, v: boolean) => {
    try { await livePhotos.setFeatured(id, v); await refreshPhotos() } catch (e: any) { toast.error(e?.message ?? 'Errore') }
  }
  const remove = async (id: string) => {
    if (!confirm('Eliminare definitivamente questa foto?')) return
    try { await livePhotos.remove(id); await refreshPhotos() } catch (e: any) { toast.error(e?.message ?? 'Errore') }
  }

  if (isFree) return <PartyPaywall title="Live Booth bloccato" message="Attiva un Event Pass 24H o passa al piano Advance per sbloccare il Live Booth." />

  const pending = (photos ?? []).filter((p: any) => p.status === 'pending')
  const approved = (photos ?? []).filter((p: any) => p.status === 'approved')

  return (
    <div className="space-y-5">
      <PartyCard tone="fuchsia">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="h-16 w-16 rounded-2xl bg-white/20 flex items-center justify-center"><Camera className="h-8 w-8 text-white" /></div>
          <div className="flex-1 min-w-[200px]">
            <PartyEyebrow>Live Booth</PartyEyebrow>
            <p className="text-sm text-white/70 mt-1">Foto live dagli ospiti</p>
          </div>
          <div className="flex gap-2">
            <PartyButton variant="outline" size="sm" onClick={onCopy} icon={<Copy className="h-3.5 w-3.5" />}>Copia</PartyButton>
            <a href={boothUrl} target="_blank" rel="noreferrer">
              <PartyButton variant="fuchsia" size="sm" icon={<Camera className="h-3.5 w-3.5" />}>Apri</PartyButton>
            </a>
          </div>
        </div>
      </PartyCard>

      {pending.length > 0 && (
        <PartyCard>
          <PartyEyebrow>In attesa di approvazione ({pending.length})</PartyEyebrow>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 mt-4">
            {pending.map((p: any) => (
              <PartyPhotoTile key={p.id} photo={p} onApprove={() => setStatus(p.id, 'approved')} onReject={() => setStatus(p.id, 'rejected')} onRemove={() => remove(p.id)} onFeature={() => setFeatured(p.id, !p.is_featured)} />
            ))}
          </div>
        </PartyCard>
      )}

      <PartyCard>
        <PartyEyebrow>Approvate ({approved.length})</PartyEyebrow>
        {approved.length === 0 ? (
          <p className="text-sm text-white/40 italic mt-3">Nessuna foto approvata ancora.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 mt-4">
            {approved.map((p: any) => (
              <PartyPhotoTile key={p.id} photo={p} onReject={() => setStatus(p.id, 'rejected')} onRemove={() => remove(p.id)} onFeature={() => setFeatured(p.id, !p.is_featured)} approved />
            ))}
          </div>
        )}
      </PartyCard>
    </div>
  )
}

function PartyPhotoTile({ photo, onApprove, onReject, onRemove, onFeature, approved }: any) {
  return (
    <div className={`relative rounded-xl overflow-hidden border ${photo.is_featured ? 'border-white/20' : 'border-white/10'} bg-black/30 group`}>
      <div className="aspect-[4/5]">
        {photo.url && <img src={photo.url} alt="" className="w-full h-full object-cover [object-position:center_35%]" />}
      </div>
      {photo.is_featured && (
        <span className="absolute top-1.5 left-1.5 bg-[#FF2D8D] text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
          <Star className="h-2.5 w-2.5 fill-current" /> Top
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/90 to-transparent flex gap-1">
        {onApprove && <button onClick={onApprove} title="Approva" className="flex-1 p-1.5 rounded bg-emerald-500/80 text-white hover:bg-emerald-500"><Check className="h-3 w-3 mx-auto" /></button>}
        {onFeature && <button onClick={onFeature} title="In evidenza" className={`flex-1 p-1.5 rounded ${photo.is_featured ? 'bg-[#FF2D8D]' : 'bg-white/20 hover:bg-white/30'} text-white`}><Star className="h-3 w-3 mx-auto" /></button>}
        {onReject && <button onClick={onReject} title={approved ? 'Rifiuta' : 'Scarta'} className="flex-1 p-1.5 rounded bg-amber-500/80 text-white hover:bg-amber-500"><X className="h-3 w-3 mx-auto" /></button>}
        {onRemove && <button onClick={onRemove} title="Elimina" className="flex-1 p-1.5 rounded bg-red-500/80 text-white hover:bg-red-500"><Trash2 className="h-3 w-3 mx-auto" /></button>}
      </div>
    </div>
  )
}

// ─────────────── MUSIC BATTLE PANEL ───────────────
function PartyBattlePanel({ sessionId, isFree }: { sessionId: string; isFree: boolean }) {
  const pollSignal = usePollsSignal(sessionId)
  const { data: polls, mutate: refresh } = useSWR(['polls', sessionId], () => livePolls.list(sessionId), { refreshInterval: pollSignal.live ? 60_000 : 5_000 })
  useEffect(() => { if (pollSignal.tick > 0) refresh() }, [pollSignal.tick, refresh])
  const [customQ, setCustomQ] = useState('')
  const [customA, setCustomA] = useState('')
  const [customB, setCustomB] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async (q: string, opts: string[]) => {
    setCreating(true)
    try {
      await livePolls.create(sessionId, { question: q, options: opts })
      toast.success('Music Battle creata!')
      setCustomQ(''); setCustomA(''); setCustomB('')
      await refresh()
    } catch (e: any) { toast.error(e?.message ?? 'Errore') }
    finally { setCreating(false) }
  }
  const toggle = async (id: string, isActive: boolean) => {
    try { await livePolls.setActive(id, isActive); await refresh() } catch (e: any) { toast.error(e?.message ?? 'Errore') }
  }

  if (isFree) return <PartyPaywall title="Music Battle bloccata" message="Attiva un Event Pass 24H o passa al piano Advance per creare le Music Battle." />

  return (
    <div className="space-y-5">
      <PartyCard tone="wine">
        <PartyEyebrow>⚡ Battaglie preset</PartyEyebrow>
        <p className="text-sm text-white/70 mt-1 mb-4">Lancia una battle in un tap. Il pubblico vota dal telefono.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {PARTY_PRESETS.map((p) => (
            <button key={p.q} disabled={creating} onClick={() => create(p.q, p.opts)}
              className="text-left rounded-xl bg-black/30 hover:bg-black/50 border border-[#FF2D8D]/30 hover:border-[#FF2D8D]/60 p-3 transition disabled:opacity-50">
              <p className="text-sm font-bold text-white">{p.q}</p>
              <p className="text-[11px] text-[#FF2D8D] mt-0.5">{p.opts.join(' · ')}</p>
            </button>
          ))}
        </div>
      </PartyCard>

      <PartyCard>
        <PartyEyebrow>Crea battle personalizzata</PartyEyebrow>
        <div className="mt-3 space-y-2.5">
          <PartyInput placeholder="Domanda (es. Rock vs Pop)" value={customQ} onChange={(e: any) => setCustomQ(e.target.value)} />
          <div className="grid grid-cols-2 gap-2.5">
            <PartyInput placeholder="Opzione A" value={customA} onChange={(e: any) => setCustomA(e.target.value)} />
            <PartyInput placeholder="Opzione B" value={customB} onChange={(e: any) => setCustomB(e.target.value)} />
          </div>
          <PartyButton variant="fuchsia" disabled={!customQ.trim() || !customA.trim() || !customB.trim() || creating} loading={creating}
            onClick={() => create(customQ.trim(), [customA.trim(), customB.trim()])} icon={<Plus className="h-3.5 w-3.5" />}>
            Crea Music Battle
          </PartyButton>
        </div>
      </PartyCard>

      <PartyCard>
        <PartyEyebrow>Storico battle</PartyEyebrow>
        {!polls || polls.length === 0 ? (
          <p className="text-sm text-white/40 italic mt-3">Nessuna battle creata ancora.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {polls.map((p) => {
              const total = (p.tally ?? []).reduce((a, b) => a + b, 0)
              return (
                <div key={p.id} className={`rounded-xl bg-[#0A0A0D] border p-3 ${p.is_active ? 'border-[#FF2D8D]/50' : 'border-[#2A2A33]'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white text-sm">{p.question}</p>
                      <p className="text-[11px] text-white/50 mt-0.5">{p.options.join(' vs ')} · {total} {total === 1 ? 'voto' : 'voti'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <PartyBadge tone={p.is_active ? 'gold' : 'soft'}>{p.is_active ? 'ATTIVA' : 'CHIUSA'}</PartyBadge>
                      <button onClick={() => toggle(p.id, !p.is_active)} className="text-[10px] px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-white hover:bg-white/10">
                        {p.is_active ? 'Chiudi' : 'Riapri'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {p.options.map((opt, i) => {
                      const tally = p.tally?.[i] ?? 0
                      const pct = total > 0 ? Math.round((tally / total) * 100) : 0
                      const lead = total > 0 && tally === Math.max(...(p.tally ?? [0]))
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className={`w-24 sm:w-32 truncate font-semibold ${lead ? 'text-[#F4FF3A]' : 'text-[#F8F8FA]/80'}`}>{opt}</span>
                          <div className="flex-1 h-3 rounded-full bg-[#2A2A33] overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${lead ? 'bg-[#F4FF3A]' : 'bg-[#FF2D8D]'}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-14 text-right font-bold tabular-nums text-[#F8F8FA]">{tally} <span className="text-[#9A9AA3] font-medium">({pct}%)</span></span>
                        </div>
                      )
                    })}
                    {total > 0 && (
                      <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-[#F4FF3A]">
                        {p.is_active ? 'In testa' : 'Vincitore'}: {p.options[(p.tally ?? []).indexOf(Math.max(...(p.tally ?? [0])))]}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </PartyCard>
    </div>
  )
}

// ─────────────── PARTY GAMES PANEL ───────────────
function PartyGamesPanel({ session, isFree, onJumpToBattle }: any) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <PartyRouletteCard session={session} isFree={isFree} />
      <PartyCard tone="wine">
        <div className="flex items-center gap-3">
          <ListChecks className="h-6 w-6 text-[#FF2D8D]" />
          <h3 className="text-lg font-black text-white">Music Battle</h3>
        </div>
        <p className="text-sm text-white/70 mt-2">Sondaggi musicali live con voto dal telefono.</p>
        <PartyButton variant="outline" size="sm" className="mt-4" onClick={onJumpToBattle}>
          Vai alle Music Battle
        </PartyButton>
      </PartyCard>

      <PartyComingSoonCard
        icon={<Users className="h-6 w-6 text-[#FF2D8D]" />}
        title="Top Fan"
        description="Classifica del pubblico più attivo della serata. Vincono richieste, voti e foto."
      />
      <PartyComingSoonCard
        icon={<Music2 className="h-6 w-6 text-[#FF2D8D]" />}
        title="Indovina la Canzone"
        description="Mini-quiz musicale live: chi indovina per primo vince un premio dal DJ."
      />
    </div>
  )
}

function PartyComingSoonCard({ icon, title, description }: any) {
  return (
    <PartyCard className="relative overflow-hidden opacity-90">
      <div className="absolute top-3 right-3">
        <PartyBadge tone="gold">In arrivo</PartyBadge>
      </div>
      <div className="flex items-center gap-3">
        {icon}
        <h3 className="text-lg font-black text-white">{title}</h3>
      </div>
      <p className="text-sm text-white/70 mt-2">{description}</p>
    </PartyCard>
  )
}

function PartyRouletteCard({ session, isFree }: any) {
  const gamesSignal = useGamesSignal(session.id)
  const { data: round, mutate: refresh } = useSWR(
    ['party-roulette', session.id],
    () => liveGames.getRouletteState(session.id, session.public_slug),
    { refreshInterval: gamesSignal.live ? 30_000 : 4_000 },
  )
  useEffect(() => { if (gamesSignal.tick > 0) refresh() }, [gamesSignal.tick, refresh])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>(() => {
    const cur = (session.roulette_penitenze ?? []).map((p: any) => p.label).filter(Boolean)
    return cur.length ? cur : PARTY_PENITENZE_DEFAULT
  })
  const [busy, setBusy] = useState<string | null>(null)

  const savePenitenze = async () => {
    setBusy('save')
    try {
      const arr = draft.map((label) => ({ label: label.trim(), category: 'party' as const, enabled: true })).filter((x) => x.label)
      await live.updateSession(session.id, { roulette_penitenze: arr })
      toast.success('Penitenze salvate')
      setEditing(false)
      await mutate(['session', session.id])
    } catch (e: any) { toast.error(e?.message ?? 'Errore') }
    finally { setBusy(null) }
  }

  const start = async () => {
    setBusy('start')
    try { await liveGames.startRoulette(session.id); await refresh() }
    catch (e: any) { toast.error(e?.message ?? 'Errore') }
    finally { setBusy(null) }
  }
  const spin = async () => {
    setBusy('spin')
    try { await liveGames.spinRoulette(session.id); await refresh() }
    catch (e: any) { toast.error(e?.message ?? 'Errore') }
    finally { setBusy(null) }
  }
  const reset = async () => {
    setBusy('reset')
    try { await liveGames.resetRoulette(session.id); await refresh() }
    catch (e: any) { toast.error(e?.message ?? 'Errore') }
    finally { setBusy(null) }
  }

  if (isFree) {
    return (
      <PartyCard tone="fuchsia">
        <div className="flex items-center gap-3"><Sparkles className="h-6 w-6 text-white" /><h3 className="text-lg font-black text-white">Party Roulette</h3></div>
        <p className="text-sm text-white/80 mt-2">Attiva Event Pass 24H per sbloccare la roulette.</p>
        <Link href="/billing" className="inline-block mt-3"><PartyButton variant="outline" size="sm">Sblocca</PartyButton></Link>
      </PartyCard>
    )
  }

  return (
    <PartyCard tone="fuchsia">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-white" />
          <h3 className="text-lg font-black text-white">Party Roulette</h3>
        </div>
        <button onClick={() => setEditing((v) => !v)} className="text-[10px] uppercase tracking-wider text-white/80 hover:text-white">
          {editing ? 'Annulla' : 'Modifica penitenze'}
        </button>
      </div>

      {editing ? (
        <div className="mt-4 space-y-2">
          {draft.map((p, i) => (
            <div key={i} className="flex gap-2">
              <PartyInput value={p} onChange={(e: any) => setDraft(draft.map((d, di) => di === i ? e.target.value : d))} className="flex-1" />
              <button onClick={() => setDraft(draft.filter((_, di) => di !== i))} className="p-2 rounded-md bg-white/10 text-white hover:bg-white/20"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button onClick={() => setDraft([...draft, ''])} className="text-xs text-white/80 hover:text-white inline-flex items-center gap-1 mt-1">
            <Plus className="h-3 w-3" /> Aggiungi penitenza
          </button>
          <div className="flex gap-2 mt-3">
            <PartyButton variant="fuchsia" size="sm" onClick={savePenitenze} loading={busy === 'save'}>Salva</PartyButton>
            <PartyButton variant="ghost" size="sm" onClick={() => setDraft(PARTY_PENITENZE_DEFAULT)}>Ripristina default</PartyButton>
          </div>
        </div>
      ) : (
        <>
          {round?.result?.slot_label ? (
            <div className="mt-4 rounded-2xl bg-black/40 border-2 border-white/20 p-5 text-center">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#FF2D8D] mb-2">Risultato</p>
              <p className="text-2xl font-black text-white">{round.result.slot_label}</p>
            </div>
          ) : (
            <p className="text-sm text-white/80 mt-2">
              {(session.roulette_penitenze ?? PARTY_PENITENZE_DEFAULT).length} penitenze caricate. Avvia la roulette quando vuoi.
            </p>
          )}

          <div className="flex gap-2 mt-4 flex-wrap">
            {!round || round.status === 'completed' ? (
              <PartyButton variant="outline" size="sm" onClick={start} loading={busy === 'start'} icon={<Play className="h-3.5 w-3.5" />}>
                Avvia
              </PartyButton>
            ) : (
              <PartyButton variant="fuchsia" size="sm" onClick={spin} loading={busy === 'spin'} icon={<RotateCw className="h-3.5 w-3.5" />}>
                Gira!
              </PartyButton>
            )}
            {round && (
              <PartyButton variant="ghost" size="sm" onClick={reset} loading={busy === 'reset'}>Reset</PartyButton>
            )}
          </div>
        </>
      )}
    </PartyCard>
  )
}

// ─────────────── SCREEN PANEL ───────────────
function PartyScreenPanel({ session, screenUrl }: any) {
  const cfg = session.screen_config ?? {}
  const [draft, setDraft] = useState({
    show_photos: cfg.show_photos !== false,
    show_polls: cfg.show_polls !== false,
    show_roulette: cfg.show_roulette !== false,
    show_video_live: cfg.show_video_live === true,
    video_url: cfg.video_url ?? '',
    video_title: cfg.video_title ?? '',
    live_booth_layout: (cfg.live_booth_layout as 'single' | 'grid' | 'auto') ?? 'single',
  })
  const [saving, setSaving] = useState(false)

  const videoPreview = resolveVideoSource(draft.video_url)
  const videoLinkInvalid = String(draft.video_url).trim().length > 0 && !videoPreview

  const save = async () => {
    setSaving(true)
    try {
      await live.updateSession(session.id, {
        screen_config: {
          ...cfg,
          ...draft,
          video_url: String(draft.video_url).trim(),
          video_title: String(draft.video_title).trim(),
        },
      })
      toast.success('Schermo aggiornato')
      await mutate(['session', session.id])
    } catch (e: any) { toast.error(e?.message ?? 'Errore') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">
      <PartyCard tone="hi">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <PartyEyebrow>Schermo TV / Proiettore</PartyEyebrow>
            <PartyLivePill live={session.is_active} label={session.is_active ? 'IN ONDA' : 'SPENTO'} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <a href={screenUrl} target="_blank" rel="noreferrer">
              <PartyButton variant="fuchsia" size="sm" icon={<Tv className="h-3.5 w-3.5" />}>Apri Schermo</PartyButton>
            </a>
            <PartyButton variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(screenUrl); toast.success('Link copiato') }} icon={<Copy className="h-3.5 w-3.5" />}>
              Copia link
            </PartyButton>
          </div>
        </div>
        <PartyScreenPreview session={session} show={{ photos: draft.show_photos, polls: draft.show_polls }} />
        <div className="mt-3 flex flex-wrap gap-2">
          {([['Foto', draft.show_photos], ['Music Battle', draft.show_polls], ['Roulette', draft.show_roulette], ['Video', draft.show_video_live]] as const).map(([l, on]) => (
            <PartyBadge key={l} tone={on ? 'success' : 'soft'}>{on ? '● ' : '○ '}{l}</PartyBadge>
          ))}
        </div>
      </PartyCard>

      <PartyCard>
        <PartyEyebrow>Cosa mostrare sullo schermo</PartyEyebrow>
        <div className="mt-4 space-y-2.5">
          <ScreenToggle label="Foto Live Booth" value={draft.show_photos} onChange={(v) => setDraft({ ...draft, show_photos: v })} />
          <ScreenToggle label="Music Battle" value={draft.show_polls} onChange={(v) => setDraft({ ...draft, show_polls: v })} />
          <ScreenToggle label="Party Roulette" value={draft.show_roulette} onChange={(v) => setDraft({ ...draft, show_roulette: v })} />
          <ScreenToggle label="Video Live" value={draft.show_video_live} onChange={(v) => setDraft({ ...draft, show_video_live: v })} />
        </div>

        {draft.show_photos && (
          <div className="mt-3 rounded-xl bg-black/20 border border-white/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#FF2D8D] mb-2.5">
              Come mostrare le foto
            </p>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['single', 'Foto singola'],
                ['grid', 'Griglia'],
                ['auto', 'Mix automatico'],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setDraft({ ...draft, live_booth_layout: val })}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold transition border ${
                    draft.live_booth_layout === val
                      ? 'bg-[#FF2D8D] text-white border-[#FF2D8D]'
                      : 'bg-black/30 text-white/70 border-white/10 hover:border-[#FF2D8D]/40'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {draft.show_video_live && (
          <div className="mt-3 space-y-2.5 rounded-xl bg-black/20 border border-white/10 p-3">
            <p className="text-[11px] text-white/50 inline-flex items-center gap-1.5">
              <Youtube className="h-3.5 w-3.5 text-[#FF2D8D]" /> Mostra un video YouTube o un file (mp4) nella schermata live
            </p>
            <input
              type="url"
              value={draft.video_url}
              onChange={(e) => setDraft({ ...draft, video_url: e.target.value })}
              placeholder="https://youtube.com/watch?v=...  oppure  https://.../video.mp4"
              className="w-full rounded-lg bg-black/30 border border-white/15 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF2D8D]"
            />
            <input
              type="text"
              value={draft.video_title}
              onChange={(e) => setDraft({ ...draft, video_title: e.target.value })}
              placeholder="Titolo video (opzionale)"
              className="w-full rounded-lg bg-black/30 border border-white/15 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF2D8D]"
            />
            {videoLinkInvalid && (
              <p className="text-[11px] text-[#FF2D8D]">Link non valido (usa YouTube o un file .mp4/.webm)</p>
            )}
            {videoPreview ? (
              <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-white/15 bg-black">
                {videoPreview.kind === 'youtube' ? (
                  <iframe
                    src={videoPreview.embedUrl}
                    title="preview"
                    className="absolute inset-0 w-full h-full"
                    allow="encrypted-media; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={videoPreview.url}
                    className="absolute inset-0 w-full h-full object-contain"
                    muted
                    loop
                    playsInline
                    controls
                  />
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] py-5 text-center">
                <p className="text-[11px] text-white/40">Inserisci un link per mostrare l'anteprima</p>
              </div>
            )}
          </div>
        )}

        <VideoLiveController session={session} theme="party" />

        <PartyButton variant="fuchsia" size="sm" className="mt-4" onClick={save} loading={saving}>Salva preferenze</PartyButton>
      </PartyCard>
    </div>
  )
}

// Pages are served with X-Frame-Options: DENY, so the preview is rendered from the same data the TV reads.
function PartyScreenPreview({ session, show }: { session: any; show: { photos: boolean; polls: boolean } }) {
  const { data: photos } = useSWR(['booth-photos', session.id], () => livePhotos.listBoothPhotos(session.id).catch(() => []), { refreshInterval: 8_000 })
  const { data: polls } = useSWR(['polls', session.id], () => livePolls.list(session.id).catch(() => []), { refreshInterval: 8_000 })
  const photo = (photos ?? []).find((p: any) => p.status === 'approved' && p.url) ?? (photos ?? []).find((p: any) => p.url)
  const poll = (polls ?? []).find((p) => p.is_active)
  const total = (poll?.tally ?? []).reduce((x: number, y: number) => x + y, 0)
  return (
    <div className="relative mt-4 aspect-video w-full overflow-hidden rounded-2xl border border-[#2A2A33] bg-[#0A0A0D]">
      {show.photos && photo?.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="" className="absolute inset-0 h-full w-full object-contain" />
      )}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-4 py-3">
        <p className="truncate text-sm font-black text-[#F8F8FA] sm:text-lg">{session.event_name}</p>
        <PartyLivePill live={session.is_active} label={session.is_active ? 'IN ONDA' : 'SPENTO'} />
      </div>
      {show.polls && poll && (
        <div className="absolute inset-x-3 bottom-3 rounded-xl border border-[#2A2A33] bg-[#15151B]/95 p-3 sm:inset-x-6 sm:bottom-5 sm:p-4">
          <p className="truncate text-xs font-bold text-[#F8F8FA] sm:text-sm">{poll.question}</p>
          <div className="mt-2 space-y-1.5">
            {poll.options.map((opt: string, i: number) => {
              const t = poll.tally?.[i] ?? 0
              const pct = total > 0 ? Math.round((t / total) * 100) : 0
              const lead = total > 0 && t === Math.max(...(poll.tally ?? [0]))
              return (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 truncate text-[#F8F8FA]/80">{opt}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#2A2A33]"><div className={`h-full rounded-full ${lead ? 'bg-[#F4FF3A]' : 'bg-[#FF2D8D]'}`} style={{ width: `${pct}%` }} /></div>
                  <span className="w-8 text-right font-bold tabular-nums text-[#F8F8FA]">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {!(show.photos && photo?.url) && !(show.polls && poll) && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[#9A9AA3]">Nessun contenuto attivo sullo schermo</div>
      )}
    </div>
  )
}

function ScreenToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[48px] items-center justify-between rounded-xl bg-[#0A0A0D] border border-[#2A2A33] px-4 py-3 cursor-pointer hover:border-[#FF2D8D]/40">
      <span className="text-sm text-white">{label}</span>
      <button type="button" onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition ${value ? 'bg-[#FF2D8D]' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition ${value ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  )
}
