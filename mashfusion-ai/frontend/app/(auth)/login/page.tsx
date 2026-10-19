'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react'
import { signIn, authErrorText } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { WdButton, WdInput } from '@/components/wedding/admin/WeddingAdminUI'
import { PortalBrand } from '@/components/portal/PortalBrand'
import { usePortal } from '@/components/portal/PortalProvider'
import { useI18n } from '@/lib/i18n'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { config: portal } = usePortal()
  const isCouple = portal.accountType === 'couple'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) { toast.error(t('auth.fillAllFields')); return }
    setLoading(true)
    try {
      await signIn(email.trim().toLowerCase(), password)
      toast.success(t('auth.loginSuccess'))
      router.push(portal.home)
    } catch (err: unknown) {
      toast.error(authErrorText(err, t))
    } finally {
      setLoading(false)
    }
  }

  // ── MIOLOVE ALBUM (Sposi): light and elegant ──
  if (isCouple) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-wd-active p-4 text-wd-ink" data-portal="miolove">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-md">
          <div className="mb-8 pt-10 text-center md:pt-0">
            <Link href="/" className="mb-6 inline-flex"><PortalBrand size={48} /></Link>
            <h1 className="text-2xl font-bold">{t('auth.welcomeBack')}</h1>
            <p className="mt-1 text-sm text-wd-muted">{t('roles.authPage.loginSubtitleCouple')}</p>
          </div>
          <div className="space-y-5 rounded-3xl border border-wd-border bg-white p-8 shadow-xl">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-wd-muted">{t('auth.email')}</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wd-muted" />
                  <WdInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.emailPh')} className="pl-10" autoComplete="email" required />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-wd-muted">{t('auth.password')}</label>
                  <Link href="/forgot-password" className="text-xs text-wd-pink hover:text-wd-pink-hover">{t('auth.forgotPassword')}</Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wd-muted" />
                  <WdInput type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pl-10 pr-10" autoComplete="current-password" required />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-wd-muted hover:text-wd-ink" aria-label={t('auth.showPassword')}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <WdButton type="submit" disabled={loading} className="w-full !py-3" icon={loading ? undefined : <ArrowRight className="h-4 w-4" />}>
                {loading ? t('auth.signingIn') : t('auth.signIn')}
              </WdButton>
            </form>
            <div className="border-t border-wd-border" />
            <Link href="/register" className="block"><WdButton variant="secondary" className="w-full !py-3">{t('auth.createFreeAccount')}</WdButton></Link>
          </div>
        </motion.div>
      </div>
    )
  }

  // ── IOMIXO Live Hub (DJ / professionals): dark Party look ──
  return (
    <div className="min-h-screen bg-surface-400 flex items-center justify-center p-4" data-portal="iomixo">
      <div className="pointer-events-none" aria-hidden>
        <div className="bg-orb w-96 h-96 bg-purple-600 top-0 left-0" />
        <div className="bg-orb w-64 h-64 bg-pink-600 bottom-0 right-0" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6"><PortalBrand size={40} /></Link>
          <h1 className="text-2xl font-bold text-white">{t('auth.welcomeBack')}</h1>
          <p className="mt-1 text-sm text-white/40">{t('roles.authPage.loginSubtitleDj')}</p>
        </div>

        <div className="glass rounded-2xl p-8 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50">{t('auth.email')}</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.emailPh')} className="input-field pl-10" autoComplete="email" required />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-white/50">{t('auth.password')}</label>
                <Link href="/forgot-password" className="text-xs text-purple-400 hover:text-purple-300 transition-colors">{t('auth.forgotPassword')}</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="input-field pl-10 pr-10" autoComplete="current-password" required />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" loading={loading} className="w-full" icon={<ArrowRight className="h-4 w-4" />}>{t('auth.signIn')}</Button>
          </form>

          <div className="border-t border-white/6" />

          <Link href="/register"><Button variant="secondary" className="w-full">{t('auth.createFreeAccount')}</Button></Link>
        </div>
      </motion.div>
    </div>
  )
}
