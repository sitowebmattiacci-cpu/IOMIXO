'use client'
import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Mail, Lock, User, Eye, EyeOff, ArrowRight, Send, Music2, Mic, Gamepad2, Camera, Smartphone, QrCode, BookHeart, Presentation, type LucideIcon } from 'lucide-react'
import { signUp, resendVerification, resendErrorI18nKey, authErrorText } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { WdButton, WdInput } from '@/components/wedding/admin/WeddingAdminUI'
import { PortalBrand } from '@/components/portal/PortalBrand'
import { GoogleButton, OrDivider } from '@/components/auth/GoogleButton'
import { usePortal } from '@/components/portal/PortalProvider'
import { useI18n } from '@/lib/i18n'
import { COUPLE_HOME } from '@/lib/roles'
import toast from 'react-hot-toast'
import { HomeLink } from '@/components/portal/HomeLink'

const GRAD = 'bg-gradient-to-r from-[#FF2D8D] via-[#FF6A3D] to-[#FFC93C] bg-clip-text text-transparent'

export default function RegisterPage() {
  const { t, locale } = useI18n()
  // The role comes from the portal (domain), never from a choice in the UI.
  const { config: portal } = usePortal()
  const accountType = portal.accountType
  const isCouple = accountType === 'couple'
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
      const { verificationSent } = await signUp(email.trim().toLowerCase(), password, fullName.trim(), accountType, locale)
      setDone(true)
      if (!verificationSent) toast.error(t('auth.verifyNotSent'))
    } catch (err: unknown) {
      toast.error(authErrorText(err, t))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    try {
      await resendVerification(email.trim().toLowerCase(), accountType, locale)
      toast.success(t('auth.newVerificationSent'))
    } catch (err) {
      toast.error(t(resendErrorI18nKey(err) ?? 'auth.resendFailed'))
    } finally {
      setResending(false)
    }
  }

  const djPerks: { icon: LucideIcon; text: string }[] = [
    { icon: Music2, text: t('roles.authPage.djPerk1') }, { icon: Mic, text: t('roles.authPage.djPerk2') }, { icon: Gamepad2, text: t('roles.authPage.djPerk3') },
    { icon: Camera, text: t('roles.authPage.djPerk4') }, { icon: Smartphone, text: t('roles.authPage.djPerk5') },
  ]
  const couplePerks: { icon: LucideIcon; text: string }[] = [
    { icon: Camera, text: t('roles.authPage.couplePerk1') }, { icon: QrCode, text: t('roles.authPage.couplePerk2') }, { icon: BookHeart, text: t('roles.authPage.couplePerk3') },
    { icon: Presentation, text: t('roles.authPage.couplePerk4') }, { icon: Smartphone, text: t('roles.authPage.couplePerk5') },
  ]

  // ── MIOLOVE ALBUM (Sposi): light, elegant, no Party / DJ element anywhere ──
  if (isCouple) {
    const field = 'pl-10'
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-wd-active p-4 text-wd-ink" data-portal="miolove">
        {done ? (
          <div className="relative w-full max-w-md rounded-3xl border border-wd-border bg-white p-10 text-center shadow-xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-wd-active text-wd-pink"><Mail className="h-8 w-8" /></div>
            <h2 className="mt-5 text-2xl font-bold">{t('auth.checkInbox')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-wd-muted">
              {t('auth.sentVerification')} <span className="font-medium text-wd-pink">{email}</span>{t('auth.clickActivate')}
            </p>
            <div className="mt-6 space-y-3">
              <Link href={COUPLE_HOME} className="block">
                <WdButton className="w-full !py-3" data-testid="register-continue" icon={<ArrowRight className="h-4 w-4" />}>{t('roles.createFirstAlbum')}</WdButton>
              </Link>
              <WdButton variant="secondary" className="w-full !py-3" onClick={handleResend} disabled={resending} icon={<Send className="h-4 w-4" />}>{t('auth.resendVerification')}</WdButton>
              <Link href="/login" className="block"><WdButton variant="ghost" className="w-full !py-3">{t('auth.backToSignIn')}</WdButton></Link>
            </div>
          </div>
        ) : (
          <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-2">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="hidden md:block">
              <PortalBrand size={48} />
              <h1 className="mt-8 font-album text-5xl font-semibold leading-[1.08] text-wd-ink">{t('roles.authPage.coupleHeadline')}</h1>
              <p className="mt-4 max-w-md leading-relaxed text-wd-muted">{t('roles.authPage.coupleSub')}</p>
              <ul className="mt-8 space-y-3">
                {couplePerks.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-3 text-[15px]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wd-active text-wd-pink"><Icon className="h-4 w-4" /></span>
                    {text}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <div className="mb-6 pt-10 text-center md:hidden">
                <HomeLink className="inline-flex"><PortalBrand size={40} /></HomeLink>
                <p className="mx-auto mt-3 max-w-xs font-album text-2xl font-semibold leading-tight">{t('roles.authPage.coupleHeadline')}</p>
                <ul className="mx-auto mt-3 flex max-w-xs flex-col gap-1.5 text-left">
                  {couplePerks.slice(0, 3).map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-center gap-2.5 text-[13px] text-wd-muted"><Icon className="h-4 w-4 shrink-0 text-wd-pink" />{text}</li>
                  ))}
                </ul>
              </div>

              <div className="space-y-5 rounded-3xl border border-wd-border bg-white p-8 shadow-xl">
                <div>
                  <h2 className="text-xl font-bold">{t('auth.createAccount')}</h2>
                  <p className="mt-1 text-sm text-wd-muted">{t('albumAuth.registerSub')}</p>
                </div>
                <GoogleButton />
                <OrDivider />
                <form onSubmit={handleSubmit} className="space-y-4" data-gramm="false">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-wd-muted">{t('auth.fullName')}</label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wd-muted" />
                      <WdInput type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('albumAuth.namePh')} className={field} autoComplete="name" required spellCheck={false} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-wd-muted">{t('auth.email')}</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wd-muted" />
                      <WdInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.emailPh')} className={field} autoComplete="email" required spellCheck={false} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-wd-muted">{t('auth.password')}</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wd-muted" />
                      <WdInput type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.passwordPhMin8')} className={`${field} pr-10`} autoComplete="new-password" required minLength={8} />
                      <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-wd-muted hover:text-wd-ink" aria-label={t('auth.showPassword')}>
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {password.length > 0 && (
                      <div className="mt-1.5 flex gap-1">
                        {[1, 2, 3, 4].map((n) => (
                          <div key={n} className={`h-1 flex-1 rounded-full ${n <= pwStrength ? (pwStrength <= 1 ? 'bg-red-400' : pwStrength === 2 ? 'bg-yellow-400' : pwStrength === 3 ? 'bg-blue-400' : 'bg-green-500') : 'bg-wd-border'}`} />
                        ))}
                      </div>
                    )}
                  </div>
                  <WdButton type="submit" disabled={loading} className="w-full !py-3" icon={loading ? undefined : <ArrowRight className="h-4 w-4" />}>
                    {loading ? t('auth.creating') : t('auth.createAccountBtn')}
                  </WdButton>
                </form>
                <div className="border-t border-wd-border" />
                <Link href="/login" className="block"><WdButton variant="secondary" className="w-full !py-3">{t('auth.signIn')}</WdButton></Link>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    )
  }

  // ── IOMIXO Live Hub (DJ / professionals): dark Party look ──
  const djHero = (
    <div className="relative">
      <div className="pointer-events-none absolute -left-16 -top-10 h-56 w-56 rounded-full bg-[#FF2D8D]/15 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-10 right-0 h-40 w-40 rounded-full bg-[#FFC93C]/10 blur-3xl" aria-hidden />
      <div className="relative">
        <PortalBrand size={52} textClass="text-2xl" />
        <h1 className="mt-8 text-5xl font-black leading-[1.05] text-white">
          {t('roles.authPage.djHeadlineA')} <span className={GRAD}>{t('roles.authPage.djHeadlineB')}</span>
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
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-surface-400 flex items-center justify-center p-4" data-portal="iomixo">
      <div className="pointer-events-none" aria-hidden>
        <div className="bg-orb w-96 h-96 bg-purple-600 top-[-100px] right-0" />
        <div className="bg-orb w-64 h-64 bg-cyan-600 bottom-0 left-0" />
      </div>

      {done ? (
        <div key="success" className="relative w-full max-w-md">
          <div className="glass rounded-2xl p-10 text-center space-y-5">
            <div className="h-16 w-16 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mx-auto">
              <Mail className="h-8 w-8 text-purple-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white">{t('auth.checkInbox')}</h2>
              <p className="text-sm text-white/40 mt-2 leading-relaxed">
                {t('auth.sentVerification')}{' '}
                <span className="text-purple-400 font-medium">{email}</span>
                {t('auth.clickActivate')}
              </p>
            </div>
            <div className="pt-2 space-y-3">
              <Button variant="secondary" className="w-full" loading={resending} onClick={handleResend} icon={<Send className="h-4 w-4" />}>
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
        <div key="form" className="relative w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="hidden md:block">{djHero}</motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="mb-6 pt-10 text-center md:hidden">
              <HomeLink className="inline-flex items-center justify-center"><PortalBrand size={36} textClass="text-lg" /></HomeLink>
              <p className="mx-auto mt-3 max-w-xs text-xl font-black leading-tight text-white">{t('roles.authPage.djHeadlineA')} <span className={GRAD}>{t('roles.authPage.djHeadlineB')}</span></p>
              <ul className="mx-auto mt-3 flex max-w-xs flex-col gap-1.5 text-left">
                {djPerks.slice(0, 3).map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2.5 text-[13px] text-white/70"><Icon className="h-4 w-4 shrink-0 text-[#FF2D8D]" />{text}</li>
                ))}
              </ul>
            </div>

            <div className="glass rounded-2xl p-8 space-y-5">
              <div>
                <h2 className="text-xl font-bold text-white">{t('auth.createAccount')}</h2>
                <p className="text-sm text-white/40 mt-1">{t('auth.freeForever')}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" data-gramm="false">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/50">{t('auth.fullName')}</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                    <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                      placeholder={t('auth.fullNamePh')} className="input-field pl-10" autoComplete="name" required spellCheck={false} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/50">{t('auth.email')}</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('auth.emailPh')} className="input-field pl-10" autoComplete="email" required spellCheck={false} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/50">{t('auth.password')}</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                    <input
                      type={showPw ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('auth.passwordPhMin8')} className="input-field pl-10 pr-10"
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
                  {t('auth.createAccountBtn')}
                </Button>
              </form>

              <div className="border-t border-white/6" />

              <Link href="/login">
                <Button variant="secondary" className="w-full">{t('auth.signIn')}</Button>
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
