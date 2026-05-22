'use client'
import Link from 'next/link'
import { Sparkles, Lock } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function UpgradeGate({
  title  = 'Funzione Pro',
  message = 'Passa al piano Pro per sbloccare questa funzionalità.',
  compact = false,
}: { title?: string; message?: string; compact?: boolean }) {
  return (
    <Card className={`text-center ${compact ? 'py-6' : 'py-12'}`}>
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-fuchsia-500/20 text-purple-300 mb-4">
        <Lock className="h-6 w-6" />
      </div>
      <h2 className="font-black text-white text-lg mb-2 flex items-center justify-center gap-2">
        <Sparkles className="h-4 w-4 text-purple-300" /> {title}
      </h2>
      <p className="text-sm text-white/60 max-w-md mx-auto mb-5">{message}</p>
      <Link href="/billing">
        <Button>Passa a Pro</Button>
      </Link>
    </Card>
  )
}
