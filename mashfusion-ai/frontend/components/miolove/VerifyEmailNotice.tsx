'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { CheckCircle2, Loader2, Mail, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/AuthProvider'
import { resendErrorI18nKey, resendVerification } from '@/lib/auth'
import { useAccountRole } from '@/lib/roles'
import { useI18n } from '@/lib/i18n'
import { VERIFY_RECHECK_MS, VERIFY_RESEND_COOLDOWN_MS, shouldShowVerifyNotice, verifyNoticeDismissKey, verifyNoticeHiddenHere, type NoticePlacement } from '@/lib/miolove/verifyNotice'

const readDismissed = (uid: string): boolean => { try { return window.sessionStorage.getItem(verifyNoticeDismissKey(uid)) === '1' } catch { return false } }

/**
 * MIOLOVE only (couple accounts with an unverified address): a discreet reminder with "resend" and "close". It never blocks anything. It disappears by itself
 * once the address is verified: Firebase does not push that to a tab that stayed open, so the user is re-read when the tab opens / comes back to the foreground.
 *
 * Two placements, never both at once: `layout` (top of every dashboard page) and `onboarding` (inside the first-album screen, which is a full-screen layer ABOVE the layout and would hide it).
 * The layout one steps aside on /onboarding, so there is exactly one notice on screen and in the page.
 */
export function VerifyEmailNotice({ placement = 'layout' }: { placement?: NoticePlacement }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const { isCouple, accountType, ready } = useAccountRole()
  const { t, locale } = useI18n()
  const [, refresh] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooling, setCooling] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; key: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const uid = user?.uid

  useEffect(() => { setNote(null) }, [uid])
  useEffect(() => { setDismissed(uid ? readDismissed(uid) : false) }, [uid, pathname])         // the layout instance outlives page changes: a notice closed on /onboarding must stay closed on the next page
  useEffect(() => () => clearTimeout(timer.current), [])

  const active = !!user && !user.isAnonymous && !user.emailVerified && isCouple
  useEffect(() => {
    if (!user || !active) return
    let last = 0
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < VERIFY_RECHECK_MS) return
      last = Date.now()
      user.reload().then(() => refresh((n) => n + 1)).catch(() => { /* offline / expired session: the next focus tries again */ })
    }
    check()
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check)
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [user, active])

  if (verifyNoticeHiddenHere(placement, pathname) || !shouldShowVerifyNotice({ user, isCouple, accountType, ready, dismissed })) return null

  const resend = async () => {
    setBusy(true); setNote(null)
    try {
      await resendVerification(user?.email ?? '', 'couple', locale)
      setNote({ ok: true, key: 'auth.verifyNoticeSent' }); setCooling(true)
      timer.current = setTimeout(() => setCooling(false), VERIFY_RESEND_COOLDOWN_MS)
    } catch (e) { setNote({ ok: false, key: resendErrorI18nKey(e) ?? 'auth.resendFailed' }) }
    finally { setBusy(false) }
  }
  const close = () => { setDismissed(true); try { if (uid) window.sessionStorage.setItem(verifyNoticeDismissKey(uid), '1') } catch { /* private mode: hidden until the next render */ } }

  return (
    <div className={placement === 'onboarding' ? 'px-4 pt-1' : 'px-4 pt-3 md:px-8'} data-testid="verify-notice" data-placement={placement}>
      <div className={`mx-auto flex ${placement === 'onboarding' ? 'max-w-[620px]' : 'max-w-5xl'} flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-wd-border bg-white px-4 py-2.5 text-sm text-wd-ink shadow-sm`} role="status">
        <Mail className="h-4 w-4 shrink-0 text-wd-pink" aria-hidden />
        <p className="min-w-0 flex-1 basis-60 leading-snug">{t('auth.verifyNoticeText')}</p>
        {note && <p className={`flex items-center gap-1 text-xs font-medium ${note.ok ? 'text-emerald-700' : 'text-red-600'}`} data-testid="verify-notice-note">{note.ok && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}{t(note.key)}</p>}
        <button type="button" onClick={resend} disabled={busy || cooling} data-testid="verify-notice-resend"
          className="inline-flex items-center gap-1.5 rounded-full border border-wd-border px-3 py-1 text-xs font-semibold text-wd-pink transition hover:bg-wd-active disabled:cursor-not-allowed disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}{t('auth.verifyNoticeResend')}
        </button>
        <button type="button" onClick={close} aria-label={t('auth.verifyNoticeClose')} title={t('auth.verifyNoticeClose')} data-testid="verify-notice-close"
          className="rounded-full p-1 text-wd-muted transition hover:bg-wd-active hover:text-wd-ink"><X className="h-4 w-4" aria-hidden /></button>
      </div>
    </div>
  )
}
