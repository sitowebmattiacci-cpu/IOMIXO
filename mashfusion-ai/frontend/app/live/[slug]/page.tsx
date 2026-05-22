'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import useSWR, { mutate } from 'swr'
import toast from 'react-hot-toast'
import { Music2, Send, Instagram, Globe, MapPin, CalendarDays, Lock, AlertTriangle, Check, X, Clock, Heart, Sparkles, Image as ImageIcon, Camera } from 'lucide-react'
import { publicLive, liveDedications, liveGames, livePolls, livePhotos, bestPhoto, type LiveRequestStatus, type LiveDedication, type LivePoll, type LivePhoto, type LiveGameRound } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
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

const STATUS_LABEL: Record<LiveRequestStatus, string> = {
  pending:  'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
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
      toast.success('Richiesta inviata al DJ')
      setForm({ track_title: '', artist: '', message: '' })
      await mutate(['public-live', slug])
    } catch (err: any) {
      toast.error(err?.message ?? 'Errore')
    } finally { setSending(false) }
  }

  if (isLoading) {
    return <Center><p className="text-white/50">Caricamento…</p></Center>
  }
  if (error || !data) {
    return (
      <Center>
        <div className="text-center">
          <AlertTriangle className="h-10 w-10 text-white/30 mx-auto mb-3" />
          <p className="text-white/70">Sessione non trovata.</p>
        </div>
      </Center>
    )
  }

  const { session, profile, events, requestsRemaining, branding, features } = data
  const closed       = !session.is_active
  const limitReached = requestsRemaining !== null && requestsRemaining <= 0
  const disabled     = closed || limitReached
  const isWedding    = session.session_type === 'wedding'

  if (isWedding) {
    return (
      <WeddingShell>
        <div className="max-w-lg mx-auto px-6 py-16">
          {/* Wedding header */}
          <div className="text-center mb-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-[#8F1D2C] mb-4">
              ✦ Pro Plus Wedding ✦
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
              <span>Limite richieste raggiunto.</span>
            </WeddingCard>
          )}

          {/* Song request form (wedding-styled) */}
          <WeddingCard tone="ivory" className="mb-8">
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

          {features.weddingGames && <ShoeGamePublic slug={slug!} />}
          {features.livePolls && <PollPublic slug={slug!} />}
          {features.weddingGames && <BestPhotoPublic slug={slug!} />}
          {features.weddingDedications && <DedicationsPublic slug={slug!} />}
          {features.guestPhotoAlbum && <LiveBoothCard slug={slug!} session={session} />}

          {myRequests && myRequests.length > 0 && (
            <WeddingSection
              eyebrow="Le tue richieste"
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
            Powered by <span className="text-[#8F1D2C]">Pro Plus Wedding Edition</span>
          </p>
        </div>
      </WeddingShell>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-purple-950/40 to-zinc-950 text-white">
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="text-center mb-6">
          <p className="text-xs uppercase tracking-wider text-purple-300/80 mb-2">Richiesta musicale</p>
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
          <Banner icon={<Lock className="h-4 w-4" />}>La sessione è chiusa. Le richieste sono disabilitate.</Banner>
        )}
        {!closed && limitReached && (
          <Banner icon={<AlertTriangle className="h-4 w-4" />}>Limite richieste raggiunto per questa sessione.</Banner>
        )}

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
            <label className="text-xs text-white/60">Titolo brano *</label>
            <input
              value={form.track_title}
              onChange={(e) => setForm({ ...form, track_title: e.target.value })}
              required disabled={disabled}
              className={inputCls}
              placeholder="Es. Blinding Lights"
            />
          </div>
          <div>
            <label className="text-xs text-white/60">Artista</label>
            <input
              value={form.artist}
              onChange={(e) => setForm({ ...form, artist: e.target.value })}
              disabled={disabled}
              className={inputCls}
              placeholder="The Weeknd"
            />
          </div>
          <div>
            <label className="text-xs text-white/60">Messaggio per il DJ (opzionale)</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              disabled={disabled} rows={2} maxLength={200}
              className={inputCls}
              placeholder="È il compleanno di Sara!"
            />
          </div>
          <button
            type="submit"
            disabled={disabled || sending || !form.track_title.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
            {sending ? 'Invio…' : 'Invia richiesta'}
          </button>
          {requestsRemaining !== null && !disabled && (
            <p className="text-[11px] text-white/40 text-center">
              {requestsRemaining} richieste rimanenti su questa sessione.
            </p>
          )}
        </form>

        {myRequests && myRequests.length > 0 && (
          <div className="mt-8">
            <h2 className="font-bold mb-3">Le tue richieste</h2>
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
                    {STATUS_ICON[r.status]}{STATUS_LABEL[r.status]}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-white/30 text-center mt-3">
              Lo stato si aggiorna automaticamente.
            </p>
          </div>
        )}

        {isWedding && features.weddingGames && <ShoeGamePublic slug={slug!} />}
        {isWedding && features.livePolls && <PollPublic slug={slug!} />}
        {isWedding && features.weddingDedications && <DedicationsPublic slug={slug!} />}
        {isWedding && features.guestPhotoAlbum && <PhotosPublic slug={slug!} />}

        {events.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-purple-300" />
              <h2 className="font-bold">Prossime date</h2>
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
  const { data } = useSWR(['public-shoe', slug], () => liveGames.publicLatest(slug), { refreshInterval: 4_000 })
  const r: LiveGameRound | null = data?.shoeGame ?? null
  if (!r || r.status !== 'running' || !r.config?.is_active) return null
  const questions = r.config.questions ?? []
  const idx = r.config.current_index ?? 0
  const q = questions[idx]
  if (!q) return null
  return (
    <LocalCard title="Gioco della Scarpa" icon={<Sparkles className="h-5 w-5" />}>
      <div className="rounded-xl bg-gradient-to-br from-wedding-champagne/40 to-wedding-blush/30 border border-wedding-gold/30 p-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#8F1D2C] mb-3">
          Domanda {idx + 1}/{questions.length}
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
                — {d.guest_name ?? 'Anonimo'}
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
      toast.success('Voto registrato')
      refresh()
    } catch (e: any) { toast.error(e?.message ?? 'Errore') }
  }
  if (!photos || photos.length === 0) return null
  const sorted = [...photos].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
  return (
    <LocalCard title="Concorso Foto" icon={<Camera className="h-5 w-5" />}>
      <p className="text-sm text-[#6F6260] mb-4">
        Vota la tua foto preferita (un voto per foto).
      </p>
      <div className="grid grid-cols-2 gap-3">
        {sorted.map((p) => (
          <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden border border-[#E8B7C8] bg-white">
            {p.url && <img src={p.url} alt={p.caption ?? ''} className="w-full h-full object-cover" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-3">
              <p className="text-white text-sm font-semibold">{p.votes ?? 0} voti</p>
              <button
                onClick={() => vote(p.id)}
                disabled={voted.has(p.id)}
                className={`mt-2 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  voted.has(p.id)
                    ? 'bg-white/30 text-white cursor-default'
                    : 'bg-[#8F1D2C] text-white hover:bg-[#741625]'
                }`}
              >
                {voted.has(p.id) ? '✓ Votato' : 'Vota'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </LocalCard>
  )
}

function LiveBoothCard({ slug, session }: { slug: string; session: any }) {
  const boothUrl = `/booth/${slug}`
  return (
    <LocalCard title="📸 Live Booth" icon={<Camera className="h-5 w-5" />}>
      <div className="text-center space-y-4">
        <p className="text-sm text-[#6F6260]">
          Scatta una foto elegante con cornice personalizzata.
          La tua foto apparirà sullo schermo live!
        </p>
        <div className="bg-gradient-to-br from-wedding-champagne/40 to-wedding-blush/30 rounded-2xl border-2 border-[#E8B7C8] p-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Camera className="h-6 w-6 text-[#8F1D2C]" />
            <p className="font-wedding text-xl text-[#2B2424]">
              {session.couple_names ?? session.event_name}
            </p>
          </div>
          <p className="text-xs text-[#6F6260] mb-4 italic">
            Con cornice decorativa e nomi degli sposi
          </p>
          <a href={boothUrl}>
            <WeddingButton
              icon={<Camera className="h-5 w-5" />}
              size="lg"
              className="w-full"
            >
              Apri Live Booth
            </WeddingButton>
          </a>
        </div>
      </div>
    </LocalCard>
  )
}
