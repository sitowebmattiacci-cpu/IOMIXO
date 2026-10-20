'use client'
import Link from 'next/link'
import { Printer, Lock } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { WdPage, WdCard, WdButton } from './WeddingAdminUI'

/** MIOLOVE trial: the printable QR card / poster belongs to the full album. The trial still has the QR code and the link (Home). */
export function PosterLocked() {
  const { t } = useI18n()
  return (
    <WdPage width="narrow" title={t('wdAdmin.posterEditor.title')}>
      <div data-testid="poster-locked">
        <WdCard title={t('albumPlan.posterLockedTitle')} description={t('albumPlan.posterLockedDesc')}>
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-wd-active text-wd-pink"><Printer className="h-6 w-6" /></span>
            <Link href="/billing"><WdButton icon={<Lock className="h-4 w-4" />}>{t('albumPlan.activate')}</WdButton></Link>
          </div>
        </WdCard>
      </div>
    </WdPage>
  )
}
