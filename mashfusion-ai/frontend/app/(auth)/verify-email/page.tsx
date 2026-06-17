'use client'
import { motion } from 'framer-motion'
import { Sparkles, Mail } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

/**
 * This page is shown after register when Supabase sends the confirmation email.
 * Actual verification happens automatically via /auth/callback when the user clicks the link.
 */
export default function VerifyEmailPage() {
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
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-black text-white">IOMIXO <span className="text-purple-400">AI</span></span>
          </Link>
        </div>

        <div className="glass rounded-2xl p-10 text-center space-y-5">
          <div className="h-16 w-16 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mx-auto">
            <Mail className="h-8 w-8 text-purple-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">Check your inbox</h2>
            <p className="text-sm text-white/40 mt-2 leading-relaxed">
              We&apos;ve sent you a confirmation link. Click it to activate your account and access your studio.
            </p>
          </div>
          <Link href="/login">
            <Button variant="secondary" className="w-full">Back to sign in</Button>
          </Link>
          <p className="text-xs text-white/20">Link expires in 24 hours</p>
        </div>
      </motion.div>
    </div>
  )
}

