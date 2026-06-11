'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import useSWR, { mutate } from 'swr'
import toast from 'react-hot-toast'
import { Music2, Send, Instagram, Globe, MapPin, CalendarDays, Lock, AlertTriangle, Check, X, Clock, Heart, Sparkles, Image as ImageIcon, Camera, Gamepad2, BarChart3, ChevronLeft } from 'lucide-react'
import { publicLive, liveDedications, liveGames, livePolls, livePhotos, bestPhoto, type LiveRequestStatus, type LiveDedication, type LivePoll, type LivePhoto, type LiveGameRound } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import {
  WeddingShell, WeddingCard, WeddingButton, WeddingSection, WeddingBadge,
  WeddingDivider, WeddingInput, WeddingTextarea,
} from '@/components/wedding/WeddingUI'

const STORAGE_PREFIX = 'iomixo.publicReq.'

function loadIds(slug: string): string[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + slug) || '[]') } catch { return [] }
}
function saveIds(slug: string, ids: string[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(ids.slice(-10)))
}

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
  const { t } = useI18n()
  const { data, error, isLoading } = useSWR(
    slug ? ['public-live', slug] : null,
    () => publicLive.get(slug!),
    { refreshInterval: 15_000 },
  )

  const [myIds, setMyIds] = useState<string[]>([])
  useEffect(() => { if (slug) setMyIds(loadIds(slug)) }, [slug])

  useEffect(() => {
    if (!slug) return
    publicLive.heartbeat(slug)
    const id = setInterval(() => publicLive.heartbeat(slug), 10_000)
    return () => clearInterval(id)
  }, [slug])

  const { data: myRequests } = useSWR(
    slug && myIds.length > 0 ? ['my-requests', slug, myIds.join(',')] : null,
    () => publicLive.myRequests(slug!, myIds),
    { refreshInterval: 10_000 },
  )

  const [form, setForm] = useState({ track_title: '', artist: '', message: '' })
  const [sending, setSending] = useState(false)
  const [activeGuestSection, setActiveGuestSection] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.track_title.trim()) return
    setSending(true)
    try {
      const created = await publicLive.submitRequest(slug!, {
        track_title: form.track_title.trim(),
        artist: form.artist.trim() || undefined,
        message: form.message.trim() || undefined,
      })
      const newIds = [...myIds.filter((i) => i !== created.id), created.id]
      saveIds(slug!, newIds); setMyIds(newIds)
      toast.success(t('live.requestSent'))
      setForm({ track_title: '', artist: '', message: '' })
      await mutate(['public-live', slug])
    } catch (err: any) {
      toast.error(err?.message ?? t('common.errorGeneric'))
    } finally { setSending(false) }
  }

  if (isLoading) {
    return <Center><p className="text-white/50">{t('live.loading')}</p></Center>
  }
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

  // Guest Visibility: DJ-controlled flags from guest_config (independent from
  // plan gating in `features`). Song requests are visible by default; every
  // other function stays hidden until the DJ enables it. Standard sessions
  // ignore guest_config entirely (always show the request form).
  const gc = session.guest_config ?? {}
  const guestOn = (key: string) => (key === 'requests' ? gc.requests !== false : (gc as Record<string, boolean | undefined>)[key] === true)

  if (isWedding) {
    const weddingSections: GuestSection[] = []
    if (guestOn('requests')) {
      weddingSections.push({
        key: 'requests',
        icon: <Music2 className="h-6 w-6" />,
        title: t('guestMenu.requests'),
        desc: t('guestMenu.requestsDesc'),
        node: (
          <WeddingCard tone="ivory">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#8F1D2C] mb-5 text-center">
              {t('live.title')}
            </p>
            <form onSubmit={submit} className="space-y-4">
              <WeddingInput
                value={form.track_title}
                onChange={(e) => setForm({ ...form, track_title: e.target.value })}
                placeholder={t('live.trackTitle')}
                required
                disabled={disabled}
              />
              <WeddingInput
                value={form.artist}
                onChange={(e) => setForm({ ...form, artist: e.target.value })}
                placeholder={t('live.artist')}
                disabled={disabled}
              />
              <WeddingTextarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={2}
                maxLength={200}
                placeholder={t('live.messageForDj')}
                disabled={disabled}
              />
              <WeddingButton
                type="submit"
                disabled={disabled || sending || !form.track_title.trim()}
                loading={sending}
                icon={<Send className="h-4 w-4" />}
                className="w-full"
                size="lg"
              >
                {t('live.submitRequest')}
              </WeddingButton>
            </form>
          </WeddingCard>
        ),
      })
    }
    if (features.guestPhotoAlbum && guestOn('live_booth')) {
      weddingSections.push({
        key: 'photos',
        icon: <Camera className="h-6 w-6" />,
        title: t('guestMenu.photos'),
        desc: t('guestMenu.photosDesc'),
        node: <LiveBoothCard slug={slug!} session={session} />,
      })
    }
    if (features.weddingDedications && guestOn('dedications')) {
      weddingSections.push({
        key: 'dedications',
        icon: <Heart className="h-6 w-6" />,
        title: t('guestMenu.dedications'),
        desc: t('guestMenu.dedicationsDesc'),
        node: <DedicationsPublic slug={slug!} />,
      })
    }
    if (features.weddingGames && guestOn('shoe_game')) {
      weddingSections.push({
        key: 'games',
        icon: <Gamepad2 className="h-6 w-6" />,
        title: t('guestMenu.games'),
        desc: t('guestMenu.gamesDesc'),
        node: <ShoeGamePublic slug={slug!} />,
      })
    }
    if (features.livePolls && guestOn('polls')) {
      weddingSections.push({
        key: 'polls',
        icon: <BarChart3 className="h-6 w-6" />,
        title: t('guestMenu.polls'),
        desc: t('guestMenu.pollsDesc'),
        node: <PollPublic slug={slug!} />,
      })
    }
    const activeWedding = weddingSections.find((s) => s.key === activeGuestSection) ?? null

    return (
      <WeddingShell>
        <div className="max-w-lg mx-auto px-6 py-16">
          <div className="flex justify-center mb-6">
            <LanguageSwitcher variant="light" />
          </div>
          {/* Wedding header */}
          <div className="text-center mb-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-[#8F1D2C] mb-4">
              ✦ Wedding Edition ✦
            </p>
            <h1 className="font-wedding text-5xl sm:text-6xl text-[#2B2424] leading-[1.1] tracking-wide">
              {session.couple_names ?? session.event_name}
            </h1>
            <WeddingDivider className="my-7" />
            {session.wedding_date && (
              <p className="font-wedding text-xl italic text-[#6F6260]">
                {new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' })}
              </p>
            )}
            {session.venue_name && (
              <p className="text-[11px] uppercase tracking-[0.3em] text-[#6F6260] mt-3">
                {session.venue_name}
              </p>
            )}
          </div>

          {closed && (
            <WeddingCard tone="cream" className="mb-6 flex items-center gap-3 text-sm">
              <Lock className="h-4 w-4 text-wedding-gold" />
              <span>{t('live.endedSession')}</span>
            </WeddingCard>
          )}
          {!closed && limitReached && (
            <WeddingCard tone="cream" className="mb-6 flex items-center gap-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-wedding-gold" />
              <span>{t('live.limitReached')}</span>
            </WeddingCard>
          )}

          {/* Compact guest menu — show only DJ-enabled functions */}
          {weddingSections.length === 0 ? (
            <WeddingCard tone="cream" className="mb-8 text-center text-sm text-[#6F6260]">
              {t('guestVisibility.emptyState')}
            </WeddingCard>
          ) : activeWedding ? (
            <div className="mb-8">
              <GuestBackButton tone="wedding" label={t('guestMenu.back')} onClick={() => setActiveGuestSection(null)} />
              {activeWedding.node}
            </div>
          ) : (
            <div className="mb-8">
              <GuestMenuIntro tone="wedding" t={t} />
              <GuestMenuGrid tone="wedding" sections={weddingSections} onSelect={setActiveGuestSection} />
            </div>
          )}

          {!activeWedding && myRequests && myRequests.length > 0 && (
            <WeddingSection
              eyebrow={t('live.myRequests')}
              className="mt-12"
            >
              <div className="space-y-3">
                {myRequests.map((r) => (
                  <WeddingCard key={r.id} tone="ivory" className="p-4 flex items-center gap-3">
                    <Music2 className="h-4 w-4 text-[#8F1D2C] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#2B2424] truncate">{r.track_title}</p>
                      {r.artist && <p className="text-xs text-[#6F6260] truncate">{r.artist}</p>}
                    </div>
                    <WeddingBadge tone={r.status === 'approved' ? 'sage' : r.status === 'rejected' ? 'taupe' : 'gold'}>
                      {r.status === 'approved' ? t('common.approved') : r.status === 'rejected' ? t('common.rejected') : t('common.pending')}
                    </WeddingBadge>
                  </WeddingCard>
                ))}
              </div>
            </WeddingSection>
          )}

          <p className="text-center mt-14 text-[10px] uppercase tracking-[0.32em] text-[#6F6260]">
            Powered by <span className="text-[#8F1D2C]">IOMIXO Live Hub</span>
          </p>
        </div>
      </WeddingShell>
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
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed"
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
    if (features.guestPhotoAlbum && guestOn('live_booth')) {
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
        node: <PartyRouletteResult slug={slug!} />,
      })
    }
    if (guestOn('music_battle')) {
      partySections.push({
        key: 'polls',
        icon: <BarChart3 className="h-6 w-6" />,
        title: t('guestMenu.polls'),
        desc: t('guestMenu.pollsDesc'),
        node: <PartyMusicBattle slug={slug!} />,
      })
    }
  }
  const activeParty = partySections.find((s) => s.key === activeGuestSection) ?? null

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-purple-950/40 to-zinc-950 text-white">
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

        {profile && (profile.bio || profile.instagram_url || profile.tiktok_url || profile.spotify_url || profile.soundcloud_url || profile.website_url) && (
          <div className="glass rounded-2xl p-4 mb-5">
            {profile.bio && <p className="text-sm text-white/70 mb-3">{profile.bio}</p>}
            <div className="flex flex-wrap gap-2">
              {profile.instagram_url && <SocialLink href={profile.instagram_url} icon={<Instagram className="h-3.5 w-3.5" />} label="Instagram" />}
              {profile.tiktok_url    && <SocialLink href={profile.tiktok_url}    icon={<Music2 className="h-3.5 w-3.5" />}    label="TikTok" />}
              {profile.spotify_url   && <SocialLink href={profile.spotify_url}   icon={<Music2 className="h-3.5 w-3.5" />}    label="Spotify" />}
              {profile.soundcloud_url && <SocialLink href={profile.soundcloud_url} icon={<Music2 className="h-3.5 w-3.5" />}  label="SoundCloud" />}
              {profile.website_url   && <SocialLink href={profile.website_url}   icon={<Globe className="h-3.5 w-3.5" />}     label="Sito" />}
            </div>
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

        {events.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-purple-300" />
              <h2 className="font-bold">{t('live.upcomingDates')}</h2>
            </div>
            <div className="space-y-2">
              {events.map((ev) => (
                <a key={ev.id} href={ev.ticket_url ?? '#'} target="_blank" rel="noreferrer"
                  className="glass rounded-xl p-3 flex items-center justify-between hover:bg-white/5 transition">
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
                </a>
              ))}
            </div>
          </div>
        )}

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
  return <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-6">{children}</div>
}
function Banner({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-4 py-3 text-sm flex items-center gap-2">
      {icon}<span>{children}</span>
    </div>
  )
}
function SocialLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/80 hover:text-white hover:bg-white/10">
      {icon}{label}
    </a>
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
        className="group flex flex-col items-center text-center gap-2 rounded-2xl border border-[#FF3D8A]/30 bg-gradient-to-br from-[#8B0E2F]/40 to-[#B82E54]/20 p-5 backdrop-blur transition hover:border-[#FF7AB6]/60 hover:shadow-[0_10px_30px_rgba(255,61,138,0.25)] active:scale-[0.98]"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-[#FF7AB6] group-hover:bg-white/25 transition">
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
    ? 'inline-flex items-center gap-1.5 text-sm font-medium text-[#FF7AB6] hover:text-white transition mb-4'
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
    <WeddingCard tone="ivory" className="mt-6">
      <h2 className="font-wedding text-2xl mb-4 inline-flex items-center gap-2.5 text-[#2B2424] tracking-wide">
        <span className="text-[#8F1D2C]">{icon}</span>{title}
      </h2>
      <div className="h-px bg-gradient-to-r from-transparent via-[#E8B7C8] to-transparent mb-5" />
      {children}
    </WeddingCard>
  )
}

function ShoeGamePublic({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data } = useSWR(['public-shoe', slug], () => liveGames.publicLatest(slug), { refreshInterval: 4_000 })
  const r: LiveGameRound | null = data?.shoeGame ?? null
  if (!r || r.status !== 'running' || !r.config?.is_active) return null
  const questions = r.config.questions ?? []
  const idx = r.config.current_index ?? 0
  const q = questions[idx]
  if (!q) return null
  return (
    <LocalCard title={t('live.shoeGameTitle')} icon={<Sparkles className="h-5 w-5" />}>
      <div className="rounded-xl bg-gradient-to-br from-wedding-champagne/40 to-wedding-blush/30 border border-wedding-gold/30 p-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#8F1D2C] mb-3">
          {t('live.question')} {idx + 1}/{questions.length}
        </p>
        <p className="font-wedding text-2xl text-[#2B2424] leading-snug">{q}</p>
      </div>
    </LocalCard>
  )
}

function PollPublic({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data: poll, mutate: refresh } = useSWR<LivePoll | null>(
    ['public-poll', slug],
    () => livePolls.publicActive(slug),
    { refreshInterval: 5_000 },
  )
  const [voted, setVoted] = useState<number | null>(null)
  if (!poll) return null
  const vote = async (i: number) => {
    try {
      await livePolls.publicVote(slug, poll.id, i)
      setVoted(i)
      toast.success(t('wedding.polls.voted'))
      refresh()
    } catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }
  const total = (poll.tally ?? []).reduce((a, b) => a + b, 0) || 0
  return (
    <LocalCard title={t('wedding.polls.title')} icon={<Sparkles className="h-5 w-5" />}>
      <p className="text-base text-wedding-ink mb-3">{poll.question}</p>
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
              className="w-full text-left rounded-xl border border-wedding-champagne bg-white px-4 py-3 text-sm relative overflow-hidden hover:border-wedding-gold transition disabled:cursor-default"
            >
              <div className="absolute inset-y-0 left-0 bg-wedding-gold/25 transition-all" style={{ width: `${pct}%` }} />
              <div className="relative flex items-center justify-between">
                <span className={mine ? 'font-semibold text-wedding-ink' : 'text-wedding-ink/85'}>{opt}</span>
                <span className="text-xs text-wedding-ink/50 font-medium">{pct}%</span>
              </div>
            </button>
          )
        })}
      </div>
    </LocalCard>
  )
}

function DedicationsPublic({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data, mutate: refresh } = useSWR<LiveDedication[]>(
    ['public-dedications', slug], () => liveDedications.listApproved(slug),
    { refreshInterval: 8_000 },
  )
  const [form, setForm] = useState({ guest_name: '', message: '' })
  const [sending, setSending] = useState(false)
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.message.trim()) return
    setSending(true)
    try {
      await liveDedications.submit(slug, { guest_name: form.guest_name || undefined, message: form.message })
      toast.success(t('wedding.dedications.submitted'))
      setForm({ guest_name: '', message: '' })
      refresh()
    } catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
    finally { setSending(false) }
  }
  return (
    <LocalCard title={t('wedding.dedications.publicTitle')} icon={<Heart className="h-5 w-5" />}>
      <form onSubmit={send} className="space-y-2.5 mb-4">
        <WeddingInput value={form.guest_name} onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
          placeholder={t('wedding.dedications.guestName')} />
        <WeddingTextarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
          rows={3} maxLength={300} placeholder={t('wedding.dedications.message')} required />
        <WeddingButton type="submit" disabled={sending || !form.message.trim()} loading={sending}
          icon={<Send className="h-4 w-4" />} className="w-full">
          {t('wedding.dedications.send')}
        </WeddingButton>
      </form>
      {(data ?? []).length > 0 && (
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {(data ?? []).map((d) => (
            <div key={d.id} className="rounded-xl border border-wedding-border bg-white px-5 py-4">
              <p className="font-wedding text-lg italic text-wedding-ink leading-snug whitespace-pre-line">
                "{d.message}"
              </p>
              <p className="text-[11px] uppercase tracking-[0.25em] text-wedding-gold mt-2.5">
                — {d.guest_name ?? t('common.anonymous')}
              </p>
            </div>
          ))}
        </div>
      )}
    </LocalCard>
  )
}

function PhotosPublic({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data, mutate: refresh } = useSWR<LivePhoto[]>(
    ['public-photos', slug], () => livePhotos.publicListApproved(slug),
    { refreshInterval: 10_000 },
  )
  const [form, setForm] = useState({ guest_name: '', caption: '' })
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    try {
      await livePhotos.publicUpload(slug, file, { guest_name: form.guest_name || undefined, caption: form.caption || undefined })
      toast.success(t('wedding.photos.submitted'))
      setForm({ guest_name: '', caption: '' }); setFile(null)
      refresh()
    } catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
    finally { setUploading(false) }
  }
  return (
    <LocalCard title={t('wedding.photos.publicTitle')} icon={<Camera className="h-5 w-5" />}>
      <form onSubmit={submit} className="space-y-2.5 mb-4">
        <WeddingInput value={form.guest_name} onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
          placeholder={t('wedding.photos.guestName')} />
        <WeddingInput value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })}
          placeholder={t('wedding.photos.caption')} />
        <label className="block">
          <input type="file" accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-wedding-ink/70 file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-wedding-champagne/40 file:text-wedding-ink hover:file:bg-wedding-champagne/60 cursor-pointer" />
        </label>
        <p className="text-[11px] text-wedding-ink/50">{t('wedding.photos.limits')}</p>
        <WeddingButton type="submit" disabled={uploading || !file} loading={uploading}
          icon={<Camera className="h-4 w-4" />} className="w-full">
          {t('wedding.photos.choose')}
        </WeddingButton>
      </form>
      {(data ?? []).length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {(data ?? []).map((p) => (
            <div key={p.id} className="aspect-square rounded-xl overflow-hidden bg-wedding-champagne/20 border border-wedding-champagne/40">
              {p.url ? <img src={p.url} alt={p.caption ?? ''} className="w-full h-full object-cover" /> : <ImageIcon className="h-6 w-6 text-wedding-taupe m-auto" />}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-wedding-ink/50 text-center">{t('wedding.photos.empty')}</p>
      )}
    </LocalCard>
  )
}

function BestPhotoPublic({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data: photos, mutate: refresh } = useSWR(
    ['photo-votes-public', slug],
    () => bestPhoto.getVotesPublic(slug),
    { refreshInterval: 8_000 },
  )
  const [voted, setVoted] = useState<Set<string>>(new Set())
  const vote = async (photoId: string) => {
    if (voted.has(photoId)) return
    try {
      await bestPhoto.votePublic(slug, photoId)
      setVoted((prev) => new Set([...Array.from(prev), photoId]))
      toast.success(t('live.voteRegistered'))
      refresh()
    } catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }
  if (!photos || photos.length === 0) return null
  const sorted = [...photos].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
  return (
    <LocalCard title={t('live.photoContest')} icon={<Camera className="h-5 w-5" />}>
      <p className="text-sm text-[#6F6260] mb-4">
        {t('live.photoContestDesc')}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {sorted.map((p) => (
          <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden border border-[#E8B7C8] bg-white">
            {p.url && <img src={p.url} alt={p.caption ?? ''} className="w-full h-full object-cover" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-3">
              <p className="text-white text-sm font-semibold">{p.votes ?? 0} {t('live.votesSuffix')}</p>
              <button
                onClick={() => vote(p.id)}
                disabled={voted.has(p.id)}
                className={`mt-2 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  voted.has(p.id)
                    ? 'bg-white/30 text-white cursor-default'
                    : 'bg-[#8F1D2C] text-white hover:bg-[#741625]'
                }`}
              >
                {voted.has(p.id) ? t('live.voted') : t('live.vote')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </LocalCard>
  )
}

function LiveBoothCard({ slug, session }: { slug: string; session: any }) {
  const { t } = useI18n()
  const boothUrl = `/booth/${slug}`
  return (
    <LocalCard title={t('live.booth.title')} icon={<Camera className="h-5 w-5" />}>
      <div className="text-center space-y-4">
        <p className="text-sm text-[#6F6260]">
          {t('live.booth.intro')}
        </p>
        <div className="bg-gradient-to-br from-wedding-champagne/40 to-wedding-blush/30 rounded-2xl border-2 border-[#E8B7C8] p-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Camera className="h-6 w-6 text-[#8F1D2C]" />
            <p className="font-wedding text-xl text-[#2B2424]">
              {session.couple_names ?? session.event_name}
            </p>
          </div>
          <p className="text-xs text-[#6F6260] mb-4 italic">
            {t('live.booth.withFrame')}
          </p>
          <a href={boothUrl}>
            <WeddingButton
              icon={<Camera className="h-5 w-5" />}
              size="lg"
              className="w-full"
            >
              {t('live.booth.open')}
            </WeddingButton>
          </a>
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
      className="block rounded-2xl p-5 bg-gradient-to-br from-[#8B0E2F] via-[#B82E54] to-[#FF3D8A] shadow-[0_10px_40px_rgba(255,61,138,0.35)] border border-[#FF7AB6]/40 hover:scale-[1.01] transition active:scale-[0.99]"
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

function PartyMusicBattle({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data } = useSWR(['public-poll', slug], () => livePolls.publicActive(slug), { refreshInterval: 5_000 })
  const poll: LivePoll | null = (data as any) ?? null
  const [voted, setVoted] = useState<number | null>(null)
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
    if (voted !== null || voting) return
    setVoting(true)
    try {
      await livePolls.publicVote(slug, poll.id, idx)
      localStorage.setItem(`iomixo.partyPollVote.${poll.id}`, String(idx))
      setVoted(idx)
      await mutate(['public-poll', slug])
    } catch (e: any) {
      toast.error(e?.message ?? t('live.errorVote'))
    } finally { setVoting(false) }
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-black/60 to-[#8B0E2F]/30 border border-[#FF3D8A]/30 backdrop-blur p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#FF7AB6]">{t('live.musicBattle')}</span>
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
              disabled={voted !== null || voting}
              className={`relative w-full rounded-xl overflow-hidden border h-14 transition ${
                isMine ? 'border-[#FF3D8A] ring-2 ring-[#FF3D8A]/40' :
                winning ? 'border-[#FF3D8A]/50' : 'border-white/15'
              } ${voted === null ? 'hover:border-[#FF7AB6]/60 active:scale-[0.99]' : 'cursor-default'} bg-white/[0.04]`}
            >
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-700 ${
                  isMine ? 'bg-gradient-to-r from-[#FF3D8A] to-[#FF7AB6]' :
                  winning ? 'bg-gradient-to-r from-[#8B0E2F] to-[#B82E54]' :
                  'bg-gradient-to-r from-[#8B0E2F]/40 to-[#B82E54]/30'
                }`}
                style={{ width: voted !== null || total > 0 ? `${pct}%` : '0%' }}
              />
              <div className="relative flex items-center justify-between h-full px-4">
                <span className="font-bold text-white text-sm">{opt}{isMine && ' ✓'}</span>
                {(voted !== null || total > 0) && (
                  <span className="text-sm font-black text-white tabular-nums">{pct}%</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
      {voted === null && (
        <p className="text-[11px] text-white/40 mt-3 text-center">{t('live.tapToVote')}</p>
      )}
    </div>
  )
}

function PartyRouletteResult({ slug }: { slug: string }) {
  const { t } = useI18n()
  const { data } = useSWR(['public-roulette', slug], () => liveGames.publicLatest(slug), { refreshInterval: 5_000 })
  const r: LiveGameRound | null = data?.roulette ?? null
  if (!r || r.status !== 'completed' || !r.result?.slot_label) return null
  return (
    <div className="rounded-2xl p-6 bg-gradient-to-br from-[#FF3D8A]/30 via-[#8B0E2F]/40 to-black/60 border border-[#FF3D8A]/40 text-center shadow-[0_10px_40px_rgba(255,61,138,0.25)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#FF7AB6] mb-3">
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
        <Camera className="h-4 w-4 text-[#FF7AB6]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#FF7AB6]">{t('live.publicBooth')}</span>
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
