'use client'
import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import { Download, Check, Trash2, Star, Copy, Camera, Play, CheckCircle2, Image as ImageIcon, Video } from 'lucide-react'
import { MediaLightbox } from '@/components/media/MediaLightbox'
import { downloadOriginal } from '@/lib/media/download'
import { MEDIA_ACCEPT, isVideoMedia, formatDuration } from '@/lib/media/mediaTypes'
import { UPLOAD_ERROR_KEYS } from '@/lib/media/uploadErrors'
import { livePhotos, type LivePhoto } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { usePhotosSignal } from '@/lib/events/usePhotos'
import { WEDDING_BRAND_FILE_PREFIX } from '@/lib/brand/wedding'
import { cn } from '@/lib/utils'
import { WdPage, WdCard, WdButton, WdLinkButton, wdStatusLabel } from './WeddingAdminUI'
import { publicOrigin } from './WeddingHomePage'
import { TrialQuota } from './TrialQuota'
import { AlbumExportButton } from './AlbumExport'

type MediaFilter = 'all' | 'photo' | 'video'

export function WeddingPhotosPage({ session, initialSource = 'album', couple = false }: { session: any; initialSource?: 'album' | 'booth'; couple?: boolean }) {
  const { t } = useI18n()
  const sessionId: string = session.id
  const slug: string = session.public_slug
  const downloadAllLocked = couple && session.access_mode !== 'activated'
  // A MIOLOVE album has ONE guest photo/video collection (the guest page → /booth/[slug] upload feeds it): no separate "Live Booth" view.
  const [source, setSource] = useState<'album' | 'booth'>(couple ? 'album' : initialSource)
  const [filter, setFilter] = useState<MediaFilter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedGuest, setCopiedGuest] = useState(false)
  const [viewer, setViewer] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // One query feeds both tabs (the Live Booth is the same collection filtered by source).
  const photoSignal = usePhotosSignal(sessionId)
  const { data: album, mutate: refresh } = useSWR(['photos', sessionId], () => livePhotos.listForDj(sessionId), { refreshInterval: photoSignal.live ? 60_000 : 4_000 })
  useEffect(() => { if (photoSignal.tick > 0) refresh() }, [photoSignal.tick, refresh])

  const all: LivePhoto[] = (source === 'album' ? album : album?.filter((p) => p.source === 'live_booth')) ?? []
  const items = all.filter((p) => filter === 'all' || (filter === 'video') === isVideoMedia(p))
  const videoCount = all.filter((p) => isVideoMedia(p)).length

  const boothUrl = `${publicOrigin()}/booth/${slug ?? sessionId}`
  const guestUrl = `${publicOrigin()}/live/${slug ?? sessionId}`
  const err = (e: any) => toast.error(UPLOAD_ERROR_KEYS[e?.reason] ? t(UPLOAD_ERROR_KEYS[e.reason]) : (e?.message ?? t('common.errorGeneric')))

  const toggleSel = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const selectedItems = items.filter((p) => selected.has(p.id))
  const allSelected = items.length > 0 && selectedItems.length === items.length

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) await livePhotos.publicUpload(slug, f, { guest_name: session.couple_names ?? undefined }, undefined, { album: couple })
      toast.success(t('wdAdmin.photos.uploaded'))
      refresh()
    } catch (e: any) { err(e) } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // The ORIGINALS of the given media, one after the other (a short pause keeps browsers from blocking a burst of downloads).
  const downloadItems = (list: LivePhoto[]) => {
    list.forEach((p, i) => {
      if (!p.url && !p.original_path) return
      setTimeout(() => { downloadOriginal(p, WEDDING_BRAND_FILE_PREFIX).catch(err) }, i * 400)
    })
  }

  const run = async (fn: () => Promise<unknown>) => { try { await fn(); refresh() } catch (e: any) { err(e) } }
  const bulk = async (fn: (p: LivePhoto) => Promise<unknown>) => {
    try { await Promise.all(selectedItems.map(fn)); setSelected(new Set()); refresh() } catch (e: any) { err(e) }
  }

  const filterOpts: Array<{ value: MediaFilter; label: string; count: number; icon?: React.ReactNode }> = [
    { value: 'all', label: t('wdAdmin.photos.all'), count: all.length },
    { value: 'photo', label: t('wdAdmin.photos.photos'), count: all.length - videoCount, icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { value: 'video', label: t('wdAdmin.photos.videos'), count: videoCount, icon: <Video className="h-3.5 w-3.5" /> },
  ]

  return (
    <WdPage width="wide" title={t('wdAdmin.nav.photos')}>
      <TrialQuota session={session} />
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
        <input ref={fileRef} type="file" accept={couple ? MEDIA_ACCEPT : 'image/*'} multiple hidden onChange={(e) => onUpload(e.target.files)} data-testid="photos-upload-input" />
        <WdButton className="!px-6 !py-3.5 !rounded-2xl" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? t('common.loading') : t('wdAdmin.photos.upload')}
        </WdButton>
        <div className="flex flex-wrap items-center gap-3">
          {/* MIOLOVE album: a selection downloads those ORIGINALS; no selection = ONE server-built archive of every original (paid album). IOMIXO events keep the file-by-file download. */}
          {couple && !selectedItems.length ? (
            <AlbumExportButton sessionId={sessionId} disabled={items.length === 0 || downloadAllLocked} title={downloadAllLocked ? t('albumPlan.downloadAllLocked') : undefined} />
          ) : (
            <WdButton className="!rounded-2xl !py-3" variant="secondary" icon={<Download className="h-4 w-4 text-wd-muted" />}
              data-testid="photos-download"
              title={downloadAllLocked && !selectedItems.length ? t('albumPlan.downloadAllLocked') : undefined}
              onClick={() => downloadItems(selectedItems.length ? selectedItems : items)} disabled={items.length === 0 || (downloadAllLocked && !selectedItems.length)}>
              {selectedItems.length ? `${t('wdAdmin.photos.download')} (${selectedItems.length})` : t('wdAdmin.photos.downloadAll')}
            </WdButton>
          )}
          {!couple && <div className="inline-flex rounded-2xl border border-wd-border bg-white p-1">
            {([['album', t('weddingPanels.guestAlbum')], ['booth', t('weddingPanels.liveBooth')]] as const).map(([v, l]) => (
              <button key={v} onClick={() => { setSource(v); setSelected(new Set()) }}
                className={cn('inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors', source === v ? 'bg-wd-active text-wd-pink' : 'text-wd-muted hover:text-wd-ink')}>
                {v === 'booth' && <Camera className="h-3.5 w-3.5" />}{l}
              </button>
            ))}
          </div>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <WdButton className="!rounded-2xl" variant="secondary" disabled={items.length === 0} icon={<CheckCircle2 className="h-4 w-4 text-wd-muted" />}
          onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((p) => p.id)))}>
          {allSelected ? t('wdAdmin.photos.deselectAll') : `${t('wdAdmin.photos.selectAll')} (${items.length})`}
        </WdButton>
        <div className="inline-flex items-center rounded-full border border-wd-border bg-white p-1">
          {filterOpts.map((o) => {
            const active = filter === o.value
            return (
              <button key={o.value} onClick={() => { setFilter(o.value); setSelected(new Set()) }}
                className={cn('inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors', active ? 'bg-wd-pink text-white' : 'text-wd-ink hover:bg-wd-active')}>
                {!active && o.icon}{o.label}
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', active ? 'bg-white/25 text-white' : 'bg-wd-active text-wd-pink')}>{o.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {selectedItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-wd-border bg-white px-4 py-3 text-sm">
          <span className="mr-2 font-semibold text-wd-ink">{selectedItems.length} {t('wdAdmin.photos.selected')}</span>
          <WdButton size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => { if (confirm(t('wdAdmin.photos.confirmDelete'))) bulk((p) => livePhotos.remove(p.id)) }}>{t('common.delete')}</WdButton>
        </div>
      )}

      {couple && source === 'album' && (
        <WdCard className="flex items-center gap-5">
          <div className="min-w-0 flex-1" data-testid="wd-photos-guest-link">
            <p className="text-sm font-bold text-wd-ink">{t('wdAdmin.photos.guestLinkTitle')}</p>
            <p className="mt-1 text-[13px] text-wd-muted">{t('wdAdmin.photos.guestLinkDesc')}</p>
            <p className="mt-2 truncate font-mono text-[12px] text-wd-ink" title={guestUrl}>{guestUrl}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <WdButton variant="secondary" size="sm" icon={copiedGuest ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                onClick={async () => { try { await navigator.clipboard.writeText(guestUrl); setCopiedGuest(true); setTimeout(() => setCopiedGuest(false), 1500) } catch {} }}>
                {copiedGuest ? t('weddingPanels.linkCopied') : t('weddingPanels.copyLink')}
              </WdButton>
              <WdLinkButton href={guestUrl} size="sm">{t('weddingPanels.open')}</WdLinkButton>
            </div>
          </div>
          <div className="shrink-0 rounded-xl border border-wd-border bg-white p-2"><QRCodeSVG value={guestUrl} size={104} level="M" /></div>
        </WdCard>
      )}

      {source === 'booth' && (
        <WdCard className="flex items-center gap-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-wd-ink">{t('weddingPanels.liveBoothActive')}</p>
            <p className="mt-1 text-[13px] text-wd-muted">{t('weddingPanels.liveBoothDesc')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <WdButton variant="secondary" size="sm" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                onClick={async () => { try { await navigator.clipboard.writeText(boothUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }}>
                {copied ? t('weddingPanels.linkCopied') : t('weddingPanels.copyLink')}
              </WdButton>
              <WdLinkButton href={boothUrl} size="sm">{t('weddingPanels.open')}</WdLinkButton>
            </div>
          </div>
          <div className="shrink-0 rounded-xl border border-wd-border bg-white p-2"><QRCodeSVG value={boothUrl} size={88} level="M" /></div>
        </WdCard>
      )}

      {items.length === 0 ? (
        <WdCard className="py-16 text-center">
          <Camera className="mx-auto h-8 w-8 text-wd-pink/60" />
          <p className="mt-3 text-sm text-wd-muted">{source === 'booth' ? t('weddingPanels.noBoothPhotos') : t('wedding.photos.empty')}</p>
        </WdCard>
      ) : (
        <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((p, idx) => {
            const sel = selected.has(p.id)
            const video = isVideoMedia(p)
            const shown = p.thumb_url ?? (video ? null : p.url)
            return (
              <div key={p.id} data-testid="photo-tile" data-media={video ? 'video' : 'photo'} className={cn('group relative aspect-square overflow-hidden rounded-2xl bg-wd-active shadow-sm', sel && 'ring-[3px] ring-wd-pink')}>
                <button type="button" onClick={() => setViewer(idx)} aria-label={t(video ? 'media.gallery.openVideo' : 'media.gallery.openPhoto')} data-testid="photo-open"
                  className="absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink">
                  {shown
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={shown} alt={p.caption ?? ''} className="h-full w-full object-cover" loading="lazy" />
                    : <span className="flex h-full w-full items-center justify-center bg-wd-ink/80 text-white/70"><Video className="h-8 w-8" /></span>}
                </button>
                {video && (
                  <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white"><Play className="h-5 w-5" /></span>
                )}
                {video && formatDuration(p.duration_sec) && (
                  <span className="pointer-events-none absolute bottom-9 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">{formatDuration(p.duration_sec)}</span>
                )}
                <button
                  type="button"
                  onClick={() => toggleSel(p.id)}
                  aria-pressed={sel}
                  aria-label={t('wdAdmin.photos.select')}
                  className={cn('absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white transition', sel ? 'bg-wd-pink text-white' : 'bg-black/10 text-transparent')}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                {p.is_featured && <span className="pointer-events-none absolute right-10 top-2 rounded-full bg-wd-pink p-1 text-white"><Star className="h-3 w-3 fill-current" /></span>}
                <div className="absolute left-2 top-2 hidden flex-col gap-1 group-hover:flex group-focus-within:flex">
                  {source === 'booth' && (
                    <button onClick={() => run(() => livePhotos.setFeatured(p.id, !p.is_featured))} title={t('weddingPanels.toggleFeatured')} className="rounded-full bg-white/95 p-1.5 text-wd-pink"><Star className="h-3.5 w-3.5" /></button>
                  )}
                  <button onClick={() => downloadOriginal(p, WEDDING_BRAND_FILE_PREFIX).catch(err)} title={t('media.gallery.downloadOriginal')} data-testid="photo-download-one" className="rounded-full bg-white/95 p-1.5 text-wd-ink"><Download className="h-3.5 w-3.5" /></button>
                  <button onClick={() => { if (confirm(t('wdAdmin.photos.confirmDelete'))) run(() => livePhotos.remove(p.id)) }} title={t('common.delete')} data-testid="photo-delete" className="rounded-full bg-white/95 p-1.5 text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 p-2">
                  {p.status && p.status !== 'approved'
                    ? <span className="shrink-0 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold uppercase text-wd-muted">{wdStatusLabel(t, p.status)}</span>
                    : <span />}
                  <span className="min-w-0 max-w-full truncate rounded-full bg-wd-pink px-2.5 py-1 text-[11px] font-semibold text-white">{p.guest_name ?? t('weddingPanels.anonymous')}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    {viewer !== null && items[viewer] && (
        <MediaLightbox items={items} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)}
          onDownload={(p) => downloadOriginal(p, WEDDING_BRAND_FILE_PREFIX).catch(err)} />
      )}
    </WdPage>
  )
}
