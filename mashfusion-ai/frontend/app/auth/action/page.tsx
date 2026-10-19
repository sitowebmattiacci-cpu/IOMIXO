'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { confirmEmailVerification } from '@/lib/firebase/auth'
import { authErrorText } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { actionHopOrigin } from '@/lib/portal'

/**
 * Firebase email action handler (set as the custom action URL in the Firebase
 * console: Authentication → Templates). Routes resetPassword and verifyEmail links.
 */
function ActionContent() {
  const router = useRouter()
  const { t } = useI18n()
  const params = useSearchParams()
  const [error, setError] = useState<string | { code: string } | null>(null)

  useEffect(() => {
    const mode = params.get('mode')
    const oobCode = params.get('oobCode')
    // The Firebase console has ONE action URL per project: a link requested from the other portal lands here first and is handed over to its own domain
    // (only to a known portal origin taken from continueUrl, never an arbitrary URL).
    const hop = actionHopOrigin(params.get('continueUrl'), window.location.hostname)
    if (hop) { window.location.replace(`${hop}/auth/action?${params.toString()}`); return }
    if (!oobCode) { setError({ code: 'auth/invalid-action-code' }); return }
    if (mode === 'resetPassword') { router.replace(`/reset-password?oobCode=${encodeURIComponent(oobCode)}`); return }
    if (mode === 'verifyEmail') {
      confirmEmailVerification(oobCode)
        .then(() => router.replace('/login?verified=1'))
        .catch((e) => setError(e ?? {}))
      return
    }
    setError('unsupported')
  }, [params, router])

  return (
    <div className="min-h-screen bg-surface-400 flex items-center justify-center p-4 text-center">
      {error ? <p className="text-white/60 text-sm">{error === 'unsupported' ? t('auth.unsupportedAction') : authErrorText(error, t)}</p> : <Loader2 className="h-8 w-8 text-purple-400 animate-spin" />}
    </div>
  )
}

export default function AuthActionPage() {
  return <Suspense><ActionContent /></Suspense>
}
