'use client'
import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Sparkles, Mail, Lock, User, Eye, EyeOff, ArrowRight, CheckCircle2, Send } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import toast from 'react-hot-toast'

export default function RegisterPage() {
  const [fullName, setFullName] = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(false)
  const [resending, setResending] = useState(false)

  const pwStrength = (() => {
    let score = 0
    if (password.length >= 8)           score++
    if (/[A-Z]/.test(password))         score++
    if (/[0-9]/.test(password))         score++
    if (/[^A-Za-z0-9]/.test(password))  score++
    return score
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName || !email || !password) { toast.error('Please fill in all fields'); return }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const { error } = await getSupabaseClient().auth.signUp({
        email:    email.trim().toLowerCase(),
        password,
        options:  {
          data:        { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
      setDone(true)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    try {
      const { error } = await getSupabaseClient().auth.resend({
        type:  'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
      toast.success('New verification email sent!')
    } catch {
      toast.error('Failed to resend. Try again in a moment.')
    } finally {
      setResending(false)
    }
  }

  const perks = [
    'AI stem separation (Demucs + MDX-Net)',
    'BPM & key auto-detection',
    'Professional mashup composer',
    '1 free mashup included',
  ]

  return (
    <div className="min-h-screen bg-surface-400 flex items-center justify-center p-4">
      <div className="pointer-events-none" aria-hidden>
        <div className="bg-orb w-96 h-96 bg-purple-600 top-[-100px] right-0" />
        <div className="bg-orb w-64 h-64 bg-cyan-600 bottom-0 left-0" />
      </div>

      {done ? (
        /* ── Success / check-email screen ── */
        <div key="success" className="relative w-full max-w-md">
          <div className="glass rounded-2xl p-10 text-center space-y-5">
            <div className="h-16 w-16 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mx-auto">
              <Mail className="h-8 w-8 text-purple-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white">Check your inbox</h2>
              <p className="text-sm text-white/40 mt-2 leading-relaxed">
                We&apos;ve sent a verification link to{' '}
                <span className="text-purple-400 font-medium">{email}</span>.
                Click it to activate your account.
              </p>
            </div>
            <div className="pt-2 space-y-3">
              <Button
                variant="secondary"
                className="w-full"
                loading={resending}
                onClick={handleResend}
                icon={<Send className="h-4 w-4" />}
              >
                Resend verification email
              </Button>
              <Link href="/login">
                <Button variant="ghost" className="w-full">Back to sign in</Button>
              </Link>
            </div>
            <p className="text-xs text-white/20">Link expires in 24 hours</p>
          </div>
        </div>
      ) : (
        /* ── Registration form ── */
        <div key="form" className="relative w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center">
          {/* Left – value prop */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="hidden md:block">
            <div className="flex items-center gap-2 mb-8">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-black text-white">IOMIXO <span className="text-purple-400">AI</span></span>
            </div>
            <h1 className="text-4xl font-black text-white leading-tight mb-4">
              Create <span className="text-gradient">professional</span> mashups with AI
            </h1>
            <p className="text-white/40 mb-8 leading-relaxed">
              Join thousands of DJs and producers who are already using IOMIXO to create
              studio-quality mashups in minutes.
            </p>
            <ul className="space-y-3">
              {perks.map((p) => (
                <li key={p} className="flex items-center gap-3 text-sm text-white/60">
                  <CheckCircle2 className="h-4 w-4 text-purple-400 flex-shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Right – form */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="text-center mb-6 md:hidden">
              <Link href="/" className="inline-flex items-center gap-2">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <span className="font-black text-white">IOMIXO</span>
              </Link>
            </div>

            <div className="glass rounded-2xl p-8 space-y-5">
              <div>
                <h2 className="text-xl font-bold text-white">Create your account</h2>
                <p className="text-sm text-white/40 mt-1">Free forever — no credit card needed</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" data-gramm="false">
                {/* Full name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/50">Full name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                    <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                      placeholder="DJ Example" className="input-field pl-10" autoComplete="name" required spellCheck={false} />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/50">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com" className="input-field pl-10" autoComplete="email" required spellCheck={false} />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/50">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                    <input
                      type={showPw ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 8 characters" className="input-field pl-10 pr-10"
                      autoComplete="new-password" required minLength={8}
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

                <Button type="submit" loading={loading} className="w-full" icon={<ArrowRight className="h-4 w-4" />}>
                  Create account
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/6" />
                </div>
                <div className="relative flex justify-center text-xs text-white/25">
                  <span className="px-2 bg-transparent">Already have an account?</span>
                </div>
              </div>

              <Link href="/login">
                <Button variant="secondary" className="w-full">Sign in</Button>
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
