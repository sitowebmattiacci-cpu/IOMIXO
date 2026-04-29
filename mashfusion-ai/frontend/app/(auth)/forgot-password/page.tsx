'use client'
import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Sparkles, Mail, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import toast from 'react-hot-toast'

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) { toast.error('Enter your email address'); return }
    setLoading(true)
    try {
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` }
      )
      if (error) throw error
      setSent(true)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Request failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-400 flex items-center justify-center p-4">
      <div className="pointer-events-none" aria-hidden>
        <div className="bg-orb w-96 h-96 bg-purple-600 top-0 right-0" />
        <div className="bg-orb w-64 h-64 bg-pink-600 bottom-0 left-0" />
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
          <h1 className="text-2xl font-bold text-white">Forgot your password?</h1>
          <p className="mt-1 text-sm text-white/40">
            {sent ? 'Check your inbox' : "No worries — we'll send you a reset link"}
          </p>
        </div>

        <div className="glass rounded-2xl p-8">
          {!sent ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="input-field pl-10"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <Button type="submit" loading={loading} className="w-full" icon={<ArrowRight className="h-4 w-4" />}>
                Send reset link
              </Button>

              <Link href="/login">
                <Button variant="ghost" className="w-full mt-1" icon={<ArrowLeft className="h-4 w-4" />}>
                  Back to sign in
                </Button>
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
              <div>
                <p className="text-white font-semibold">Reset link sent</p>
                <p className="text-sm text-white/40 mt-1.5 leading-relaxed">
                  If <span className="text-purple-400">{email}</span> is registered, you&apos;ll
                  receive a link to reset your password. Check your spam folder if you don&apos;t see it.
                </p>
              </div>
              <p className="text-xs text-white/20">Link expires in 1 hour</p>
              <Link href="/login">
                <Button variant="secondary" className="w-full" icon={<ArrowLeft className="h-4 w-4" />}>
                  Back to sign in
                </Button>
              </Link>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
