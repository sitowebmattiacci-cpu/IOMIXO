'use client'
import { Suspense } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { format } from 'date-fns'
import { Plus, Radio, ArrowRight, UserCircle, CalendarDays, Crown, Lock, Heart, PartyPopper } from 'lucide-react'
import { live } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useI18n, type Locale } from '@/lib/i18n'
import { useEffectiveAccess, isPremiumSession } from '@/lib/access'

/** Tempo rimanente leggibile (es. "2h 30m") dato un timestamp ISO futuro. */
function formatRemaining(validUntil: string | null): string | null {
  if (!validUntil) return null
  const ms = new Date(validUntil).getTime() - Date.now()
  if (ms <= 0) return null
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** BCP-47 tag per Intl a partire dal locale interno dell'app. */
const INTL_TAG: Record<Locale, string> = { it: 'it-IT', en: 'en-US', es: 'es-ES', fr: 'fr-FR' }

/**
 * Data evento localizzata in forma lunga (es. "2 luglio 2026", "July 2, 2026").
 * Gestisce sia date-only (YYYY-MM-DD, campo DATE Postgres) sia timestamp ISO,
 * ancorando alle 12:00 le date-only per evitare slittamenti di timezone.
 */
function formatEventDate(value: string, locale: Locale): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
  return new Intl.DateTimeFormat(INTL_TAG[locale], { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function DashboardInner() {
  const { t, locale } = useI18n()
  const { user: me, isFree, effectiveLabel, hasActiveEventPass, passValidUntil, hasAdvanceAccess } = useEffectiveAccess()
  const { data: sessions } = useSWR('live-sessions', () => live.listSessions())

  const activeCount = sessions?.filter((s) => s.is_active).length ?? 0
  const planDisplay = hasActiveEventPass ? t('dashboard.planEventPass') : effectiveLabel
  const remaining = hasActiveEventPass ? formatRemaining(passValidUntil) : null

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
            <p className="font-semibold text-white">{planDisplay}</p>
            {hasActiveEventPass && (
              <p className="text-[11px] text-pink-300 mt-0.5">
                {t('dashboard.eventPassTempActive')}
                {passValidUntil && (
                  <span className="text-white/40">
                    {' · '}{t('dashboard.eventPassExpires')}: {format(new Date(passValidUntil), 'd MMM, HH:mm')}
                    {remaining && ` · ${t('dashboard.eventPassRemaining')}: ${remaining}`}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        {hasActiveEventPass ? (
          <Link href="/billing">
            <Button size="sm">{t('dashboard.subscribeCta')}</Button>
          </Link>
        ) : isFree ? (
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
          {hasActiveEventPass ? (
            <>
              <p className="text-xs text-white/40">{t('dashboard.eventPassAccessTitle')}</p>
              <p className="text-sm font-bold text-white mt-1 leading-snug">{t('dashboard.eventPassAccessValue')}</p>
            </>
          ) : (
            <>
              <p className="text-xs text-white/40">{t('dashboard.freeLimit')}</p>
              <p className="text-2xl font-black text-white mt-1">
                {isFree ? t('dashboard.freeLimitValue') : t('dashboard.unlimited')}
              </p>
            </>
          )}
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
          {sessions.slice(0, 5).map((s) => {
            const locked = isPremiumSession(s) && !hasAdvanceAccess
            return (
            <Link key={s.id} href={`/sessions/${s.id}`}>
              <Card className={`px-5 py-4 flex items-center justify-between hover:bg-white/5 transition ${locked ? 'opacity-70' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {locked
                      ? <Lock className="h-4 w-4 text-white/40 shrink-0" />
                      : <>
                          {s.session_type === 'wedding' && <Heart className="h-4 w-4 text-pink-400 shrink-0" />}
                          {s.session_type === 'party'   && <PartyPopper className="h-4 w-4 text-purple-400 shrink-0" />}
                        </>}
                    <p className="font-semibold text-white truncate">{s.event_name}</p>
                  </div>
                  <p className="text-xs text-white/40">
                    {formatEventDate(s.created_at, locale)}
                  </p>
                </div>
                {locked ? (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="failed">{t('sessions.locked.badge')}</Badge>
                    <span className="text-[10px] text-white/40">{t('sessions.locked.badgeHint')}</span>
                  </div>
                ) : (
                  <Badge variant={s.is_active ? 'processing' : 'complete'}>
                    {s.is_active ? t('dashboard.active') : t('dashboard.closed')}
                  </Badge>
                )}
              </Card>
            </Link>
            )
          })}
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
