'use client'
import { useState } from 'react'
import { Check, ImageIcon, X } from 'lucide-react'
import { live } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { SCREEN_BACKGROUNDS, resolveScreenBackground, type ScreenBackgroundId } from '@/lib/miolove/screenBackgrounds'
import { WdButton } from './WeddingAdminUI'

/** "Sfondi": the album owner picks the background of the big screen. Saves only the preset id (screenConfig.backgroundTheme). */
export function ScreenBackgroundButton({ sessionId, screenConfig, onSaved }: { sessionId: string; screenConfig: unknown; onSaved?: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<ScreenBackgroundId>(resolveScreenBackground(screenConfig).id)
  const [sel, setSel] = useState<ScreenBackgroundId>(saved)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  const show = () => { setSel(saved); setErr(false); setOpen(true) }
  const apply = async (id: ScreenBackgroundId) => {
    setBusy(true); setErr(false)
    try {
      await live.updateSession(sessionId, { screen_config: { backgroundTheme: id } })
      setSaved(id); setSel(id); setOpen(false); onSaved?.()
    } catch { setErr(true) } finally { setBusy(false) }
  }
  return (
    <>
      <button type="button" onClick={show} data-testid="screen-bg-open"
        className="mt-3 ml-2 inline-flex items-center gap-1.5 rounded-full border border-wd-border bg-white px-3 py-1.5 text-xs font-semibold text-wd-ink hover:bg-wd-active">
        <ImageIcon className="h-3 w-3" /> {t('wdAdmin.screenBg.button')}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={t('wdAdmin.screenBg.title')} data-testid="screen-bg-modal"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false) }}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-wd-ink">{t('wdAdmin.screenBg.title')}</h3>
                <p className="mt-1 text-[13px] text-wd-muted">{t('wdAdmin.screenBg.desc')}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} aria-label={t('wdAdmin.screenBg.close')} className="rounded-lg p-1 text-wd-muted hover:bg-wd-active"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup">
              {SCREEN_BACKGROUNDS.map((b) => {
                const active = sel === b.id
                return (
                  <button key={b.id} type="button" role="radio" aria-checked={active} onClick={() => setSel(b.id)} data-testid={`screen-bg-${b.id}`} data-active={active ? 'true' : 'false'}
                    className={cn('overflow-hidden rounded-xl border-2 text-left transition-colors', active ? 'border-wd-pink' : 'border-wd-border hover:border-wd-muted')}>
                  <div className="relative aspect-video bg-gradient-to-br from-[#0f172a] via-[#1a1f2e] to-[#0f172a]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {b.preview && <img src={b.preview} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                      {active && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-wd-pink text-white" data-testid="screen-bg-check"><Check className="h-3 w-3" /></span>}
                    </div>
                    <p className="px-2.5 py-2 text-xs font-semibold text-wd-ink">{t(`wdAdmin.screenBg.${b.id}`)}{saved === b.id && <span className="ml-1 font-normal text-wd-muted">· {t('wdAdmin.screenBg.current')}</span>}</p>
                  </button>
                )
              })}
            </div>
            {err && <p className="mt-3 text-xs text-red-600" role="alert" data-testid="screen-bg-error">{t('wdAdmin.screenBg.error')}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <WdButton variant="ghost" onClick={() => apply('default')} disabled={busy || saved === 'default'} data-testid="screen-bg-reset">{t('wdAdmin.screenBg.reset')}</WdButton>
              <WdButton variant="primary" onClick={() => apply(sel)} disabled={busy || sel === saved} data-testid="screen-bg-apply">{t('wdAdmin.screenBg.apply')}</WdButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
