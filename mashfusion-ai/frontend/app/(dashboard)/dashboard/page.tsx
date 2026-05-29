'use client'
import { Suspense } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Plus, Radio, ArrowRight, UserCircle, CalendarDays, Crown } from 'lucide-react'
import { auth, live } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatRelativeTime } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { planLabel, isFreePlan } from '@/lib/plan'
import type { User } from '@/types'

function PlanLabel({ plan }: { plan: string }) {
  return <span className="capitalize">{planLabel(plan)}</span>
}

function DashboardInner() {
  const { t } = useI18n()
  const { data: me }       = useSWR<User>('me', () => auth.me())
  const { data: sessions } = useSWR('live-sessions', () => live.listSessions())

  const isFree = isFreePlan(me?.plan)
  const activeCount = sessions?.filter((s) => s.is_active).length ?? 0

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">
            {t('dashboard.hello')}{me?.full_name ? `, ${me.full_name.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="text-sm text-white/40 mt-1">{t('dashboard.subtitle')}</p>
        </div>
        <Link href="/sessions">
          <Button icon={<Plus className="h-4 w-4" />}>{t('dashboard.createSession')}</Button>
        </Link>
      </div>

      {/* Plan strip */}
      <Card className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500/15 text-purple-300 flex items-center justify-center">
            <Crown className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-white/40">{t('dashboard.currentPlan')}</p>
            <p className="font-semibold text-white"><PlanLabel plan={me?.plan ?? 'free'} /></p>
          </div>
        </div>
        {isFree ? (
          <Link href="/billing">
            <Button size="sm">{t('dashboard.upgradeToPro')}</Button>
          </Link>
        ) : (
          <Link href="/billing">
            <Button size="sm" variant="secondary">{t('dashboard.manageSubscription')}</Button>
          </Link>
        )}
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        <Card className="p-4">
          <p className="text-xs text-white/40">{t('dashboard.totalSessions')}</p>
          <p className="text-2xl font-black text-white mt-1">{sessions?.length ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-white/40">{t('dashboard.activeSessions')}</p>
          <p className="text-2xl font-black text-white mt-1">{activeCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-white/40">{t('dashboard.freeLimit')}</p>
          <p className="text-2xl font-black text-white mt-1">
            {isFree ? t('dashboard.freeLimitValue') : t('dashboard.unlimited')}
          </p>
        </Card>
      </div>

      {/* Sessions list */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Radio className="h-4 w-4 text-purple-400" /> {t('dashboard.yourSessions')}
        </h2>
        <Link href="/sessions" className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1">
          {t('dashboard.viewAll')} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {!sessions || sessions.length === 0 ? (
        <Card className="text-center py-12">
          <Radio className="h-10 w-10 text-white/20 mx-auto mb-4" />
          <p className="text-white/60 mb-4">{t('dashboard.noSessions')}</p>
          <Link href="/sessions">
            <Button icon={<Plus className="h-4 w-4" />}>{t('dashboard.createFirst')}</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {sessions.slice(0, 5).map((s) => (
            <Link key={s.id} href={`/sessions/${s.id}`}>
              <Card className="px-5 py-4 flex items-center justify-between hover:bg-white/5 transition">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{s.event_name}</p>
                  <p className="text-xs text-white/40">
                    {formatRelativeTime(s.created_at)} · /live/{s.public_slug}
                  </p>
                </div>
                <Badge variant={s.is_active ? 'processing' : 'complete'}>
                  {s.is_active ? t('dashboard.active') : t('dashboard.closed')}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Quick links */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link href="/profile">
          <Card className="flex items-center gap-3 hover:bg-white/5 transition">
            <UserCircle className="h-5 w-5 text-purple-300" />
            <div>
              <p className="font-semibold text-white text-sm">{t('dashboard.profileDjTitle')}</p>
              <p className="text-xs text-white/40">{t('dashboard.profileDjDesc')}</p>
            </div>
          </Card>
        </Link>
        <Link href="/events">
          <Card className="flex items-center gap-3 hover:bg-white/5 transition">
            <CalendarDays className="h-5 w-5 text-purple-300" />
            <div>
              <p className="font-semibold text-white text-sm">{t('dashboard.upcomingDatesTitle')}</p>
              <p className="text-xs text-white/40">{t('dashboard.upcomingDatesDesc')}</p>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  )
}
