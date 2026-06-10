'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Mail, Lock, User, Eye, EyeOff, ArrowRight, CheckCircle2, Send } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/Logo'
import { useI18n } from '@/lib/i18n'
import toast from 'react-hot-toast'

export default function RegisterPage() {
  const router = useRouter()
  const { t } = useI18n()
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
    if (!fullName || !email || !password) { toast.error(t('auth.fillAllFields')); return }
    if (password.length < 8) { toast.error(t('auth.passwordMin8')); return }
    setLoading(true)
    try {
      const { data, error } = await getSupabaseClient().auth.signUp({
        email:    email.trim().toLowerCase(),
        password,
        options:  {
          data:        { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
      // When "Confirm email" is OFF in Supabase, signUp returns an active
      // session: log the user straight into the dashboard. Only fall back to
      // the check-your-email screen when no session is returned (Confirm email ON).
      if (data.session) {
        toast.success(t('auth.loginSuccess'))
        router.push('/dashboard')
        return
      }
      setDone(true)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('auth.registrationFailed'))
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
      toast.success(t('auth.newVerificationSent'))
    } catch {
      toast.error(t('auth.resendFailed'))
    } finally {
      setResending(false)
    }
  }

  const perks = [
    t('auth.perk1'),
    t('auth.perk2'),
    t('auth.perk3'),
    t('auth.perk4'),
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
              <h2 className="text-2xl font-black text-white">{t('auth.checkInbox')}</h2>
              <p className="text-sm text-white/40 mt-2 leading-relaxed">
                {t('auth.sentVerification')}{' '}
                <span className="text-purple-400 font-medium">{email}</span>{t('auth.clickActivate')}
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
                {t('auth.resendVerification')}
              </Button>
              <Link href="/login">
                <Button variant="ghost" className="w-full">{t('auth.backToSignIn')}</Button>
              </Link>
            </div>
            <p className="text-xs text-white/20">{t('auth.linkExpires24h')}</p>
          </div>
        </div>
      ) : (
        /* ── Registration form ── */
        <div key="form" className="relative w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center">
          {/* Left – value prop */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="hidden md:block">
            <div className="flex items-center gap-2 mb-8">
              <Logo size={40} />
              <span className="text-xl font-black text-white">IOMIXO <span className="text-purple-400">Live Hub</span></span>
            </div>
            <h1 className="text-4xl font-black text-white leading-tight mb-4">
              {t('auth.heroTitle1')} <span className="text-gradient">{t('auth.heroTitle2')}</span>
            </h1>
            <p className="text-white/40 mb-8 leading-relaxed">
              {t('auth.heroSubtitle')}
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
                <Logo size={36} />
                <span className="font-black text-white">IOMIXO</span>
              </Link>
            </div>

            <div className="glass rounded-2xl p-8 space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">{t('auth.createAccount')}</h2>
                <p className="text-sm text-white/40 mt-1">{t('auth.freeForever')}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6" data-gramm="false">
                {/* Full name */}
                <div className="space-y-2.5">
                  <label className="text-sm font-medium text-white/60 ml-1">{t('auth.fullName')}</label>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/20 group-focus-within:text-purple-400 transition-colors pointer-events-none z-10" />
                    <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                      placeholder={t('auth.fullNamePh')} className="input-field h-12" style={{ paddingLeft: '3rem', paddingRight: '1rem' }} autoComplete="name" required spellCheck={false} />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-2.5">
                  <label className="text-sm font-medium text-white/60 ml-1">{t('auth.email')}</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/20 group-focus-within:text-purple-400 transition-colors pointer-events-none z-10" />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('auth.emailPh')} className="input-field h-12" style={{ paddingLeft: '3rem', paddingRight: '1rem' }} autoComplete="email" required spellCheck={false} />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-2.5">
                  <label className="text-sm font-medium text-white/60 ml-1">{t('auth.password')}</label>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/20 group-focus-within:text-purple-400 transition-colors pointer-events-none z-10" />
                    <input
                      type={showPw ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('auth.passwordPhMin8')} className="input-field h-12"
                      style={{ paddingLeft: '3rem', paddingRight: '3rem' }}
                      autoComplete="new-password" required minLength={8}
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors">
                      {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {password.length > 0 && (
                    <div className="flex gap-1.5 px-1 pt-1">
                      {[1, 2, 3, 4].map((n) => (
                        <div key={n} className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                          n <= pwStrength
                            ? pwStrength <= 1 ? 'bg-red-500/80' : pwStrength === 2 ? 'bg-yellow-500/80' : pwStrength === 3 ? 'bg-blue-500/80' : 'bg-green-500/80'
                            : 'bg-white/5'
                        }`} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <Button type="submit" loading={loading} className="w-full h-12 text-base shadow-lg shadow-purple-500/20" icon={<ArrowRight className="h-5 w-5" />}>
                    {t('auth.createAccountBtn')}
                  </Button>
                </div>
              </form>

              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-white/[0.06]" />
                <span className="text-xs font-medium text-white/20 whitespace-nowrap">{t('auth.alreadyHaveAccount')}</span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>

              <Link href="/login" className="block">
                <Button variant="secondary" className="w-full h-12 text-base">{t('auth.signIn')}</Button>
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
