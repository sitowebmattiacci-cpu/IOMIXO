'use client'
import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, RotateCw } from 'lucide-react'
import { livePhotos } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { triggerDownload } from '@/lib/media/download'
import { WdButton } from './WeddingAdminUI'

type Phase = 'idle' | 'requesting' | 'queued' | 'preparing' | 'ready' | 'failed'
/** No sign of life from the server for this long (the trigger never started, or died): stop waiting and offer a retry. */
const STALL_MS = 4 * 60 * 1000

/**
 * "Download everything": ONE click asks the server to pack the ORIGINALS (photos + videos) into a single ZIP, shows the progress, and starts the
 * download when it is ready. The packing runs on the server (Cloud Function, streamed), so a big album never goes through the browser's memory.
 */
export function AlbumExportButton({ sessionId, disabled, title, mediaIds }: { sessionId: string; disabled?: boolean; title?: string; /** A selection: ONE archive with just these media (2+); omitted = the whole album. */ mediaIds?: string[] }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ processed: 0, total: 0 })
  const [message, setMessage] = useState<string | null>(null)
  const last = useRef<{ eventId: string; exportId: string; scope: string } | null>(null)
  const scope = mediaIds ? [...mediaIds].sort().join(',') : ''
  const picked = !!mediaIds
  const stop = useRef<(() => void) | null>(null)
  const stall = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  // A different selection is a different download: leave the finished / failed state of the previous one.
  useEffect(() => { if (phase === 'ready' || phase === 'failed') { setPhase('idle'); setMessage(null) } }, [scope])    // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current?.(); if (stall.current) clearTimeout(stall.current) } }, [])

  const fail = (msg: string) => { stop.current?.(); stop.current = null; if (stall.current) clearTimeout(stall.current); if (alive.current) { setPhase('failed'); setMessage(msg) } }
  const reasonText = (e: any): string => {
    const r = e?.reason as string | undefined
    if (r === 'export_requires_album') return t('albumPlan.downloadAllLocked')
    if (r === 'export_empty') return t('media.export.empty')
    if (r === 'export_busy') return t('media.export.busy')
    if (r === 'export_media_invalid') return t('media.export.invalid')
    if (r === 'export_selection_too_large') return t('media.export.tooMany')
    if (r === 'export_expired') return t('media.export.expired')
    return t('media.export.failed')
  }
  const fetchAndDownload = async (eventId: string, exportId: string) => {
    try {
      const r = await livePhotos.exportUrl(eventId, exportId)
      if (!alive.current) return
      triggerDownload(r.url, r.fileName || 'album.zip', { sameTab: true }); setPhase('ready'); setMessage(null)
    } catch (e) { fail(reasonText(e)) }
  }
  const arm = () => { if (stall.current) clearTimeout(stall.current); stall.current = setTimeout(() => fail(t('media.export.failed')), STALL_MS) }

  const start = async () => {
    stop.current?.(); setPhase('requesting'); setMessage(null); setProgress({ processed: 0, total: 0 })
    try {
      const r = await livePhotos.requestExport(sessionId, mediaIds)
      if (!alive.current) return
      last.current = { eventId: r.eventId, exportId: r.exportId, scope }; setProgress({ processed: 0, total: r.total }); setPhase('queued'); arm()
      stop.current = await livePhotos.watchExport(r.eventId, r.exportId, (x) => {
        if (!alive.current) return
        if (!x) return fail(t('media.export.failed'))
        if (x.status === 'ready') { stop.current?.(); stop.current = null; if (stall.current) clearTimeout(stall.current); void fetchAndDownload(r.eventId, r.exportId); return }
        if (x.status === 'failed') return fail(t('media.export.failed'))
        arm(); setPhase(x.status); setProgress({ processed: x.processed, total: x.total })
      }, () => fail(t('media.export.failed')))
    } catch (e) { fail(reasonText(e)) }
  }

  const busy = phase === 'requesting' || phase === 'queued' || phase === 'preparing'
  const idle = picked ? `${t('wdAdmin.photos.download')} (${mediaIds!.length})` : t('wdAdmin.photos.downloadAll')
  const label = picked && (phase === 'requesting' || phase === 'queued' || phase === 'preparing') ? t('media.export.selectionPreparing')
    : phase === 'requesting' || phase === 'queued' ? t('media.export.starting')
    : phase === 'preparing' ? t('media.export.preparing').replace('{done}', String(progress.processed)).replace('{total}', String(progress.total))
    : phase === 'ready' ? (picked ? t('media.export.selectionReadyButton') : t('media.export.again')) : phase === 'failed' ? t('media.export.retry') : idle
  return (
    <div className="flex flex-col items-end gap-1" data-testid="album-export" data-phase={phase} data-scope={picked ? 'selection' : 'album'}>
      <WdButton className="!rounded-2xl !py-3" variant="secondary" data-testid="photos-download" disabled={disabled || busy} title={title ?? t('media.export.hint')}
        icon={busy ? <Loader2 className="h-4 w-4 animate-spin text-wd-muted" /> : phase === 'failed' ? <RotateCw className="h-4 w-4 text-wd-muted" /> : <Download className="h-4 w-4 text-wd-muted" />}
        onClick={() => { if (phase === 'ready' && last.current && last.current.scope === scope) void fetchAndDownload(last.current.eventId, last.current.exportId); else void start() }}>
        {label}
      </WdButton>
      {phase === 'ready' && <p className="text-[12px] text-emerald-600" data-testid="export-status" role="status">{picked ? t('media.export.selectionReady') : t('media.export.ready')}</p>}
      {phase === 'failed' && message && <p className="max-w-[260px] text-right text-[12px] text-red-600" data-testid="export-status" role="alert">{message}</p>}
      {busy && <p className="text-[12px] text-wd-muted" data-testid="export-status" role="status">{t('media.export.keepOpen')}</p>}
    </div>
  )
}
