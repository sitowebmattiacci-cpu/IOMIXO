'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { signInWithGoogle, googleErrorI18nKey } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { usePortal } from '@/components/portal/PortalProvider'
import { cn } from '@/lib/utils'

const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
)

/**
 * "Continue with Google" for the MIOLOVE login / register. Popup flow with its own loading state; the portal decides the role of a NEW account
 * (a returning account keeps the one it has), and the landing page is the portal's home like after an e-mail sign-in.
 */
export function GoogleButton({ className }: { className?: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const { config: portal } = usePortal()
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)

  const run = async () => {
    if (busy.current) return                       // a second click while the popup is open must not start another sign-in
    busy.current = true; setLoading(true)
    try {
      await signInWithGoogle(portal.accountType)
      toast.success(t('auth.loginSuccess'))
      router.push(portal.home)
    } catch (err) {
      const key = googleErrorI18nKey(err)
      if (key) toast.error(t(key))
    } finally { busy.current = false; setLoading(false) }
  }

  return (
    <button
      type="button" onClick={run} disabled={loading} data-testid="google-signin" aria-busy={loading}
      className={cn(
        'flex min-h-[48px] w-full items-center justify-center gap-3 rounded-xl border border-wd-border bg-white px-4 py-3 text-sm font-semibold text-wd-ink',
        'transition hover:bg-wd-active/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/30 disabled:cursor-wait disabled:opacity-70', className,
      )}
    >
      {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-wd-pink border-r-transparent" aria-hidden /> : <GoogleG />}
      <span>{loading ? t('auth.google.loading') : t('auth.google.continue')}</span>
    </button>
  )
}

export function OrDivider() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-wd-muted" aria-hidden>
      <span className="h-px flex-1 bg-wd-border" /><span>{t('auth.google.or')}</span><span className="h-px flex-1 bg-wd-border" />
    </div>
  )
}
