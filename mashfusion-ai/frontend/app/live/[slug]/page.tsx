'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import useSWR, { mutate } from 'swr'
import toast from 'react-hot-toast'
import { Music2, Send, Instagram, Facebook, Globe, MapPin, CalendarDays, Lock, AlertTriangle, Check, X, Clock, Heart, Sparkles, Image as ImageIcon, Camera, Gamepad2, BarChart3, ChevronLeft } from 'lucide-react'
import { liveDedications, livePolls, livePhotos, type LiveRequestStatus, type LiveDedication, type LivePoll, type LivePhoto, type LiveGameRound } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useLiveEvent } from '@/lib/events/useLiveEvent'
import { useGuestRequests } from '@/lib/events/useRequests'
import { sendMusicRequest } from '@/lib/events/requestService'
import { fetchPublicLive, isEventNotFound } from '@/lib/events/publicEventService'
import { GuestLoading, GuestLoadError } from '@/components/live/GuestLoadState'
import { sendDedication } from '@/lib/events/dedicationService'
import { useApprovedDedications } from '@/lib/events/useDedications'
import { useActivePoll, toLegacyPoll } from '@/lib/events/usePolls'
import { useLatestGames } from '@/lib/events/useGames'
import { votePoll } from '@/lib/events/pollService'
import { eventToPublicSession } from '@/lib/events/eventService'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import {
  WeddingGuestHome, WeddingGuestTopBar, WeddingGuestBackButton, WeddingGuestPanel, WeddingGuestButton,
  WeddingGuestInput, WeddingGuestTextarea, getWeddingGuestActionKeys, buildWeddingGuestActions,
  formatWeddingGuestDate, WEDDING_GUEST_TOAST, WeddingGuestTitle, type WeddingGuestActionKey,
} from '@/components/wedding/guest/WeddingGuestUI'
import { hasPhotoFeatures, EVENT_BRAND_NAME } from '@/lib/brand/eventBrand'
import { useEventBrand } from '@/lib/events/useEventBrand'
import { EventBrandProvider, WhiteLabelProvider } from '@/components/brand/EventBrand'
import { COUPLE_DEFAULT_GUEST_CONFIG } from '@/lib/coupleAlbum'
import { occasionEyebrow, occasionText } from '@/lib/occasion'
import { guestAlbumClosure } from '@/lib/miolove/guestClosure'

const STATUS_STYLE: Record<LiveRequestStatus, string> = {
  pending:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}
const STATUS_ICON: Record<LiveRequestStatus, React.ReactNode> = {
  pending:  <Clock className="h-3 w-3" />,
  approved: <Check className="h-3 w-3" />,
  rejected: <X className="h-3 w-3" />,
}

export default function PublicLivePage() {
  const { slug } = useParams<{ slug: string }>()
  const { t, locale } = useI18n()
  // Realtime event state (Firestore). When available it replaces the 15s polling of
  // the session fields; the backend payload is still fetched for profile/plan/features.
  const liveEvent = useLiveEvent(slug)
  const { data: payload, error, isLoading, mutate: reload } = useSWR(
    slug ? ['public-live', slug] : null,
    () => fetchPublicLive(slug!),
    { refreshInterval: liveEvent ? 0 : 15_000 },
  )
  const data = payload && liveEvent
    ? { ...payload, session: { ...payload.session, ...eventToPublicSession(liveEvent) } }
    : payload

  // Realtime "my requests" (Firestore, filtered by the guest's anonymous uid).
  const realtimeRequests = useGuestRequests(liveEvent?.id)
  const myRequests = realtimeRequests
    ? realtimeRequests.map((r) => ({
        id: r.id, track_title: r.songTitle, artist: r.artist,
        status: r.status, created_at: (r.createdAt ?? new Date()).toISOString(),
      })).sort((a, b) => b.created_at.localeCompare(a.created_at))
    : undefined

  const [form, setForm] = useState({ track_title: '', artist: '', message: '' })
  const [sending, setSending] = useState(false)
  const [activeGuestSection, setActiveGuestSection] = useState<string | null>(null)
  // MIOLOVE album (Sposi) vs IOMIXO (everything a DJ runs): only a MIOLOVE album offers photos to its guests.
  const brand = useEventBrand(slug, payload?.session.session_type)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.track_title.trim()) return
    setSending(true)
    try {
      const payload = {
        track_title: form.track_title.trim(),
        artist: form.artist.trim() || undefined,
        message: form.message.trim() || undefined,
      }
      if (!liveEvent) throw new Error(t('live.notFound'))
      await sendMusicRequest({ eventId: liveEvent.id, songTitle: payload.track_title, artist: payload.artist, message: payload.message })
      toast.success(t('live.requestSent'), data?.session.session_type === 'wedding' ? WEDDING_GUEST_TOAST : undefined)
      setForm({ track_title: '', artist: '', message: '' })
      await mutate(['public-live', slug])
    } catch (err: any) {
      toast.error(err?.message ?? t('common.errorGeneric'), data?.session.session_type === 'wedding' ? WEDDING_GUEST_TOAST : undefined)
    } finally { setSending(false) }
  }

  if (isLoading || (payload && !brand)) {
    return <Center><GuestLoading /></Center>
  }
  // The album is fine but the request failed (network, App Check, server): say so and offer a retry; only a missing event is "not found".
  if (error && !data && !isEventNotFound(error)) return <Center><GuestLoadError onRetry={() => { void reload() }} /></Center>
  if (error || !data) {
    return (
      <Center>
        <div className="text-center">
          <AlertTriangle className="h-10 w-10 text-white/30 mx-auto mb-3" />
          <p className="text-white/70">{t('live.notFound')}</p>
        </div>
      </Center>
    )
  }

  const { session, profile, events, requestsRemaining, branding, features } = data
  const closed       = !session.is_active
  const limitReached = requestsRemaining !== null && requestsRemaining <= 0
  const disabled     = closed || limitReached
  const isWedding    = session.session_type === 'wedding'
  const isParty      = session.session_type === 'party'
  const photosAllowed = !!brand && hasPhotoFeatures(brand)

  // Guest Visibility: DJ-controlled flags from guest_config (independent from
  // plan gating in `features`). Song requests are visible by default; every
  // other function stays hidden until the DJ enables it. Standard sessions
  // ignore guest_config entirely (always show the request form).
  const gc = session.guest_config ?? {}
  const guestOn = (key: string) => (key === 'requests' ? gc.requests !== false : (gc as Record<string, boolean | undefined>)[key] === true)

  if (isWedding) {
    // A MIOLOVE album is NOT gated by the owner's DJ plan or by its date: its only guest entry point is the photo album (Live Booth), on from the first
    // minute (a missing guest_config means the album defaults). Song requests, dedications, games and polls belong to the DJ product.
    const isAlbum = brand === 'miolove'
    const albumGc = isAlbum ? { ...COUPLE_DEFAULT_GUEST_CONFIG, ...(gc as object) } : gc
    const weddingKeys = getWeddingGuestActionKeys(albumGc as Record<string, boolean | undefined>, isAlbum ? null : features)
      .filter((k) => photosAllowed || k !== 'photos')
      .filter((k) => !isAlbum || k === 'photos')
    // Trial over (server flag, or the end instant passed while the page was open): the album stays readable, new uploads are closed.
    const closure = guestAlbumClosure(session, isAlbum)
    const trialExpired = closure.closed
    const whiteLabel = isAlbum && session.access_mode === 'activated'
    const weddingItems = buildWeddingGuestActions(weddingKeys, t)
    const weddingNodes: Record<WeddingGuestActionKey, React.ReactNode> = {
      requests: (
          <WeddingGuestPanel title={t('live.title')} icon={<Music2 className="h-5 w-5" />}>
            <form onSubmit={submit} className="space-y-3.5">
              <WeddingGuestInput
                value={form.track_title}
                onChange={(e) => setForm({ ...form, track_title: e.target.value })}
                placeholder={t('live.trackTitle')}
                required
                disabled={disabled}
              />
              <WeddingGuestInput
                value={form.artist}
                onChange={(e) => setForm({ ...form, artist: e.target.value })}
                placeholder={t('live.artist')}
                disabled={disabled}
              />
              <WeddingGuestTextarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={2}
                maxLength={200}
                placeholder={t('live.messageForDj')}
                disabled={disabled}
              />
              <WeddingGuestButton
                type="submit"
                disabled={disabled || sending || !form.track_title.trim()}
                loading={sending}
                icon={<Send className="h-4 w-4" />}
              >
                {t('live.submitRequest')}
              </WeddingGuestButton>
            </form>
          </WeddingGuestPanel>
      ),
      photos: <LiveBoothCard slug={slug!} session={session} album={isAlbum} expired={trialExpired} closedKey={closure.key} />,
      dedications: <DedicationsPublic slug={slug!} eventId={liveEvent?.id} />,
      games: <ShoeGamePublic slug={slug!} eventId={liveEvent?.id} />,
      polls: <PollPublic slug={slug!} eventId={liveEvent?.id} />,
    }
    const activeWeddingKey = weddingKeys.find((k) => k === activeGuestSection) ?? null

    const names = session.couple_names ?? session.event_name
    const notice = (closed || (limitReached && !isAlbum) || trialExpired) ? (
      <div className="mb-5 flex items-center gap-3 rounded-[18px] border border-wd-border bg-wd-active px-4 py-3.5 text-[15px] text-wd-ink" data-testid="guest-notice">
        {closed || trialExpired ? <Lock className="h-5 w-5 shrink-0 text-wd-pink" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-wd-pink" />}
        <span>{closed ? t('live.endedSession') : trialExpired ? t(closure.key ?? 'guestAlbum.trialEnded') : t('live.limitReached')}</span>
      </div>
    ) : undefined
    const languageSlot = <LanguageSwitcher variant="wedding" />

    return (
      <EventBrandProvider brand={brand ?? 'iomixo'}>
      <WhiteLabelProvider whiteLabel={whiteLabel}>
      <div className="min-h-screen w-full bg-wd-bg font-sans text-wd-ink antialiased" data-occasion={isAlbum ? session.occasion_type ?? 'wedding' : undefined}>
        <div className="mx-auto w-full max-w-[520px] px-5 pb-12 pt-5">
          {activeWeddingKey ? (
            <>
              <WeddingGuestTopBar languageSlot={languageSlot} />
              <div className="pt-6">
                {notice}
                <WeddingGuestBackButton label={t('guestMenu.back')} onClick={() => setActiveGuestSection(null)} />
                {weddingNodes[activeWeddingKey]}
              </div>
            </>
          ) : (
            <WeddingGuestHome
              names={names}
              date={formatWeddingGuestDate(session.wedding_date, locale)}
              venue={session.venue_name}
              items={weddingItems}
              eyebrow={isAlbum ? occasionEyebrow(t, session.occasion_type) : undefined}
              emptyText={isAlbum ? t('guestAlbum.photosOff') : undefined}
              primary={isAlbum ? (weddingKeys.includes('photos') && !closed && !trialExpired ? { label: t('guestMenu.photos'), hint: t('guestMenu.photosDesc'), href: `/booth/${slug}`, icon: <Camera className="h-6 w-6" /> } : null) : undefined}
              onSelect={setActiveGuestSection}
              languageSlot={languageSlot}
              notice={notice}
            />
          )}

          {!activeWeddingKey && myRequests && myRequests.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-wd-muted">{t('live.myRequests')}</h2>
              <div className="space-y-3">
                {myRequests.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-[18px] border border-wd-border bg-white p-4">
                    <Music2 className="h-5 w-5 shrink-0 text-wd-pink" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-wd-ink">{r.track_title}</p>
                      {r.artist && <p className="truncate text-[14px] text-wd-muted">{r.artist}</p>}
                    </div>
                    <span className="shrink-0 rounded-full border border-wd-border bg-wd-active px-3 py-1 text-[12px] font-semibold text-wd-ink">
                      {r.status === 'approved' ? t('common.approved') : r.status === 'rejected' ? t('common.rejected') : t('common.pending')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <FollowDjSection tone="wedding" profile={profile} events={events} t={t} />

          <WeddingGuestTitle prefix={names} />
          {!whiteLabel && <p className="mt-12 text-center text-[12px] font-semibold tracking-wide text-wd-muted">{EVENT_BRAND_NAME[brand ?? 'iomixo']}</p>}
        </div>
      </div>
      </WhiteLabelProvider>
      </EventBrandProvider>
    )
  }

  // Party Mode — compact guest menu (cards) with only DJ-enabled functions
  const partyRequestForm = (
    <form onSubmit={submit} className="glass rounded-2xl p-5 space-y-3">
      {profile?.avatar_url && (
        <div className="flex justify-center -mt-1 mb-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profile.avatar_url}
            alt=""
            className="h-20 w-20 rounded-full object-cover border border-white/10 shadow-lg"
          />
        </div>
      )}
      <div>
        <label className="text-xs text-white/60">{t('live.trackTitleRequired')}</label>
        <input
          value={form.track_title}
          onChange={(e) => setForm({ ...form, track_title: e.target.value })}
          required disabled={disabled}
          className={inputCls}
          placeholder={t('live.trackTitleExample')}
        />
      </div>
      <div>
        <label className="text-xs text-white/60">{t('live.artistLabel')}</label>
        <input
          value={form.artist}
          onChange={(e) => setForm({ ...form, artist: e.target.value })}
          disabled={disabled}
          className={inputCls}
          placeholder={t('live.artistExample')}
        />
      </div>
      <div>
        <label className="text-xs text-white/60">{t('live.messageLabel')}</label>
        <textarea
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          disabled={disabled} rows={2} maxLength={200}
          className={inputCls}
          placeholder={t('live.messageExample')}
        />
      </div>
      <button
        type="submit"
        disabled={disabled || sending || !form.track_title.trim()}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#FF2D8D] hover:bg-[#E9207C] text-white font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Send className="h-4 w-4" />
        {sending ? t('live.sending') : t('live.submitRequest')}
      </button>
      {requestsRemaining !== null && !disabled && (
        <p className="text-[11px] text-white/40 text-center">
          {requestsRemaining} {t('live.requestsRemainingSuffix')}
        </p>
      )}
    </form>
  )

  const partySections: GuestSection[] = []
  if (isParty) {
    if (guestOn('requests')) {
      partySections.push({
        key: 'requests',
        icon: <Music2 className="h-6 w-6" />,
        title: t('guestMenu.requests'),
        desc: t('guestMenu.requestsDesc'),
        node: partyRequestForm,
      })
    }
    // Party is IOMIXO: never a photo entry point for guests (Live Booth belongs to MIOLOVE albums).
    if (photosAllowed && features.guestPhotoAlbum && guestOn('live_booth')) {
      partySections.push({
        key: 'photos',
        icon: <Camera className="h-6 w-6" />,
        title: t('guestMenu.photos'),
        desc: t('guestMenu.photosDesc'),
        node: <PartyBoothCTA slug={slug!} />,
      })
    }
    if (guestOn('roulette')) {
      partySections.push({
        key: 'games',
        icon: <Gamepad2 className="h-6 w-6" />,
        title: t('guestMenu.games'),
        desc: t('guestMenu.gamesDesc'),
        node: <PartyRouletteResult slug={slug!} eventId={liveEvent?.id} />,
      })
    }
    if (guestOn('music_battle')) {
      partySections.push({
        key: 'polls',
        icon: <BarChart3 className="h-6 w-6" />,
        title: t('guestMenu.polls'),
        desc: t('guestMenu.pollsDesc'),
        node: <PartyMusicBattle slug={slug!} eventId={liveEvent?.id} />,
      })
    }
  }
  const activeParty = partySections.find((s) => s.key === activeGuestSection) ?? null

  return (
    <div className="min-h-screen bg-[#0A0A0D] text-white">
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex justify-center mb-5">
          <LanguageSwitcher />
        </div>
        <div className="text-center mb-6">
          <p className="text-xs uppercase tracking-wider text-purple-300/80 mb-2">{t('live.musicRequest')}</p>
          <h1 className="text-2xl font-black">{session.event_name}</h1>
          {session.dj_name && <p className="text-sm text-white/60 mt-1">DJ {session.dj_name}</p>}
          {session.description && <p className="text-sm text-white/50 mt-3">{session.description}</p>}
        </div>

        {profile?.bio && (
          <div className="glass rounded-2xl p-4 mb-5">
            <p className="text-sm text-white/70">{profile.bio}</p>
          </div>
        )}

        {closed && (
          <Banner icon={<Lock className="h-4 w-4" />}>{t('live.closedNotice')}</Banner>
        )}
        {!closed && limitReached && (
          <Banner icon={<AlertTriangle className="h-4 w-4" />}>{t('live.limitReachedFull')}</Banner>
        )}

        {/* Party Mode: compact card menu. Standard sessions: simple request form. */}
        {isParty ? (
          partySections.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-center text-sm text-white/60">
              {t('guestVisibility.emptyState')}
            </div>
          ) : activeParty ? (
            <div>
              <GuestBackButton tone="party" label={t('guestMenu.back')} onClick={() => setActiveGuestSection(null)} />
              {activeParty.node}
            </div>
          ) : (
            <div>
              <GuestMenuIntro tone="party" t={t} />
              <GuestMenuGrid tone="party" sections={partySections} onSelect={setActiveGuestSection} />
            </div>
          )
        ) : (
          partyRequestForm
        )}

        {(!isParty || !activeParty) && myRequests && myRequests.length > 0 && (
          <div className="mt-8">
            <h2 className="font-bold mb-3">{t('live.myRequests')}</h2>
            <div className="space-y-2">
              {myRequests.map((r) => (
                <div key={r.id} className="glass rounded-xl p-3 flex items-start gap-3">
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-purple-500/15 text-purple-300 flex items-center justify-center">
                    <Music2 className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{r.track_title}</p>
                    {r.artist && <p className="text-xs text-white/50 truncate">{r.artist}</p>}
                  </div>
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${STATUS_STYLE[r.status]}`}>
                    {STATUS_ICON[r.status]}{r.status === 'approved' ? t('common.approved') : r.status === 'rejected' ? t('common.rejected') : t('common.pending')}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-white/30 text-center mt-3">
              {t('live.statusAutoUpdate')}
            </p>
          </div>
        )}

        <FollowDjSection tone="party" profile={profile} events={events} t={t} />

        {branding !== 'full' && (
          <p className={`text-center mt-10 ${branding === 'reduced' ? 'text-[10px] text-white/20' : 'text-[11px] text-white/30'}`}>
            Powered by <a href="/" className="text-purple-300 hover:text-purple-200">IOMIXO</a>
          </p>
        )}
      </div>
    </div>
  )
}

const inputCls =
  'w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-400 disabled:opacity-50'

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-[#0A0A0D] px-6">{children}</div>
}
function Banner({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-4 py-3 text-sm flex items-center gap-2">
      {icon}<span>{children}</span>
    </div>
  )
}
// ── "Segui il DJ" — social + (Party only) prossime date ──────────

type FollowProfile = {
  bio?: string | null
  instagram_url?: string | null
  tiktok_url?: string | null
  facebook_url?: string | null
  spotify_url?: string | null
  soundcloud_url?: string | null
  website_url?: string | null
} | null | undefined

type FollowEvent = {
  id: string
  title: string
  event_date?: string | null
  venue_name?: string | null
  city?: string | null
  ticket_url?: string | null
}

function hasAnySocial(p: FollowProfile): boolean {
  return !!(p && (p.instagram_url || p.tiktok_url || p.facebook_url || p.spotify_url || p.soundcloud_url || p.website_url))
}

/** Rimuove protocollo e slash finale da un URL → "www.nomesito.it/path". */
function cleanWebUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

/** Estrae lo username dal primo segmento del path → "@username". */
function socialHandle(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    const seg = u.pathname.split('/').filter(Boolean)[0] ?? ''
    const handle = seg.replace(/^@/, '')
    return handle ? `@${handle}` : cleanWebUrl(url)
  } catch {
    return cleanWebUrl(url)
  }
}

interface SocialItem {
  href: string
  icon: React.ReactNode
  label: string
  sub: string
}

function buildSocialItems(profile: FollowProfile): SocialItem[] {
  if (!profile) return []
  const items: SocialItem[] = []
  if (profile.instagram_url)  items.push({ href: profile.instagram_url,  icon: <Instagram className="h-5 w-5" />, label: 'Instagram',  sub: socialHandle(profile.instagram_url) })
  if (profile.tiktok_url)     items.push({ href: profile.tiktok_url,     icon: <Music2 className="h-5 w-5" />,    label: 'TikTok',     sub: socialHandle(profile.tiktok_url) })
  if (profile.facebook_url)   items.push({ href: profile.facebook_url,   icon: <Facebook className="h-5 w-5" />,  label: 'Facebook',   sub: cleanWebUrl(profile.facebook_url) })
  if (profile.spotify_url)    items.push({ href: profile.spotify_url,    icon: <Music2 className="h-5 w-5" />,    label: 'Spotify',    sub: cleanWebUrl(profile.spotify_url) })
  if (profile.soundcloud_url) items.push({ href: profile.soundcloud_url, icon: <Music2 className="h-5 w-5" />,    label: 'SoundCloud', sub: socialHandle(profile.soundcloud_url) })
  if (profile.website_url)    items.push({ href: profile.website_url,    icon: <Globe className="h-5 w-5" />,     label: 'Sito web',   sub: cleanWebUrl(profile.website_url) })
  return items
}

function SocialLinks({ profile, tone }: { profile: FollowProfile; tone: GuestTone }) {
  const items = buildSocialItems(profile)
  if (items.length === 0) return null

  const cardCls = tone === 'party'
    ? 'group flex items-center gap-3 rounded-2xl border border-[#2A2A33] bg-white/[0.04] p-3.5 transition hover:border-[#FF2D8D]/70 hover:bg-white/[0.08] active:scale-[0.99]'
    : 'group flex min-h-[56px] items-center gap-3 rounded-2xl border border-wd-border bg-white p-3.5 transition hover:border-wd-pink/50 active:scale-[0.99]'
  const iconWrapCls = tone === 'party'
    ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FF2D8D]/15 text-[#FF2D8D]'
    : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-wd-active text-wd-pink'
  const labelCls = tone === 'party' ? 'text-sm font-semibold text-white' : 'text-[15px] font-semibold text-wd-ink'
  const subCls   = tone === 'party' ? 'text-xs text-white/50 truncate' : 'text-[13px] text-wd-muted truncate'

  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2.5">
      {items.map((it) => (
        <a
          key={it.label}
          href={it.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${it.label} — ${it.sub}`}
          className={cardCls}
        >
          <span className={iconWrapCls}>{it.icon}</span>
          <span className="min-w-0 flex flex-col text-left">
            <span className={labelCls}>{it.label}</span>
            <span className={subCls}>{it.sub}</span>
          </span>
        </a>
      ))}
    </div>
  )
}

/**
 * Sezione "Segui il DJ" mostrata nel telecomando ospiti.
 * - tone="party"   → social + prossime date (più visibile)
 * - tone="wedding" → solo social, raffinata, vicino al footer (nessun evento)
 *
 * Social ed eventi sono già filtrati lato backend in base al piano effettivo
 * (Pro / Advance / Event Pass attivo): qui mostriamo solo ciò che è presente.
 */
function FollowDjSection({ tone, profile, events, t }: {
  tone: GuestTone
  profile: FollowProfile
  events: FollowEvent[]
  t: (k: string) => string
}) {
  const social = hasAnySocial(profile)
  const showEvents = tone === 'party'
  const evs = showEvents ? (events ?? []) : []
  if (!social && evs.length === 0) return null

  if (tone === 'wedding') {
    return (
      <div className="mt-10">
        <div className="text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-wd-pink mb-1.5">
            {t('live.followDjTitle')}
          </p>
          <p className="text-[15px] text-wd-muted mb-5">
            {t('live.followDjSubtitleWedding')}
          </p>
          <SocialLinks profile={profile} tone="wedding" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8">
      <div className="rounded-2xl border border-[#2A2A33] bg-[#15151B] p-5 backdrop-blur">
        <div className="text-center mb-4">
          <h2 className="text-lg font-black text-white">{t('live.followDjTitle')}</h2>
          <p className="text-xs text-white/60 mt-1">{t('live.followDjSubtitleParty')}</p>
        </div>
        {social && (
          <div className={evs.length > 0 ? 'mb-5' : ''}>
            <SocialLinks profile={profile} tone="party" />
          </div>
        )}
        {evs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 mb-1">
              <CalendarDays className="h-4 w-4 text-[#FF2D8D]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[#FF2D8D]">{t('live.upcomingDates')}</span>
            </div>
            {evs.map((ev) => {
              const inner = (
                <>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{ev.title}</p>
                    <p className="text-xs text-white/40 mt-0.5">
                      {ev.event_date && new Date(ev.event_date).toLocaleDateString('it-IT')}
                      {(ev.venue_name || ev.city) && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {[ev.venue_name, ev.city].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </p>
                  </div>
                </>
              )
              return ev.ticket_url ? (
                <a key={ev.id} href={ev.ticket_url} target="_blank" rel="noreferrer"
                  className="rounded-xl bg-white/5 border border-white/10 p-3 flex items-center justify-between hover:bg-white/10 transition">
                  {inner}
                </a>
              ) : (
                <div key={ev.id} className="rounded-xl bg-white/5 border border-white/10 p-3 flex items-center justify-between">
                  {inner}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// GUEST REMOTE — compact home menu (cards) + back navigation
// ════════════════════════════════════════════════════════════════

type GuestTone = 'wedding' | 'party'

interface GuestSection {
  key: string
  icon: React.ReactNode
  title: string
  desc: string
  node: React.ReactNode
}

function GuestMenuIntro({ tone, t }: { tone: GuestTone; t: (k: string) => string }) {
  if (tone === 'party') {
    return (
      <div className="text-center mb-6">
        <h2 className="text-2xl font-black text-white leading-tight">{t('guestMenu.heading')}</h2>
        <p className="text-sm text-white/60 mt-1.5 max-w-xs mx-auto">{t('guestMenu.subtitle')}</p>
      </div>
    )
  }
  return (
    <div className="text-center mb-8">
      <h2 className="font-wedding text-3xl sm:text-4xl text-[#2B2424] leading-tight">{t('guestMenu.heading')}</h2>
      <p className="text-sm text-[#6F6260] mt-2 max-w-xs mx-auto">{t('guestMenu.subtitle')}</p>
    </div>
  )
}

function GuestMenuCard({ tone, icon, title, desc, onClick }: {
  tone: GuestTone
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
}) {
  if (tone === 'party') {
    return (
      <button
        onClick={onClick}
        className="group flex flex-col items-center text-center gap-2 rounded-2xl border border-[#FF2D8D]/30 bg-[#15151B] p-5 backdrop-blur transition hover:border-[#FF2D8D]/60 hover: active:scale-[0.98]"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-[#FF2D8D] group-hover:bg-white/25 transition">
          {icon}
        </span>
        <span className="text-base font-black text-white leading-tight">{title}</span>
        <span className="text-xs text-white/70 leading-snug">{desc}</span>
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center text-center gap-2 rounded-2xl border border-[#E8B7C8] bg-white p-5 shadow-sm transition hover:border-wedding-gold hover:shadow-md active:scale-[0.98]"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-wedding-champagne/40 text-[#8F1D2C] group-hover:bg-wedding-champagne/60 transition">
        {icon}
      </span>
      <span className="font-wedding text-lg text-[#2B2424] leading-tight">{title}</span>
      <span className="text-xs text-[#6F6260] leading-snug">{desc}</span>
    </button>
  )
}

function GuestBackButton({ tone, label, onClick }: { tone: GuestTone; label: string; onClick: () => void }) {
  const cls = tone === 'party'
    ? 'inline-flex items-center gap-1.5 text-sm font-medium text-[#FF2D8D] hover:text-white transition mb-4'
    : 'inline-flex items-center gap-1.5 text-sm font-medium text-[#8F1D2C] hover:text-[#741625] transition mb-5'
  return (
    <button onClick={onClick} className={cls}>
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  )
}

function GuestMenuGrid({ tone, sections, onSelect }: {
  tone: GuestTone
  sections: GuestSection[]
  onSelect: (key: string) => void
}) {
  return (
    <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3">
      {sections.map((s) => (
        <GuestMenuCard
          key={s.key}
          tone={tone}
          icon={s.icon}
          title={s.title}
          desc={s.desc}
          onClick={() => onSelect(s.key)}
        />
      ))}
    </div>
  )
}


function LocalCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <WeddingGuestPanel title={title} icon={icon}>
      {children}
    </WeddingGuestPanel>
  )
}

function ShoeGamePublic({ slug, eventId }: { slug: string; eventId?: string }) {
  const { t } = useI18n()
  const rt = useLatestGames(eventId)?.shoeGame ?? null
  const r: LiveGameRound | null = rt
  if (!r || r.status !== 'running' || !r.config?.is_active) return null
  const questions = r.config.questions ?? []
  const idx = r.config.current_index ?? 0
  const q = questions[idx]
  if (!q) return null
  return (
    <LocalCard title={t('live.shoeGameTitle')} icon={<Sparkles className="h-5 w-5" />}>
      <div className="rounded-2xl bg-wd-active border border-wd-border p-6 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-wd-pink mb-3">
          {t('live.question')} {idx + 1}/{questions.length}
        </p>
        <p className="text-[22px] font-bold text-wd-ink leading-snug">{q}</p>
      </div>
    </LocalCard>
  )
}

/** Casts a vote through the votePoll Cloud Function. */
async function castVote(opts: { eventId?: string; pollId: string; index: number }) {
  if (!opts.eventId) throw new Error('Sessione non trovata')
  await votePoll({ eventId: opts.eventId, pollId: opts.pollId, optionIndex: opts.index })
}

function PollPublic({ slug: _slug, eventId }: { slug: string; eventId?: string }) {
  const { t } = useI18n()
  // Realtime (Firestore): open poll + live tally + my vote.
  const rt = useActivePoll(eventId)
  const poll: LivePoll | null | undefined = rt ? toLegacyPoll(rt) : rt
  const [votedLocal, setVoted] = useState<number | null>(null)
  const voted = rt?.myVote ?? votedLocal
  if (!poll) return null
  const vote = async (i: number) => {
    try {
      await castVote({ eventId, pollId: poll.id, index: i })
      setVoted(i)
      toast.success(t('wedding.polls.voted'), WEDDING_GUEST_TOAST)
    } catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric'), WEDDING_GUEST_TOAST) }
  }
  const total = (poll.tally ?? []).reduce((a, b) => a + b, 0) || 0
  return (
    <LocalCard title={t('wedding.polls.title')} icon={<Sparkles className="h-5 w-5" />}>
      <p className="text-[17px] font-semibold text-wd-ink mb-4">{poll.question}</p>
      <div className="space-y-2">
        {poll.options.map((opt, i) => {
          const tally = poll.tally?.[i] ?? 0
          const pct = total > 0 ? Math.round((tally / total) * 100) : 0
          const mine = voted === i
          return (
            <button
              key={i}
              onClick={() => voted === null && vote(i)}
              disabled={voted !== null}
              className={`w-full min-h-[52px] text-left rounded-2xl border bg-white px-4 py-3 text-[16px] relative overflow-hidden hover:border-wd-pink/50 transition disabled:cursor-default ${mine ? 'border-wd-pink' : 'border-wd-border'}`}
            >
              <div className="absolute inset-y-0 left-0 bg-wd-active transition-all" style={{ width: `${pct}%` }} />
              <div className="relative flex items-center justify-between gap-3">
                <span className={mine ? 'font-semibold text-wd-ink' : 'text-wd-ink'}>{opt}</span>
                <span className="text-[14px] text-wd-muted font-medium">{pct}%</span>
              </div>
            </button>
          )
        })}
      </div>
    </LocalCard>
  )
}

function DedicationsPublic({ slug: _slug, eventId }: { slug: string; eventId?: string }) {
  const { t } = useI18n()
  // Realtime wall (Firestore, approved only).
  const realtime = useApprovedDedications(eventId)
  const data: LiveDedication[] | undefined = realtime
    ? realtime.map((d) => ({ id: d.id, guest_name: d.senderName, message: d.message, created_at: (d.createdAt ?? new Date()).toISOString(), status: 'approved' } as LiveDedication))
    : undefined
  const [form, setForm] = useState({ guest_name: '', message: '' })
  const [sending, setSending] = useState(false)
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.message.trim()) return
    setSending(true)
    try {
      if (!eventId) throw new Error(t('live.notFound'))
      await sendDedication({ eventId, senderName: form.guest_name.trim() || undefined, message: form.message })
      toast.success(t('wedding.dedications.submitted'), WEDDING_GUEST_TOAST)
      setForm({ guest_name: '', message: '' })
    } catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric'), WEDDING_GUEST_TOAST) }
    finally { setSending(false) }
  }
  return (
    <LocalCard title={t('wedding.dedications.publicTitle')} icon={<Heart className="h-5 w-5" />}>
      <form onSubmit={send} className="space-y-3.5 mb-5">
        <WeddingGuestInput value={form.guest_name} onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
          placeholder={t('wedding.dedications.guestName')} />
        <WeddingGuestTextarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
          rows={3} maxLength={300} placeholder={t('wedding.dedications.message')} required />
        <WeddingGuestButton type="submit" disabled={sending || !form.message.trim()} loading={sending}
          icon={<Send className="h-4 w-4" />}>
          {t('wedding.dedications.send')}
        </WeddingGuestButton>
      </form>
      {(data ?? []).length > 0 && (
        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {(data ?? []).map((d) => (
            <div key={d.id} className="rounded-2xl border border-wd-border bg-wd-bg px-4 py-3.5">
              <p className="text-[16px] text-wd-ink leading-snug whitespace-pre-line break-words">
                "{d.message}"
              </p>
              <p className="text-[13px] font-semibold text-wd-pink mt-2">
                — {d.guest_name ?? t('common.anonymous')}
              </p>
            </div>
          ))}
        </div>
      )}
    </LocalCard>
  )
}

function LiveBoothCard({ slug, session, album = false, expired = false, closedKey = null }: { slug: string; session: any; album?: boolean; expired?: boolean; closedKey?: string | null }) {
  const { t } = useI18n()
  const boothUrl = `/booth/${slug}`
  return (
    <LocalCard title={album ? t('guestAlbum.photoTitle') : t('live.booth.title')} icon={<Camera className="h-5 w-5" />}>
      <div className="text-center space-y-4">
        <p className="text-[15px] text-wd-muted">
          {album ? occasionText(t, session.occasion_type, 'boothIntro') : t('live.booth.intro')}
        </p>
        <div className="bg-wd-bg rounded-2xl border border-wd-border p-5">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Camera className="h-6 w-6 shrink-0 text-wd-pink" />
            <p className="text-[18px] font-bold text-wd-ink break-words">
              {session.couple_names ?? session.event_name}
            </p>
          </div>
          {!album && <p className="text-[14px] text-wd-muted mb-4">
            {t('live.booth.withFrame')}
          </p>}
          {expired ? (
            <p className="text-[14px] font-semibold text-wd-muted" data-testid="guest-trial-ended">{t(closedKey ?? 'guestAlbum.trialEnded')}</p>
          ) : (
            <a href={boothUrl} className="block">
              <WeddingGuestButton icon={<Camera className="h-5 w-5" />}>
                {t('live.booth.open')}
              </WeddingGuestButton>
            </a>
          )}
        </div>
      </div>
    </LocalCard>
  )
}

// ════════════════════════════════════════════════════════════════
// PARTY MODE — guest-facing live sections (mobile-first)
// ════════════════════════════════════════════════════════════════

function PartyBoothCTA({ slug }: { slug: string }) {
  const { t } = useI18n()
  return (
    <a
      href={`/booth/${slug}`}
      className="block rounded-2xl p-5 bg-[#15151B] border border-[#FF2D8D]/40 hover:scale-[1.01] transition active:scale-[0.99]"
    >
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
          <Camera className="h-7 w-7 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/80">Live Booth</p>
          <p className="text-lg font-black text-white leading-tight">{t('live.photoMoment')}</p>
          <p className="text-xs text-white/85 mt-0.5">{t('live.boothCtaSubtitle')}</p>
        </div>
        <span className="text-white text-xl">→</span>
      </div>
    </a>
  )
}

function PartyMusicBattle({ slug: _slug, eventId }: { slug: string; eventId?: string }) {
  const { t } = useI18n()
  // Realtime (Firestore).
  const rt = useActivePoll(eventId)
  const poll = (rt ? toLegacyPoll(rt) : null) as LivePoll | null
  const [votedLocal, setVoted] = useState<number | null>(null)
  const voted = rt?.myVote ?? votedLocal
  const [voting, setVoting] = useState(false)

  useEffect(() => {
    if (!poll) return
    const key = `iomixo.partyPollVote.${poll.id}`
    const v = typeof window !== 'undefined' ? localStorage.getItem(key) : null
    setVoted(v ? Number(v) : null)
  }, [poll?.id])

  if (!poll) return null

  const total = (poll.tally ?? []).reduce((a, b) => a + b, 0)

  const vote = async (idx: number) => {
    if (voting || voted === idx) return
    setVoting(true)
    try {
      await castVote({ eventId, pollId: poll.id, index: idx })
      localStorage.setItem(`iomixo.partyPollVote.${poll.id}`, String(idx))
      setVoted(idx)
    } catch (e: any) {
      toast.error(e?.message ?? t('live.errorVote'))
    } finally { setVoting(false) }
  }

  return (
    <div className="rounded-2xl bg-[#15151B] border border-[#FF2D8D]/30 backdrop-blur p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#FF2D8D]">{t('live.musicBattle')}</span>
        <span className="text-[10px] text-white/40">· {total} {total === 1 ? t('live.voteSingular') : t('live.votePlural')}</span>
      </div>
      <p className="text-lg font-bold text-white mb-4 leading-snug">{poll.question}</p>
      <div className="space-y-2.5">
        {poll.options.map((opt, i) => {
          const tally = poll.tally?.[i] ?? 0
          const pct = total > 0 ? Math.round((tally / total) * 100) : 0
          const isMine = voted === i
          const max = Math.max(...(poll.tally ?? [0]))
          const winning = total > 0 && tally === max && tally > 0
          return (
            <button
              key={i}
              onClick={() => vote(i)}
              disabled={voting || voted === i}
              className={`relative w-full rounded-xl overflow-hidden border h-14 transition ${
                isMine ? 'border-[#FF2D8D] ring-2 ring-[#FF2D8D]/40' :
                winning ? 'border-[#FF2D8D]/50' : 'border-white/15'
              } ${voting ? 'cursor-default opacity-90' : 'hover:border-[#FF2D8D]/60 active:scale-[0.99]'} bg-white/[0.04]`}
            >
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-700 ${
                  isMine ? 'bg-[#FF2D8D]' :
                  winning ? 'bg-[#F4FF3A]' :
                  'bg-[#2A2A33]'
                }`}
                style={{ width: voted !== null || total > 0 ? `${pct}%` : '0%' }}
              />
              <div className="relative flex items-center justify-between h-full px-4">
                <span className="font-bold text-white text-sm">{opt}{isMine && ' ✓'}</span>
                {(voted !== null || total > 0) && (
                  <span className="text-sm font-black text-white tabular-nums">
                    {pct}% <span className="text-white/50 font-medium">({tally})</span>
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-white/40 mt-3 text-center">
        {voted === null ? t('live.tapToVote') : t('live.tapToChangeVote')}
      </p>
    </div>
  )
}

function PartyRouletteResult({ slug: _slug, eventId }: { slug: string; eventId?: string }) {
  const { t } = useI18n()
  const r: LiveGameRound | null = useLatestGames(eventId)?.roulette ?? null
  if (!r || r.status !== 'completed' || !r.result?.slot_label) return null
  return (
    <div className="rounded-2xl p-6 bg-[#15151B] border border-[#FF2D8D]/40 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#FF2D8D] mb-3">
        {t('live.partyRoulette')}
      </p>
      <p className="text-2xl font-black text-white leading-tight">{r.result.slot_label}</p>
    </div>
  )
}

function PartyApprovedPhotos({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data } = useSWR(['public-photos', slug], () => livePhotos.publicListApproved(slug), { refreshInterval: 8_000 })
  const photos = (data ?? []).slice(0, 6)
  if (photos.length === 0) return null
  return (
    <div className="rounded-2xl bg-black/40 border border-white/10 backdrop-blur p-4">
      <div className="flex items-center gap-2 mb-3">
        <Camera className="h-4 w-4 text-[#FF2D8D]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#FF2D8D]">{t('live.publicBooth')}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p: any) => (
          <div key={p.id} className="aspect-square rounded-lg overflow-hidden bg-white/5 border border-white/10">
            {p.url && <img src={p.url} alt="" className="w-full h-full object-cover" />}
          </div>
        ))}
      </div>
    </div>
  )
}
