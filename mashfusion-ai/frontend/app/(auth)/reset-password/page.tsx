'use client'
import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Sparkles, Lock, Eye, EyeOff, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import toast from 'react-hot-toast'

function ResetPasswordContent() {
  const router = useRouter()

  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [showCf,    setShowCf]    = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)

  const pwStrength = (() => {
    let score = 0
    if (password.length >= 8)          score++
    if (/[A-Z]/.test(password))        score++
    if (/[0-9]/.test(password))        score++
    if (/[^A-Za-z0-9]/.test(password)) score++
    return score
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    if (password !== confirm)  { toast.error('Passwords do not match'); return }

    setLoading(true)
    try {
      // Session was established by /auth/callback after user clicked the reset link
      const { error } = await getSupabaseClient().auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      setTimeout(() => router.push('/login'), 2500)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Reset failed. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-400 flex items-center justify-center p-4">
      <div className="pointer-events-none" aria-hidden>
        <div className="bg-orb w-96 h-96 bg-purple-600 top-0 left-0" />
        <div className="bg-orb w-64 h-64 bg-pink-600 bottom-0 right-0" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-black text-white">IOMIXO <span className="text-purple-400">AI</span></span>
          </Link>
          <h1 className="text-2xl font-bold text-white">
            {done ? 'Password updated!' : 'Set new password'}
          </h1>
          <p className="mt-1 text-sm text-white/40">
            {done ? 'Redirecting to sign in…' : 'Choose a strong password for your account'}
          </p>
        </div>

        <div className="glass rounded-2xl p-8">
          {!done ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* New password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="input-field pl-10 pr-10"
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className={`h-1 flex-1 rounded-full transition-all ${
                        n <= pwStrength
                          ? pwStrength <= 1 ? 'bg-red-500' : pwStrength === 2 ? 'bg-yellow-500' : pwStrength === 3 ? 'bg-blue-500' : 'bg-green-500'
                          : 'bg-white/10'
                      }`} />
                    ))}
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                  <input
                    type={showCf ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    className={`input-field pl-10 pr-10 ${
                      confirm && confirm !== password ? 'border-red-500/50' : ''
                    }`}
                    autoComplete="new-password"
                    required
                  />
                  <button type="button" onClick={() => setShowCf(!showCf)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors">
                    {showCf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirm && confirm !== password && (
                  <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                )}
              </div>

              <Button
                type="submit"
                loading={loading}
                disabled={!password || !confirm || password !== confirm}
                className="w-full"
                icon={<ArrowRight className="h-4 w-4" />}
              >
                Update password
              </Button>

              <Link href="/login">
                <Button variant="ghost" className="w-full mt-1">Back to sign in</Button>
              </Link>
            </form>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-5 py-2"
            >
              <div className="h-14 w-14 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-7 w-7 text-green-400" />
              </div>
              <p className="text-white/60 text-sm">Taking you back to sign in…</p>
              <div className="flex gap-1 justify-center">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface-400 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-purple-400 animate-spin" />
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}
