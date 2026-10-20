'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, RotateCw, Video as VideoIcon, Image as ImageIcon, X, AlertTriangle } from 'lucide-react'
import { livePhotos } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { MEDIA_ACCEPT, classifyFile, refusalReason } from '@/lib/media/mediaTypes'
import { UPLOAD_ERROR_KEYS, FINAL_UPLOAD_REASONS, ALBUM_CLOSED_REASONS } from '@/lib/media/uploadErrors'
import { WeddingGuestButton } from './WeddingGuestUI'

type Status = 'waiting' | 'uploading' | 'done' | 'failed'
interface Item { key: string; file: File; kind: 'photo' | 'video' | null; status: Status; pct: number; reason: string | null }

let seq = 0

/**
 * Guest album uploader (MIOLOVE): any number of photos AND videos in one go, no sign-up. Files are sent one at a time (a phone on mobile data does not
 * hold several 100 MB uploads at once); each one shows its progress, its error and a retry, and a refusal that retrying cannot fix says why. The ORIGINAL
 * of every file is what is stored (lib/events/photoService.ts).
 */
export function GuestMediaUploader({ slug, onUploaded, guestName }: { slug: string; onUploaded?: () => void; guestName?: string }) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const running = useRef(false)
  const patch = useCallback((key: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))), [])

  const add = (files: FileList | null) => {
    if (!files?.length) return
    const next: Item[] = Array.from(files).map((file) => {
      const bad = refusalReason(file)
      return { key: `m${++seq}`, file, kind: classifyFile(file)?.kind ?? null, status: bad ? 'failed' : 'waiting', pct: 0, reason: bad }
    })
    setItems((cur) => [...cur, ...next])
  }

  // One upload at a time, in order.
  useEffect(() => {
    if (running.current) return
    const next = items.find((i) => i.status === 'waiting')
    if (!next) return
    running.current = true
    patch(next.key, { status: 'uploading', pct: 0, reason: null })
    livePhotos.boothUpload(slug, next.file, { guest_name: guestName }, (pct) => patch(next.key, { pct }), { album: true })
      .then(() => { patch(next.key, { status: 'done', pct: 100 }); onUploaded?.() })
      .catch((e: any) => {
        const reason: string = e?.reason ?? 'upload_missing'
        patch(next.key, { status: 'failed', reason })
        // The album is closed for this guest (trial over / limit reached / event ended): do not hammer the server with the rest of the queue.
        if (ALBUM_CLOSED_REASONS.has(reason)) setItems((cur) => cur.map((i) => (i.status === 'waiting' ? { ...i, status: 'failed', reason } : i)))
      })
      .finally(() => { running.current = false; setItems((cur) => [...cur]) })    // wake the effect for the next file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // Do not lose a queue by accident (a phone user swiping the tab away mid-upload).
  const active = items.some((i) => i.status === 'waiting' || i.status === 'uploading')
  useEffect(() => {
    if (!active) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h)
  }, [active])

  const done = items.filter((i) => i.status === 'done').length
  const allDone = items.length > 0 && items.every((i) => i.status === 'done')
  const msg = (reason: string | null) => t(UPLOAD_ERROR_KEYS[reason ?? ''] ?? 'guestAlbum.err.retry')

  return (
    <div data-testid="guest-uploader">
      <input ref={inputRef} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" data-testid="guest-upload-input"
        onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <WeddingGuestButton onClick={() => inputRef.current?.click()} icon={<ImagePlus className="h-5 w-5" />}>
        {items.length ? t('media.guest.more') : t('media.guest.pick')}
      </WeddingGuestButton>
      <p className="mt-3 text-center text-[13px] leading-snug text-wd-muted">{t('media.guest.hint')}</p>

      {items.length > 0 && (
        <section className="mt-5" aria-label={t('media.guest.queue')}>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-wd-muted">{t('media.guest.queue')} · <span data-testid="guest-upload-count">{done}/{items.length}</span></h3>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.key} data-testid="guest-upload-item" data-status={i.status} data-kind={i.kind ?? 'unknown'}
                className="flex items-center gap-3 rounded-2xl border border-wd-border bg-white p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-wd-active text-wd-pink">
                  {i.kind === 'video' ? <VideoIcon className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-wd-ink">{i.file.name}</p>
                  {i.status === 'uploading' && (
                    <div className="mt-1.5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-wd-active" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.pct}>
                        <div className="h-full rounded-full bg-wd-pink transition-all" style={{ width: `${i.pct}%` }} />
                      </div>
                      <p className="mt-1 text-[12px] text-wd-muted" data-testid="guest-upload-pct">{i.pct > 0 ? t('media.guest.sending').replace('{pct}', String(i.pct)) : t('media.guest.preparing')}</p>
                    </div>
                  )}
                  {i.status === 'waiting' && <p className="text-[12px] text-wd-muted">{t('media.guest.waiting')}</p>}
                  {i.status === 'done' && <p className="flex items-center gap-1 text-[12px] font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" />{t('media.guest.done')}</p>}
                  {i.status === 'failed' && <p className="flex items-start gap-1 text-[12px] font-semibold text-red-600" role="alert" data-testid="guest-upload-error" data-reason={i.reason ?? ''}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{msg(i.reason)}</span></p>}
                </div>
                {i.status === 'uploading' && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-wd-pink" aria-hidden />}
                {i.status === 'failed' && !FINAL_UPLOAD_REASONS.has(i.reason ?? '') && (
                  <button type="button" onClick={() => patch(i.key, { status: 'waiting', reason: null, pct: 0 })} data-testid="guest-upload-retry"
                    className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-wd-pink hover:bg-wd-active"><RotateCw className="h-4 w-4" />{t('media.guest.retry')}</button>
                )}
                {(i.status === 'failed' || i.status === 'done') && (
                  <button type="button" aria-label={t('media.guest.remove')} onClick={() => setItems((cur) => cur.filter((x) => x.key !== i.key))}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-wd-muted hover:bg-wd-active"><X className="h-4 w-4" /></button>
                )}
              </li>
            ))}
          </ul>
          {active && <p className="mt-3 text-center text-[12px] text-wd-muted">{t('media.guest.keepOpen')}</p>}
          {allDone && <p className="mt-3 text-center text-[15px] font-semibold text-wd-ink" data-testid="guest-upload-all-done" role="status">{t('media.guest.allDone')}</p>}
        </section>
      )}
    </div>
  )
}
