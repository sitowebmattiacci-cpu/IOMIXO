'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { confirmEmailVerification, mapAuthError } from '@/lib/firebase/auth'

/**
 * Firebase email action handler (set as the custom action URL in the Firebase
 * console: Authentication → Templates). Routes resetPassword and verifyEmail links.
 */
function ActionContent() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const mode = params.get('mode')
    const oobCode = params.get('oobCode')
    if (!oobCode) { setError('This link is invalid or has expired'); return }
    if (mode === 'resetPassword') { router.replace(`/reset-password?oobCode=${encodeURIComponent(oobCode)}`); return }
    if (mode === 'verifyEmail') {
      confirmEmailVerification(oobCode)
        .then(() => router.replace('/login?verified=1'))
        .catch((e) => setError(mapAuthError(e)))
      return
    }
    setError('Unsupported action')
  }, [params, router])

  return (
    <div className="min-h-screen bg-surface-400 flex items-center justify-center p-4 text-center">
      {error ? <p className="text-white/60 text-sm">{error}</p> : <Loader2 className="h-8 w-8 text-purple-400 animate-spin" />}
    </div>
  )
}

export default function AuthActionPage() {
  return <Suspense><ActionContent /></Suspense>
}
