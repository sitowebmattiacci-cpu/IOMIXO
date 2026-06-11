'use client'
import Link from 'next/link'
import { Lock, Sparkles, PartyPopper, Heart, ArrowLeft } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/lib/i18n'

/**
 * Schermata di blocco mostrata quando si tenta di aprire una sessione premium
 * (Party Mode / Wedding Edition) senza accesso valido — tipicamente dopo la
 * scadenza dell'Event Pass 24H mentre l'utente è tornato Free.
 *
 * La sessione NON viene eliminata: resta salvata e visibile, ma non apribile
 * finché non si riattiva l'Event Pass 24H o si passa ad Advance.
 */
export function SessionLockScreen({
  sessionType,
  eventName,
}: {
  sessionType?: 'party' | 'wedding' | string | null
  eventName?: string | null
}) {
  const { t } = useI18n()
  const isWedding = sessionType === 'wedding'

  return (
    <div className="flex-1 flex items-center justify-center px-6 py-12">
      <Card className="max-w-lg w-full text-center py-10 px-8">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-purple-200 mb-5">
          <Lock className="h-7 w-7" />
        </div>

        <div className="flex items-center justify-center gap-2 mb-3 text-xs text-white/50">
          {isWedding ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-pink-500/15 text-pink-200 px-2.5 py-0.5">
              <Heart className="h-3 w-3" /> {t('sessions.typeWedding')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 text-purple-200 px-2.5 py-0.5">
              <PartyPopper className="h-3 w-3" /> {t('sessions.typeParty')}
            </span>
          )}
          {eventName && <span className="truncate max-w-[200px]">· {eventName}</span>}
        </div>

        <h1 className="text-xl font-black text-white mb-3 flex items-center justify-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-300" /> {t('sessions.locked.title')}
        </h1>
        <p className="text-sm text-white/60 max-w-md mx-auto mb-6 leading-relaxed">
          {t('sessions.locked.text')}
        </p>

        <div className="flex flex-col gap-2 max-w-xs mx-auto">
          <Link href="/billing">
            <Button className="w-full">{t('sessions.locked.reactivateEventPass')}</Button>
          </Link>
          <Link href="/billing">
            <Button variant="secondary" className="w-full">{t('sessions.locked.switchToAdvance')}</Button>
          </Link>
          <Link href="/sessions">
            <Button variant="ghost" className="w-full" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
              {t('sessions.locked.backToSessions')}
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}
