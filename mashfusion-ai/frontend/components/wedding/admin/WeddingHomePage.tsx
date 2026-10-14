'use client'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { QRCodeSVG } from 'qrcode.react'
import { Heart, CalendarDays, Copy, Check, Download, Power, Maximize2, Plus, ExternalLink, Image as ImageIcon } from 'lucide-react'
import { liveDedications, livePhotos, livePolls, type LivePoll } from '@/lib/api'
import { useDedicationsSignal } from '@/lib/events/useDedications'
import { usePollsSignal } from '@/lib/events/usePolls'
import { useI18n } from '@/lib/i18n'
import { WdPage, WdCard, WdButton, WdLinkButton } from './WeddingAdminUI'

export const isVideoUrl = (u: string | null | undefined) => !!u && /\.(mp4|mov|webm|m4v|ogv)(\?|#|$)/i.test(u)

export function publicOrigin() {
  const envBase = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
  return envBase || (typeof window !== 'undefined' ? window.location.origin : 'https://www.iomixo.com')
}

export function downloadQrPng(svgId: string, filename: string, transparent = false) {
  const svg = document.getElementById(svgId) as SVGSVGElement | null
  if (!svg) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  if (transparent) clone.querySelectorAll('path').forEach((p) => { if (p.getAttribute('fill')?.toLowerCase() === '#ffffff') p.setAttribute('fill', 'none') })
  const xml = new XMLSerializer().serializeToString(clone)
  const img = new window.Image()
  const objectUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
  img.onload = () => {
    const c = document.createElement('canvas'); const s = 1024
    c.width = s; c.height = s
    const ctx = c.getContext('2d')!
    if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s, s) }
    ctx.drawImage(img, 0, 0, s, s)
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = filename; a.click()
    URL.revokeObjectURL(objectUrl)
  }
  img.src = objectUrl
}

interface Props {
  session: any
  pendingRequests: number
  togglingActive: boolean
  onToggleActive: () => void
}

export function WeddingHomePage({ session, pendingRequests, togglingActive, onToggleActive }: Props) {
  const { t } = useI18n()
  const sessionId: string = session.id
  const slug: string = session.public_slug
  const url = `${publicOrigin()}/live/${slug}`
  const [copied, setCopied] = useState(false)
  const [transparentQr, setTransparentQr] = useState(false)

  const dedSignal = useDedicationsSignal(sessionId)
  const { data: dedications, mutate: refreshDed } = useSWR(['dedications', sessionId], () => liveDedications.listForDj(sessionId), { refreshInterval: dedSignal.live ? 60_000 : 8_000 })
  useEffect(() => { if (dedSignal.tick > 0) refreshDed() }, [dedSignal.tick, refreshDed])
  const { data: photos } = useSWR(['photos', sessionId], () => livePhotos.listForDj(sessionId), { refreshInterval: 8_000 })
  const pollSignal = usePollsSignal(sessionId)
  const { data: polls, mutate: refreshPolls } = useSWR(['polls', sessionId], () => livePolls.list(sessionId), { refreshInterval: pollSignal.live ? 60_000 : 8_000 })
  useEffect(() => { if (pollSignal.tick > 0) refreshPolls() }, [pollSignal.tick, refreshPolls])
  const activeGames = (polls ?? []).filter((p: LivePoll) => p.is_active).length

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  const names: string = session.couple_names ?? session.event_name
  const dateLabel = session.wedding_date ? new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' }) : null

  const all = photos ?? []
  const videoCount = all.filter((p) => isVideoUrl(p.url)).length
  const stills = all.filter((p) => p.url && !isVideoUrl(p.url) && p.status !== 'rejected')
  const hero = stills[0]?.url ?? null
  const thumbs = stills.slice(1, 7)

  const guestCfg: Record<string, boolean | undefined> = session.guest_config ?? {}
  const requestsOn = guestCfg.requests !== false

  return (
    <WdPage
      width="wide"
      title={session.event_name}
      subtitle={session.description || t('wdAdmin.home.subtitle')}
      actions={
        <WdButton variant="secondary" onClick={onToggleActive} disabled={togglingActive} icon={<Power className="h-4 w-4" />}>
          {session.is_active ? t('common.close') : t('common.open')}
        </WdButton>
      }
    >
      <div className="-mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-wd-muted">
        {dateLabel && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{dateLabel}</span>}
        {session.venue_name && <span>{session.venue_name}</span>}
        <span className={session.is_active ? 'font-semibold text-emerald-600' : 'font-semibold'}>{session.is_active ? t('sessions.active') : t('sessions.closed')}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[{ v: all.length - videoCount, l: t('wdAdmin.photos.photos') }, { v: videoCount, l: t('wdAdmin.photos.videos') }].map((s) => (
          <div key={s.l} className="rounded-[20px] border border-wd-border bg-white px-6 py-5">
            <p className="text-[32px] font-bold leading-none tabular-nums text-wd-pink">{s.v}</p>
            <p className="mt-2 text-sm text-wd-muted">{s.l}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          { v: pendingRequests, l: t('weddingPanels.statRequests') },
          { v: (dedications ?? []).length, l: t('weddingPanels.statDedications') },
          { v: activeGames, l: t('weddingPanels.statGames') },
        ].map((s) => (
          <div key={s.l} className="rounded-[20px] border border-wd-border bg-white px-5 py-4">
            <p className="text-2xl font-bold leading-none tabular-nums text-wd-ink">{s.v}</p>
            <p className="mt-1.5 text-xs text-wd-muted">{s.l}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-stretch gap-3">
        <div className="min-w-0 flex-1 basis-[260px] truncate rounded-xl border border-wd-border bg-white px-4 py-3 font-mono text-[13px] text-wd-ink" title={url}>{url}</div>
        <WdButton variant="secondary" onClick={copy} icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
          {copied ? t('weddingPanels.copied') : t('wdAdmin.home.copy')}
        </WdButton>
        <WdLinkButton href={url} variant="primary" icon={<ExternalLink className="h-4 w-4" />}>{t('wdAdmin.home.openShort')}</WdLinkButton>
      </div>

      <div className="grid gap-8 pt-3 md:grid-cols-[210px_210px] lg:grid-cols-[210px_210px_minmax(0,1fr)]">
        <div>
          <div className="rounded-[28px] border-2 border-wd-pink bg-white p-5">
            <QRCodeSVG id="wd-qrcode-svg" value={url} size={170} level="M" bgColor="#ffffff" includeMargin={false} className="h-auto w-full" />
          </div>
          <WdButton className="mt-4 w-full" variant="secondary" icon={<Download className="h-4 w-4" />}
            onClick={() => downloadQrPng('wd-qrcode-svg', `iomixo-${slug}.png`, transparentQr)}>
            {t('wdAdmin.home.downloadQr')}
          </WdButton>
          <label className="mt-3 flex items-center gap-2 text-xs text-wd-muted cursor-pointer">
            <input type="checkbox" checked={transparentQr} onChange={(e) => setTransparentQr(e.target.checked)} className="h-3.5 w-3.5" />
            {t('wdAdmin.home.transparentBg')}
          </label>
        </div>

        <div className="mx-auto w-[210px]">
          <div className="overflow-hidden rounded-[30px] border-[5px] border-wd-ink bg-white">
            <div className="relative h-[170px] bg-wd-active">
              {hero && /* eslint-disable-next-line @next/next/no-img-element */ <img src={hero} alt="" className="h-full w-full object-cover" />}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2.5 pt-8 text-center text-sm font-bold text-white">{names}</div>
            </div>
            <div className="px-3 py-3 text-center">
              <span className="inline-flex items-center gap-1 rounded-full bg-wd-pink px-3 py-1.5 text-[11px] font-bold text-white">
                <Plus className="h-3 w-3" /> {requestsOn ? t('guestVisibility.requests') : t('guestVisibility.liveBooth')}
              </span>
              <p className="mt-1.5 text-[10px] text-wd-muted">{all.length} {t('wdAdmin.home.photosAndVideos')}</p>
            </div>
            <div className="grid grid-cols-3 gap-1 px-1.5 pb-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square overflow-hidden rounded-md bg-wd-active">
                  {thumbs[i]?.url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={thumbs[i].url!} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 md:col-span-2 lg:col-span-1">
          <h2 className="text-base font-bold text-wd-ink">{t('wdAdmin.home.screenPreview')}</h2>
          <p className="mt-1 mb-3 text-[13px] text-wd-muted">{t('wdAdmin.home.screenPreviewDesc')}</p>
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-wd-border bg-wd-active">
            {hero && /* eslint-disable-next-line @next/next/no-img-element */ <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            {!hero && <ImageIcon className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-wd-pink/50" />}
            {session.is_active && (
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">
                <span className="h-2 w-2 rounded-full bg-red-500" /> {t('wdAdmin.home.live')}
              </span>
            )}
            {session.screen_mode_enabled && (
              <a href={`/screen/${slug}`} target="_blank" rel="noopener noreferrer"
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-black/70">
                <Maximize2 className="h-3 w-3" /> {t('wdAdmin.home.fullscreen')}
              </a>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/55 to-transparent px-4 pb-3 pt-10 text-white">
              <span className="text-sm font-bold">{names}</span>
              {dateLabel && <span className="text-xs">{dateLabel}</span>}
            </div>
          </div>
          {!session.screen_mode_enabled && <p className="mt-2 text-xs text-wd-muted">{t('wdAdmin.home.screenOff')}</p>}
        </div>
      </div>

      <WdCard title={t('weddingPanels.djRemoteCtrl')} description={t('weddingPanels.qrRemoteHint')} className="!mt-8">
        <div className="flex items-center gap-5">
          <div className="shrink-0 rounded-xl border border-wd-border bg-white p-2">
            <QRCodeSVG value={`${publicOrigin()}/remote/${slug}`} size={88} level="M" includeMargin={false} />
          </div>
          <WdLinkButton href={`${publicOrigin()}/remote/${slug}`} size="sm" icon={<ExternalLink className="h-4 w-4" />}>{t('weddingPanels.open')}</WdLinkButton>
        </div>
      </WdCard>
    </WdPage>
  )
}
