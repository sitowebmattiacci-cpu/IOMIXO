'use client'
import { useParams, useRouter } from 'next/navigation'
import useSWR, { mutate } from 'swr'
import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft, Trash2, Power, Heart, MessageSquare,
  Sparkles, Image as ImageIcon, ListChecks, Play, RotateCw, Tv,
  Check, X, Plus, Copy, Download, MapPin, CalendarDays, Footprints, SkipForward, Users, Camera, Star,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import {
  live, auth, liveDedications, liveGames, livePolls, livePhotos,
  bestPhoto,
  type LiveRequestStatus, type LivePoll,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { QRCard } from '@/components/live/QRCard'
import { RequestItem } from '@/components/live/RequestItem'
import { UpgradeGate } from '@/components/live/UpgradeGate'
import {
  WeddingCard, WeddingButton, WeddingBadge, WeddingInput, WeddingTextarea, WeddingDivider,
} from '@/components/wedding/WeddingUI'
import { useI18n } from '@/lib/i18n'
import type { User } from '@/types'

export default function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()
  const { t } = useI18n()

  const { data: session, error: sessionErr } = useSWR(
    sessionId ? ['session', sessionId] : null,
    () => live.getSession(sessionId!),
    { refreshInterval: 5_000 },
  )
  const { data: me } = useSWR<User>('me', () => auth.me())
  const isFree = !me || me.plan === 'free'
  const { data: requests } = useSWR(
    sessionId ? ['requests', sessionId] : null,
    () => live.listRequests(sessionId!),
    { refreshInterval: 5_000 },
  )

  const [busyId, setBusyId] = useState<string | null>(null)
  const [togglingActive, setTogglingActive] = useState(false)
  const [tab, setTab] = useState<'requests' | 'dedications' | 'games' | 'photos'>('requests')

  if (sessionErr) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="text-center">
          <p className="text-white/70 mb-4">Sessione non trovata.</p>
          <Link href="/sessions"><Button variant="secondary">{t('common.back')}</Button></Link>
        </Card>
      </div>
    )
  }
  if (!session) return <div className="flex-1 p-8 text-white/50">{t('common.loading')}</div>

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
    if (!confirm('Eliminare definitivamente questa sessione?')) return
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
              {isFree ? (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/50 inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Persone online
                  </span>
                  <Link href="/billing" className="text-[11px] text-purple-300">🔒 Solo Pro</Link>
                </div>
              ) : (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/50 inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Persone online
                  </span>
                  <span className="font-bold text-emerald-300">{session.online_count ?? 0}</span>
                </div>
              )}
              <div className="border-t border-white/5" />
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

  // ── Wedding — compact, romantic dashboard ──────────────────────
  return (
    <div className="flex-1 overflow-y-auto min-h-screen" style={{ background: '#FFFDFB', color: '#2B2424' }}>
      <div className="max-w-5xl mx-auto px-6 py-6 w-full">
        {/* Back link */}
        <div className="mb-4">
          <Link href="/sessions" className="inline-flex items-center gap-1.5 text-xs text-[#6F6260] hover:text-[#2B2424]">
            <ArrowLeft className="h-3 w-3" /> {t('common.back')}
          </Link>
        </div>

        {/* Header compatto */}
        <WeddingHeader
          session={session}
          slug={session.public_slug}
          togglingActive={togglingActive}
          onToggle={toggleActive}
          onDelete={removeSession}
        />

        {/* Riga superiore: QR + Riepilogo */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          <div className="md:col-span-1">
            <WeddingQRCompact slug={session.public_slug} />
          </div>
          <div className="md:col-span-2">
            <WeddingStats sessionId={session.id} pendingCount={pending.length} />
          </div>
        </div>

        {/* Tab compatte */}
        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white p-1.5 border border-[#E8B7C8] shadow-sm">
          <WeddingTabBtn active={tab === 'requests'}    onClick={() => setTab('requests')}    icon={<MessageSquare className="h-3.5 w-3.5" />} label={t('wedding.tabRequests')} />
          <WeddingTabBtn active={tab === 'dedications'} onClick={() => setTab('dedications')} icon={<Heart className="h-3.5 w-3.5" />}          label={t('wedding.tabDedications')} />
          <WeddingTabBtn active={tab === 'games'}       onClick={() => setTab('games')}       icon={<Sparkles className="h-3.5 w-3.5" />}       label={t('wedding.tabGames')} />
          <WeddingTabBtn active={tab === 'photos'}      onClick={() => setTab('photos')}      icon={<ImageIcon className="h-3.5 w-3.5" />}      label={t('wedding.tabPhotos')} />
        </div>

        {/* Pannello attivo */}
        <div className="mt-6 space-y-5">
          {tab === 'requests' && (
            <RequestsPanel
              pending={pending} approved={approved} rejected={rejected}
              busyId={busyId} isFree={isFree}
              onUpdate={updateRequest} onDelete={deleteRequest}
              wedding
            />
          )}
          {tab === 'dedications' && <DedicationsPanel sessionId={session.id} />}
          {tab === 'games'       && <GamesPanel       sessionId={session.id} session={session} />}
          {tab === 'photos'      && <PhotosPanel      sessionId={session.id} />}
        </div>

        <p className="text-center mt-10 text-[10px] uppercase tracking-[0.32em] text-[#B8A89A] font-medium">
          Powered by <span className="text-[#8F1D2C] font-semibold">PRO+ Wedding Edition</span>
        </p>
      </div>
    </div>
  )
}

function WeddingHeader({ session, slug, togglingActive, onToggle, onDelete }: {
  session: any; slug: string; togglingActive: boolean; onToggle: () => void; onDelete: () => void;
}) {
  const { t } = useI18n()
  const envBase = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
  const origin = envBase || (typeof window !== 'undefined' ? window.location.origin : 'https://www.iomixo.com')
  const url = `${origin}/live/${slug}`
  const [copied, setCopied] = useState(false)
  const [showScreenConfig, setShowScreenConfig] = useState(false)
  const [saving, setSaving] = useState(false)

  const screenConfig = session?.screen_config ?? {
    show_photos: false,
    show_dedications: false,
    show_roulette: false,
    show_shoe_game: false,
    show_polls: false,
  }

  const toggleScreenSection = async (key: keyof typeof screenConfig) => {
    setSaving(true)
    try {
      // Crea config completo con TUTTI i valori espliciti (incluso il font!)
      const newConfig: any = {
        show_photos: screenConfig.show_photos ?? false,
        show_dedications: screenConfig.show_dedications ?? false,
        show_roulette: screenConfig.show_roulette ?? false,
        show_shoe_game: screenConfig.show_shoe_game ?? false,
        show_polls: screenConfig.show_polls ?? false,
        couple_font: screenConfig.couple_font ?? 'cormorant', // Preserva il font!
      }
      // Toggle solo il valore selezionato (solo per campi boolean)
      if (typeof newConfig[key] === 'boolean') {
        newConfig[key] = !newConfig[key]
      }

      console.log('📝 Saving config:', JSON.stringify(newConfig))
      await live.updateSession(session.id, { screen_config: newConfig })
      await mutate(['session', session.id])
      toast.success('Aggiornato')
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }
  const download = () => {
    const svg = document.getElementById('qrcode-svg') as SVGSVGElement | null
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    const blob = new Blob([xml], { type: 'image/svg+xml' })
    const objectUrl = URL.createObjectURL(blob)
    img.onload = () => {
      const c = document.createElement('canvas'); const s = 512
      c.width = s; c.height = s
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s, s); ctx.drawImage(img, 0, 0, s, s)
      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `iomixo-${slug}.png`; a.click()
      URL.revokeObjectURL(objectUrl)
    }
    img.src = objectUrl
  }
  const btnOutline = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-[#FBEAF0] text-[#8F1D2C] border border-[#E8B7C8] hover:bg-[#E8B7C8]/50 hover:scale-[1.03] transition-all duration-150'
  const btnGhost   = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[#6F6260] hover:text-[#2B2424] hover:bg-[#FBEAF0] hover:scale-[1.03] transition-all duration-150'

  const [showGuestQR, setShowGuestQR] = useState(false)

  return (
    <div className="rounded-[18px] border border-[#E8B7C8] bg-[#F7F4F3] p-5 shadow-md">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap mb-2">
            <Heart className="h-5 w-5 text-[#8F1D2C] shrink-0" />
            <h1 className="font-wedding text-[2.2rem] sm:text-[2.5rem] font-semibold text-[#2B2424] leading-tight tracking-wide">
              {session.event_name}
            </h1>
          </div>
          {session.couple_names && (
            <p className="font-wedding text-lg italic text-[#8F1D2C] mt-2 mb-3">
              Benvenuti al matrimonio di {session.couple_names}
            </p>
          )}
          <div className="flex items-center gap-2.5 flex-wrap mb-3">
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider bg-emerald-50 border-emerald-200 text-emerald-700">
              {session.is_active ? t('sessions.active') : t('sessions.closed')}
            </span>
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider bg-[#FBEAF0] border-[#E8B7C8] text-[#8F1D2C]">
              💒 PRO+ Wedding
            </span>
            {/* QR Ospiti badge - apre popup con QR grande */}
            <div className="relative">
              <button
                onClick={() => setShowGuestQR(!showGuestQR)}
                className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider bg-white border-[#E8B7C8] text-[#8F1D2C] hover:bg-[#FBEAF0] transition"
              >
                👥 QR Ospiti
              </button>
              {showGuestQR && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowGuestQR(false)}
                  />
                  <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[#E8B7C8] bg-white shadow-lg z-20 p-4">
                    <div className="flex flex-col items-center">
                      <p className="text-xs uppercase tracking-wider text-[#8F1D2C] mb-3 font-semibold">
                        QR Code Ospiti
                      </p>
                      <div className="bg-white p-2 rounded-lg border border-[#E8B7C8]">
                        <QRCodeSVG value={url} size={180} level="M" includeMargin={false} />
                      </div>
                      <p className="text-[10px] text-[#6F6260] mt-3 text-center break-all">
                        {url}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          {session.couple_names && (
            <p className="font-wedding text-base italic text-[#6F6260] mt-1">{session.couple_names}</p>
          )}
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-[#6F6260] mt-2">
            {session.wedding_date && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3 text-[#8F1D2C]" />
                {new Date(session.wedding_date).toLocaleDateString('it-IT')}
              </span>
            )}
            {session.venue_name && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-[#8F1D2C]" /> {session.venue_name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={copy} className={btnOutline}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copiato' : 'Copia link'}
          </button>
          <button onClick={download} className={btnOutline}>
            <Download className="h-3.5 w-3.5" /> QR
          </button>
          {session.screen_mode_enabled && (
            <div className="relative">
              <button
                onClick={() => setShowScreenConfig(!showScreenConfig)}
                className={btnGhost}
              >
                <Tv className="h-3.5 w-3.5" /> {t('wedding.screen.title')}
              </button>
              {showScreenConfig && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowScreenConfig(false)}
                  />
                  <div className="absolute right-0 mt-2 w-72 rounded-xl border border-[#E8B7C8] bg-white shadow-lg z-20 p-4">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#E8B7C8]">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8F1D2C]">
                        Visibilità Schermo
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            setSaving(true)
                            try {
                              const resetConfig = {
                                show_photos: false,
                                show_dedications: false,
                                show_roulette: false,
                                show_shoe_game: false,
                                show_polls: false,
                                couple_font: screenConfig.couple_font ?? 'cormorant', // Preserva il font
                              }
                              await live.updateSession(session.id, { screen_config: resetConfig })
                              await mutate(['session', session.id])
                              toast.success('Reset completato')
                            } catch (e: any) {
                              toast.error('Errore')
                            } finally {
                              setSaving(false)
                            }
                          }}
                          className="text-[10px] text-[#8F1D2C] hover:underline uppercase tracking-wider"
                        >
                          Reset
                        </button>
                        <Link
                          href={`/screen/${slug}`}
                          target="_blank"
                          className="text-xs text-[#8F1D2C] hover:underline"
                        >
                          Apri →
                        </Link>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-[#FBEAF0] transition">
                        <input
                          type="checkbox"
                          checked={screenConfig.show_photos ?? false}
                          onChange={() => toggleScreenSection('show_photos')}
                          disabled={saving}
                          className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
                        />
                        <ImageIcon className="h-3.5 w-3.5 text-[#8F1D2C]" />
                        <span className="text-sm text-[#2B2424]">Foto</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-[#FBEAF0] transition">
                        <input
                          type="checkbox"
                          checked={screenConfig.show_dedications ?? false}
                          onChange={() => toggleScreenSection('show_dedications')}
                          disabled={saving}
                          className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
                        />
                        <Heart className="h-3.5 w-3.5 text-[#8F1D2C]" />
                        <span className="text-sm text-[#2B2424]">Dediche</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-[#FBEAF0] transition">
                        <input
                          type="checkbox"
                          checked={screenConfig.show_roulette ?? false}
                          onChange={() => toggleScreenSection('show_roulette')}
                          disabled={saving}
                          className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
                        />
                        <Sparkles className="h-3.5 w-3.5 text-[#8F1D2C]" />
                        <span className="text-sm text-[#2B2424]">Roulette</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-[#FBEAF0] transition">
                        <input
                          type="checkbox"
                          checked={screenConfig.show_shoe_game ?? false}
                          onChange={() => toggleScreenSection('show_shoe_game')}
                          disabled={saving}
                          className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
                        />
                        <Footprints className="h-3.5 w-3.5 text-[#8F1D2C]" />
                        <span className="text-sm text-[#2B2424]">Gioco Scarpa</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg hover:bg-[#FBEAF0] transition">
                        <input
                          type="checkbox"
                          checked={screenConfig.show_polls ?? false}
                          onChange={() => toggleScreenSection('show_polls')}
                          disabled={saving}
                          className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
                        />
                        <ListChecks className="h-3.5 w-3.5 text-[#8F1D2C]" />
                        <span className="text-sm text-[#2B2424]">Sondaggi</span>
                      </label>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#E8B7C8]">
                      <label className="block mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[#8F1D2C]">
                          Font Nomi Sposi
                        </span>
                      </label>
                      <select
                        value={screenConfig.couple_font ?? 'cormorant'}
                        onChange={async (e) => {
                          setSaving(true)
                          try {
                            const newConfig = { ...screenConfig, couple_font: e.target.value as any }
                            await live.updateSession(session.id, { screen_config: newConfig })
                            await mutate(['session', session.id])
                            toast.success('Font aggiornato')
                          } catch (err: any) {
                            toast.error(err?.message ?? 'Errore')
                          } finally {
                            setSaving(false)
                          }
                        }}
                        disabled={saving}
                        className="w-full rounded-lg border border-[#E8B7C8] bg-white px-3 py-2 text-sm text-[#2B2424] focus:border-[#8F1D2C] focus:ring-1 focus:ring-[#8F1D2C]"
                      >
                        <option value="cormorant">Cormorant (classico)</option>
                        <option value="playfair">Playfair (elegante)</option>
                        <option value="great-vibes">Great Vibes (corsivo)</option>
                        <option value="dancing">Dancing Script (romantico)</option>
                        <option value="cinzel">Cinzel (imperiale)</option>
                        <option value="tangerine">Tangerine (delicato)</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <button onClick={onToggle} disabled={togglingActive} className={btnGhost}>
            <Power className="h-3.5 w-3.5" />
            {session.is_active ? t('common.close') : t('common.open')}
          </button>
          <button onClick={onDelete} className={btnGhost}>
            <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

function WeddingQRCompact({ slug }: { slug: string }) {
  const envBase = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
  const origin = envBase || (typeof window !== 'undefined' ? window.location.origin : 'https://www.iomixo.com')
  const remoteUrl = `${origin}/remote/${slug}`
  return (
    <div className="rounded-[18px] border border-[#E8B7C8] bg-[#F7F4F3] p-5 flex flex-col gap-3 h-full">
      <div className="flex items-start gap-3">
        <div className="bg-white p-2 rounded-lg border border-[#E8B7C8] shrink-0">
          <QRCodeSVG id="qrcode-remote-svg" value={remoteUrl} size={80} level="M" includeMargin={false} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#8F1D2C] mb-1">
            REMOTE CONTROL DJ
          </p>
          <p className="text-xs text-[#6F6260] mb-2">
            Fai partecipare gli invitati
          </p>
          <p className="text-[10px] text-[#6F6260] break-all leading-relaxed italic">DJ Remote Control</p>
        </div>
      </div>
    </div>
  )
}

function WeddingStats({ sessionId, pendingCount }: { sessionId: string; pendingCount: number }) {
  const { data: dedications } = useSWR(['dedications', sessionId], () => liveDedications.listForDj(sessionId), { refreshInterval: 8_000 })
  const { data: photos }      = useSWR(['photos', sessionId],      () => livePhotos.listForDj(sessionId),      { refreshInterval: 8_000 })
  const { data: polls }       = useSWR(['polls', sessionId],       () => livePolls.list(sessionId),            { refreshInterval: 8_000 })
  const activeGames = (polls ?? []).filter((p: LivePoll) => p.is_active).length
  return (
    <div className="rounded-[18px] border border-[#E8B7C8] bg-[#F7F4F3] p-4 h-full grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatTile label="Richieste" value={pendingCount} icon={<MessageSquare className="h-4 w-4" />} />
      <StatTile label="Dediche"   value={(dedications ?? []).length} icon={<Heart className="h-4 w-4" />} />
      <StatTile label="Foto"      value={(photos ?? []).length}      icon={<ImageIcon className="h-4 w-4" />} />
      <StatTile label="Giochi"    value={activeGames}                icon={<Sparkles className="h-4 w-4" />} />
    </div>
  )
}

function StatTile({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white border border-[#E8B7C8] px-3 py-3 transition-all duration-150 hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-center gap-1.5 text-[#8F1D2C] mb-1.5">
        {icon}
        <span className="text-[10px] uppercase tracking-[0.24em] font-semibold">{label}</span>
      </div>
      <p className="text-3xl font-bold text-[#2B2424] leading-none tabular-nums">{value}</p>
    </div>
  )
}

function WeddingTabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-all duration-150 ${
        active
          ? 'bg-[#8F1D2C] text-white shadow-md'
          : 'bg-transparent text-[#6F6260] border border-[#E8B7C8] hover:text-[#2B2424] hover:bg-[#FBEAF0]'
      }`}
    >
      {icon}{label}
    </button>
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
          <div className="mt-3"><UpgradeGate compact title="Approva o rifiuta solo con Pro" message="Con il piano Pro puoi gestire le richieste in tempo reale." /></div>
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
  const { data, mutate: refresh } = useSWR(
    ['dedications', sessionId],
    () => liveDedications.listForDj(sessionId),
    { refreshInterval: 5_000 },
  )
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
                — {d.guest_name ?? 'Anonimo'}
                <span className="ml-2 normal-case tracking-normal">
                  <WeddingBadge tone={d.status === 'approved' ? 'sage' : d.status === 'rejected' ? 'taupe' : 'gold'}>
                    {d.status}
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
      toast.success('Configurazione aggiornata')
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <WeddingCard tone="cream">
      <h2 className="font-wedding text-2xl text-wedding-ink mb-2 inline-flex items-center gap-2">
        <Tv className="h-5 w-5 text-wedding-gold" /> Visibilità Schermo Live
      </h2>
      <p className="text-xs text-wedding-ink/60 mb-5">
        Scegli quali sezioni visualizzare sullo schermo live. Se nessuna è selezionata, comparirà solo il nome degli sposi centrato.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_photos ?? true}
            onChange={() => toggle('show_photos')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <ImageIcon className="h-4 w-4 text-wedding-gold" />
            Ultime Foto
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_dedications ?? true}
            onChange={() => toggle('show_dedications')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <Heart className="h-4 w-4 text-wedding-gold" />
            Ultime Dediche
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_roulette ?? true}
            onChange={() => toggle('show_roulette')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-wedding-gold" />
            Roulette
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_shoe_game ?? true}
            onChange={() => toggle('show_shoe_game')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <Footprints className="h-4 w-4 text-wedding-gold" />
            Gioco Scarpa
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl bg-white border border-wedding-champagne px-4 py-3 hover:border-wedding-gold/50 transition">
          <input
            type="checkbox"
            checked={screenConfig.show_polls ?? true}
            onChange={() => toggle('show_polls')}
            disabled={saving}
            className="rounded border-wedding-champagne text-wedding-gold focus:ring-wedding-gold"
          />
          <span className="text-sm text-wedding-ink flex items-center gap-1.5">
            <ListChecks className="h-4 w-4 text-wedding-gold" />
            Sondaggi
          </span>
        </label>
      </div>
    </WeddingCard>
  )
}

function GamesPanel({ sessionId, session }: { sessionId: string; session: any }) {
  const { t } = useI18n()
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
      toast.success('Penitenze salvate')
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
      toast.success('Ripristinate penitenze di default')
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

      toast.success('Roulette avviata! Guarda lo schermo live.')

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
        <p className="text-xs text-[#6F6260] mb-4">Penitenze eleganti per intrattenimento matrimonio.</p>

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
            {loadedPenitenze ? 'Modifica penitenze personalizzate' : 'Personalizza penitenze'}
          </button>

          {showPenitenzaEditor && (
            <div className="mt-4 p-4 rounded-xl bg-white border border-wedding-champagne">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-wedding-ink">Modifica Penitenze</h3>
                <div className="flex gap-2">
                  <button onClick={resetToDefault} disabled={editingPenitenze} className="text-xs text-wedding-taupe hover:underline">
                    Ripristina default
                  </button>
                  <button onClick={savePenitenze} disabled={editingPenitenze} className="text-xs text-wedding-gold hover:underline font-semibold">
                    Salva
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
                      placeholder="Penitenza..."
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
                      <option value="soft">Soft</option>
                      <option value="party">Party</option>
                      <option value="wild">Wild</option>
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
                <Plus className="h-3.5 w-3.5" /> Aggiungi penitenza
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
            <span className="text-sm text-[#2B2424] font-medium">Soft (eleganti)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-full bg-white border border-[#E8B7C8] hover:bg-[#FBEAF0] transition">
            <input
              type="checkbox"
              checked={categories.includes('party')}
              onChange={() => toggleCategory('party')}
              className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
            />
            <span className="text-sm text-[#2B2424] font-medium">Party (divertenti)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-full bg-white border border-[#E8B7C8] hover:bg-[#FBEAF0] transition">
            <input
              type="checkbox"
              checked={categories.includes('wild')}
              onChange={() => toggleCategory('wild')}
              className="rounded border-[#E8B7C8] text-[#8F1D2C] focus:ring-[#8F1D2C]"
            />
            <span className="text-sm text-[#2B2424] font-semibold">Wild (estreme)</span>
          </label>
        </div>

        {result && (
          <div className="rounded-2xl border-2 border-[#E8B7C8] bg-white p-8 text-center mb-5 shadow-lg">
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#8F1D2C] mb-3 font-semibold">RISULTATO</p>
            <p className="text-4xl font-semibold text-[#2B2424] leading-tight">{result}</p>
            <p className="text-xs text-[#6F6260] mt-3 italic">Visibile sullo schermo live</p>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <WeddingButton onClick={start} variant="outline" loading={running} icon={<Play className="h-4 w-4" />}>{t('wedding.roulette.start')}</WeddingButton>
          <WeddingButton onClick={spin} variant="gold" loading={running} icon={<Sparkles className="h-4 w-4" />}>{t('wedding.roulette.spin')}</WeddingButton>
          <WeddingButton onClick={reset} variant="ghost" icon={<RotateCw className="h-4 w-4" />}>{t('wedding.roulette.reset')}</WeddingButton>
        </div>
      </WeddingCard>

      <ShoeGamePanel sessionId={sessionId} />

      <BestPhotoPanel sessionId={sessionId} />

      <PollsPanel sessionId={sessionId} />
    </section>
  )
}

function ShoeGamePanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const { data: session, mutate: mutateSession } = useSWR(['session', sessionId], () => live.getSession(sessionId))
  const { data: round, mutate: refresh } = useSWR(
    ['shoe-game', sessionId],
    () => liveGames.getShoeState(sessionId),
    { refreshInterval: 4_000 },
  )
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
    try { await liveGames.startShoe(sessionId); toast.success('Gioco della Scarpa avviato'); refresh() }
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
      toast.success('Domande salvate')
    } catch (e: any) {
      toast.error(e?.message ?? 'Errore nel salvataggio')
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
      toast.success('Domande ripristinate')
    } catch (e: any) {
      toast.error(e?.message ?? 'Errore')
    } finally {
      setEditingQuestions(false)
    }
  }

  return (
    <WeddingCard tone="active">
      <h2 className="font-wedding text-2xl font-semibold text-[#2B2424] mb-2 inline-flex items-center gap-2">
        <Footprints className="h-5 w-5 text-[#8F1D2C]" /> Gioco della Scarpa
      </h2>
      <p className="text-xs text-[#6F6260] mb-5">
        Gli sposi rispondono alzando la scarpa di chi tra i due è la risposta. Solo il DJ può controllare.
      </p>

      {isActive && questions.length > 0 && (
        <div className="rounded-2xl border-2 border-[#E8B7C8] bg-white p-8 text-center mb-5 shadow-lg">
          <p className="text-[10px] uppercase tracking-[0.28em] text-[#8F1D2C] mb-3 font-semibold">
            Domanda {currentIndex + 1}/{questions.length}
          </p>
          <p className="text-3xl font-semibold text-[#2B2424] leading-tight">{questions[currentIndex]}</p>
        </div>
      )}

      <div className="flex gap-2 flex-wrap mb-5">
        <WeddingButton onClick={start} variant="outline" loading={busy} icon={<Play className="h-4 w-4" />}>
          {isActive ? 'Riavvia gioco' : 'Avvia gioco'}
        </WeddingButton>
        <WeddingButton
          onClick={next}
          variant="gold"
          loading={busy}
          disabled={!isActive || currentIndex >= questions.length - 1}
          icon={<SkipForward className="h-4 w-4" />}
        >
          Prossima domanda
        </WeddingButton>
        <WeddingButton onClick={reset} variant="ghost" icon={<RotateCw className="h-4 w-4" />}>
          Reset
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
          {showQuestionsEditor ? 'Chiudi' : 'Personalizza Domande'}
        </button>
      </div>

      {showQuestionsEditor && (
        <div className="mb-5 p-4 rounded-xl bg-white border border-wedding-champagne">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-wedding-ink">Modifica Domande</h3>
            <div className="flex gap-2">
              <button onClick={resetQuestionsToDefault} disabled={editingQuestions} className="text-xs text-wedding-taupe hover:underline">
                Reset Default
              </button>
              <button
                onClick={saveCustomQuestions}
                disabled={editingQuestions || customQuestions.length === 0}
                className="text-xs px-3 py-1 bg-wedding-gold text-white rounded-lg hover:bg-wedding-gold/90 disabled:opacity-50"
              >
                {editingQuestions ? 'Salvataggio...' : 'Salva'}
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
            onClick={() => setCustomQuestions([...customQuestions, 'Nuova domanda'])}
            className="mt-3 text-xs text-wedding-gold hover:underline flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Aggiungi Domanda
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

function BestPhotoPanel({ sessionId }: { sessionId: string }) {
  const { data: photos, mutate: refresh } = useSWR(
    ['photo-votes', sessionId],
    () => bestPhoto.getVotesForDj(sessionId),
    { refreshInterval: 6_000 },
  )

  const sorted = [...(photos ?? [])].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
  const winner = sorted[0]

  return (
    <WeddingCard tone="cream">
      <h2 className="font-wedding text-2xl font-semibold text-[#2B2424] mb-2 inline-flex items-center gap-2">
        <ImageIcon className="h-5 w-5 text-[#8F1D2C]" /> Concorso Foto
      </h2>
      <p className="text-xs text-[#6F6260] mb-5">
        Votazione foto. Ogni ospite può votare una volta per foto.
      </p>

      {sorted.length === 0 ? (
        <p className="text-sm text-[#6F6260] text-center py-4">Nessuna foto approvata ancora.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((p, i) => (
            <div key={p.id} className={`rounded-xl border p-3 flex items-center gap-3 transition-all duration-150 ${
              i === 0 ? 'border-[#8F1D2C] bg-[#FBEAF0] shadow-md' : 'border-[#E8B7C8] bg-white hover:shadow-md'
            }`}>
              {p.url && (
                <img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
              )}
              <div className="flex-1 min-w-0">
                {p.caption && <p className="text-sm font-semibold text-[#2B2424] truncate">{p.caption}</p>}
                <p className="text-xs text-[#6F6260]">{p.guest_name ?? 'Anonimo'}</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-[#8F1D2C] tabular-nums">{p.votes ?? 0}</p>
                <p className="text-[10px] uppercase tracking-wide text-[#6F6260] font-semibold">voti</p>
                {i === 0 && p.votes! > 0 && <p className="text-[11px] text-[#8F1D2C] font-semibold mt-1">🏆 Vincitore</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </WeddingCard>
  )
}

function PollsPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const { data: polls, mutate: refresh } = useSWR(
    ['polls', sessionId],
    () => livePolls.list(sessionId),
    { refreshInterval: 6_000 },
  )
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
            placeholder={`Opzione ${i + 1}`} />
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

function PhotosPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const [photoTab, setPhotoTab] = useState<'album' | 'booth'>('album')
  const { data, mutate: refresh } = useSWR(
    ['photos', sessionId],
    () => livePhotos.listForDj(sessionId),
    { refreshInterval: 6_000 },
  )
  const { data: boothPhotos, mutate: refreshBooth } = useSWR(
    ['booth-photos', sessionId],
    () => livePhotos.listBoothPhotos(sessionId),
    { refreshInterval: 4_000 },
  )
  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    try { await livePhotos.setStatus(id, status); refresh(); refreshBooth() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }
  const toggleFeatured = async (id: string, current: boolean) => {
    try { await livePhotos.setFeatured(id, !current); refreshBooth() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }
  const approvePhoto = async (id: string) => {
    try { await livePhotos.approve(id); refreshBooth() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }
  const remove = async (id: string) => {
    try { await livePhotos.remove(id); refresh(); refreshBooth() }
    catch (e: any) { toast.error(e?.message ?? t('common.errorGeneric')) }
  }

  const envBase = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
  const origin = envBase || (typeof window !== 'undefined' ? window.location.origin : 'https://www.iomixo.com')
  const boothUrl = `${origin}/booth/${sessionId}`
  const [copiedBooth, setCopiedBooth] = useState(false)
  const copyBoothUrl = async () => {
    try { await navigator.clipboard.writeText(boothUrl); setCopiedBooth(true); setTimeout(() => setCopiedBooth(false), 1500) } catch {}
  }

  const items = photoTab === 'album' ? (data ?? []) : (boothPhotos ?? [])
  const showBoothQR = photoTab === 'booth'

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-wedding text-2xl font-semibold text-[#2B2424]">{t('wedding.tabPhotos')}</h2>
        <div className="inline-flex items-center gap-1 rounded-full bg-white p-1 border border-[#E8B7C8] shadow-sm">
          <button
            onClick={() => setPhotoTab('album')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition ${
              photoTab === 'album'
                ? 'bg-[#8F1D2C] text-white'
                : 'text-[#6F6260] hover:text-[#2B2424]'
            }`}
          >
            Album Ospiti
          </button>
          <button
            onClick={() => setPhotoTab('booth')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition inline-flex items-center gap-1.5 ${
              photoTab === 'booth'
                ? 'bg-[#8F1D2C] text-white'
                : 'text-[#6F6260] hover:text-[#2B2424]'
            }`}
          >
            <Camera className="h-3.5 w-3.5" /> Live Booth
          </button>
        </div>
      </div>

      {showBoothQR && (
        <WeddingCard tone="ivory" className="p-4 flex items-center gap-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-wedding-ink mb-1">📸 Live Booth attivo</p>
            <p className="text-xs text-wedding-taupe">Gli invitati possono scansionare il QR o visitare il link per scattare foto eleganti.</p>
            <button
              onClick={copyBoothUrl}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-wedding-burgundy hover:underline"
            >
              {copiedBooth ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedBooth ? 'Link copiato' : 'Copia link'}
            </button>
          </div>
          <div className="bg-white p-3 rounded-xl border-2 border-wedding-gold/30">
            <QRCodeSVG value={boothUrl} size={80} level="M" />
          </div>
        </WeddingCard>
      )}

      {items.length === 0 && (
        <WeddingCard tone="ivory" className="text-center py-8 text-sm text-wedding-ink/50">
          {photoTab === 'booth' ? 'Nessuna foto booth ancora.' : t('wedding.photos.empty')}
        </WeddingCard>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {items.map((p: any) => (
            <div key={p.id} className={`rounded-2xl overflow-hidden border bg-white/80 shadow-wedding relative ${
              p.is_featured ? 'border-wedding-gold/80 ring-2 ring-wedding-gold/40' : 'border-wedding-champagne/60'
            }`}>
              {p.url ? (
                <img src={p.url} alt={p.caption ?? ''} className="w-full aspect-square object-cover" />
              ) : (
                <div className="w-full aspect-square bg-wedding-champagne/20 flex items-center justify-center text-wedding-ink/40">
                  <ImageIcon className="h-8 w-8" />
                </div>
              )}
              {p.is_featured && (
                <div className="absolute top-2 right-2 bg-wedding-gold text-wedding-ink px-2 py-1 rounded-full text-[10px] font-bold shadow-lg">
                  ★ In evidenza
                </div>
              )}
              <div className="p-3">
                <p className="text-xs text-wedding-ink/70 line-clamp-2">{p.caption ?? '—'}</p>
                <p className="text-[10px] uppercase tracking-[0.22em] text-wedding-gold mt-2 flex items-center gap-2">
                  <span>— {p.guest_name ?? 'Anonimo'}</span>
                  <span className="normal-case tracking-normal">
                    <WeddingBadge tone={p.status === 'approved' ? 'sage' : p.status === 'rejected' ? 'taupe' : 'gold'}>
                      {p.status}
                    </WeddingBadge>
                  </span>
                </p>
                <div className="flex gap-1 mt-2">
                  {photoTab === 'booth' && (
                    <button
                      onClick={() => toggleFeatured(p.id, p.is_featured)}
                      className={`p-2 rounded-full flex-1 transition ${
                        p.is_featured
                          ? 'bg-wedding-gold/40 text-wedding-ink hover:bg-wedding-gold/60'
                          : 'bg-wedding-champagne/40 text-wedding-taupe hover:bg-wedding-champagne/60'
                      }`}
                      title="Evidenzia/Rimuovi evidenza"
                    >
                      <Star className={`h-4 w-4 mx-auto ${p.is_featured ? 'fill-current' : ''}`} />
                    </button>
                  )}
                  {p.status !== 'approved' && (
                    <button onClick={() => approvePhoto(p.id)} className="p-2 rounded-full bg-wedding-sage/30 text-[#5f6f59] flex-1 hover:bg-wedding-sage/50 transition">
                      <Check className="h-4 w-4 mx-auto" />
                    </button>
                  )}
                  {p.status !== 'rejected' && (
                    <button onClick={() => setStatus(p.id, 'rejected')} className="p-2 rounded-full bg-wedding-taupe/20 text-wedding-ink/70 flex-1 hover:bg-wedding-taupe/40 transition">
                      <X className="h-4 w-4 mx-auto" />
                    </button>
                  )}
                  <button onClick={() => remove(p.id)} className="p-2 rounded-full bg-wedding-blush/40 text-[#8a4f4a] flex-1 hover:bg-wedding-blush/60 transition">
                    <Trash2 className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
