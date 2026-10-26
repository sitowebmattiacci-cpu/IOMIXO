'use client'
import { PortalBrand } from '@/components/portal/PortalBrand'
import { motion } from 'framer-motion'
import { Sparkles, Mail } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/lib/i18n'
import { HomeLink } from '@/components/portal/HomeLink'

/**
 * This page is shown after register when Firebase sends the verification email.
 * Verification is completed by /auth/action when the user clicks the link.
 */
export default function VerifyEmailPage() {
  const { t } = useI18n()
  return (
    <div className="min-h-screen bg-surface-400 flex items-center justify-center p-4">
      <div className="pointer-events-none" aria-hidden>
        <div className="bg-orb w-96 h-96 bg-purple-600 top-0 left-0" />
        <div className="bg-orb w-64 h-64 bg-cyan-600 bottom-0 right-0" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="text-center mb-8">
          <HomeLink className="inline-flex items-center gap-2"><PortalBrand onDark /></HomeLink>
        </div>

        <div className="glass rounded-2xl p-10 text-center space-y-5">
          <div className="h-16 w-16 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mx-auto">
            <Mail className="h-8 w-8 text-purple-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">{t('auth.checkInbox')}</h2>
            <p className="text-sm text-white/40 mt-2 leading-relaxed">
              {t('auth.verifyBody')}
            </p>
          </div>
          <Link href="/login">
            <Button variant="secondary" className="w-full">{t('auth.backToSignIn')}</Button>
          </Link>
          <p className="text-xs text-white/20">{t('auth.linkExpires24h')}</p>
        </div>
      </motion.div>
    </div>
  )
}

