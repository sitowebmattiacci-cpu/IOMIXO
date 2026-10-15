'use client'
import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Mail, Lock, User, Eye, EyeOff, ArrowRight, Send, Disc3, Heart, Music2, Mic, Gamepad2, Camera, Smartphone, QrCode, BookHeart, Presentation, type LucideIcon } from 'lucide-react'
import { signUp, resendVerification, authErrorMessage } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/Logo'
import { MioloveLogo } from '@/components/brand/MioloveLogo'
import { useI18n } from '@/lib/i18n'
import { COUPLE_HOME, type AccountType } from '@/lib/roles'
import toast from 'react-hot-toast'

export default function RegisterPage() {
  const { t } = useI18n()
  const [accountType, setAccountType] = useState<AccountType | null>(null)
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
    if (!accountType) { toast.error(t('roles.required')); return }
    if (!fullName || !email || !password) { toast.error('Please fill in all fields'); return }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await signUp(email.trim().toLowerCase(), password, fullName.trim(), accountType)
      setDone(true)
    } catch (err: unknown) {
      toast.error(authErrorMessage(err, 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    try {
      await resendVerification(email.trim().toLowerCase())
      toast.success('New verification email sent!')
    } catch {
      toast.error('Failed to resend. Try again in a moment.')
    } finally {
      setResending(false)
    }
  }

  const isCouple = accountType === 'couple'
  const isDj = accountType === 'dj'
  const subline = isCouple ? t('roles.authPage.coupleSub') : isDj ? t('roles.authPage.djSub') : t('roles.authPage.neutralSub')
  const djPerks: { icon: LucideIcon; text: string }[] = [
    { icon: Music2, text: t('roles.authPage.djPerk1') }, { icon: Mic, text: t('roles.authPage.djPerk2') }, { icon: Gamepad2, text: t('roles.authPage.djPerk3') },
    { icon: Camera, text: t('roles.authPage.djPerk4') }, { icon: Smartphone, text: t('roles.authPage.djPerk5') },
  ]
  const couplePerks: { icon: LucideIcon; text: string }[] = [
    { icon: Camera, text: t('roles.authPage.couplePerk1') }, { icon: QrCode, text: t('roles.authPage.couplePerk2') }, { icon: BookHeart, text: t('roles.authPage.couplePerk3') },
    { icon: Presentation, text: t('roles.authPage.couplePerk4') }, { icon: Smartphone, text: t('roles.authPage.couplePerk5') },
  ]
  const djMark = (size: number, text: string) => (
    <span className="inline-flex items-center gap-3">
      <Logo variant="party" size={size} />
      <span className={`${text} font-black tracking-tight text-white`}>IOMIXO <span className="text-[#FF2D8D]">Live Hub</span></span>
    </span>
  )
  const grad = 'bg-gradient-to-r from-[#FF2D8D] via-[#FF6A3D] to-[#FFC93C] bg-clip-text text-transparent'

  // Desktop hero (left column)
  const desktopHero = isCouple ? (
    <div className="rounded-3xl border border-wd-border bg-gradient-to-b from-white to-wd-active p-8 shadow-xl">
      <MioloveLogo height={44} variant="onLight" />
      <h1 className="mt-7 font-wedding text-4xl font-semibold leading-[1.1] text-wd-ink">{t('roles.authPage.coupleHeadline')}</h1>
      <p className="mt-4 leading-relaxed text-wd-muted">{t('roles.authPage.coupleSub')}</p>
      <ul className="mt-7 space-y-3">
        {couplePerks.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-[15px] text-wd-ink">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wd-active text-wd-pink"><Icon className="h-4 w-4" /></span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <div className="relative">
      <div className="pointer-events-none absolute -left-16 -top-10 h-56 w-56 rounded-full bg-[#FF2D8D]/15 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-10 right-0 h-40 w-40 rounded-full bg-[#FFC93C]/10 blur-3xl" aria-hidden />
      <div className="relative">
        {djMark(52, 'text-2xl')}
        {isDj ? (
          <>
            <h1 className="mt-8 text-5xl font-black leading-[1.05] text-white">
              {t('roles.authPage.djHeadlineA')} <span className={grad}>{t('roles.authPage.djHeadlineB')}</span>
            </h1>
            <p className="mt-5 max-w-md leading-relaxed text-white/60">{t('roles.authPage.djSub')}</p>
            <ul className="mt-8 space-y-2.5">
              {djPerks.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white/80">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FF2D8D]/15 text-[#FF2D8D]"><Icon className="h-4 w-4" /></span>
                  {text}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-6 max-w-sm leading-relaxed text-white/50">{subline}</p>
        )}
      </div>
    </div>
  )

  // Mobile hero: logo + short headline + 3 benefits, the form stays the priority
  const mobilePerks = (isCouple ? couplePerks : djPerks).slice(0, 3)
  const mobileHero = (
    <div className="mb-6 pt-10 text-center md:hidden">
      <Link href="/" className="inline-flex items-center justify-center">
        {isCouple ? <span className="inline-flex rounded-xl bg-white px-3 py-1.5"><MioloveLogo height={30} variant="onLight" /></span> : djMark(36, 'text-lg')}
      </Link>
      {isCouple && <p className="mx-auto mt-3 max-w-xs font-wedding text-2xl font-semibold leading-tight text-white">{t('roles.authPage.coupleHeadline')}</p>}
      {isDj && <p className="mx-auto mt-3 max-w-xs text-xl font-black leading-tight text-white">{t('roles.authPage.djHeadlineA')} <span className={grad}>{t('roles.authPage.djHeadlineB')}</span></p>}
      {!isCouple && !isDj && <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-white/50">{subline}</p>}
      {(isCouple || isDj) && (
        <ul className="mx-auto mt-3 flex max-w-xs flex-col gap-1.5 text-left">
          {mobilePerks.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-[13px] text-white/70">
              <Icon className={`h-4 w-4 shrink-0 ${isCouple ? 'text-wd-pink' : 'text-[#FF2D8D]'}`} />
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

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
              {accountType === 'couple' && (
                <Link href={COUPLE_HOME}>
                  <Button className="w-full" data-testid="register-continue" icon={<ArrowRight className="h-4 w-4" />}>{t('roles.createFirstAlbum')}</Button>
                </Link>
              )}
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
            {desktopHero}
          </motion.div>

          {/* Right – form */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            {mobileHero}

            <div className="glass rounded-2xl p-8 space-y-5">
              <div>
                <h2 className="text-xl font-bold text-white">Create your account</h2>
                <p className="text-sm text-white/40 mt-1">Free forever — no credit card needed</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" data-gramm="false">
                {/* Account type */}
                <fieldset className="space-y-2" data-testid="account-type-choice">
                  <legend className="text-sm font-semibold text-white mb-2">{t('roles.question')}</legend>
                  <div role="radiogroup" aria-label={t('roles.question')} className="grid gap-2.5">
                    {([
                      { value: 'dj' as const, icon: Disc3, title: t('roles.djTitle'), desc: t('roles.djDesc') },
                      { value: 'couple' as const, icon: Heart, title: t('roles.coupleTitle'), desc: t('roles.coupleDesc') },
                    ]).map(({ value, icon: Icon, title, desc }) => {
                      const selected = accountType === value
                      return (
                        <button
                          key={value} type="button" role="radio" aria-checked={selected}
                          data-testid={`account-type-${value}`}
                          onClick={() => setAccountType(value)}
                          className={`flex w-full min-h-[64px] items-start gap-3 rounded-xl border p-3.5 text-left transition ${selected ? (value === 'couple' ? 'border-wd-pink bg-wd-pink/15' : 'border-purple-400 bg-purple-500/15') : 'border-white/10 bg-white/5 hover:border-white/25'}`}
                        >
                          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${selected ? 'text-purple-300' : 'text-white/40'}`} />
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-white">{title}</span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-white/50">{desc}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

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

              <div className="border-t border-white/6" />

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
