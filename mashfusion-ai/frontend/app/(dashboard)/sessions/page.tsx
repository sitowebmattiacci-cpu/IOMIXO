'use client'
import { useState } from 'react'
import Link from 'next/link'
import useSWR, { mutate } from 'swr'
import { Plus, Radio, Heart } from 'lucide-react'
import toast from 'react-hot-toast'
import { auth, live } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatRelativeTime } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { User } from '@/types'

type SessionType = 'standard' | 'wedding'

const EMPTY_FORM = {
  event_name: '',
  dj_name: '',
  description: '',
  session_type: 'standard' as SessionType,
  couple_names: '',
  wedding_date: '',
  venue_name: '',
  screen_mode_enabled: false,
}

export default function LiveSessionsPage() {
  const { t } = useI18n()
  const { data: me } = useSWR<User>('me', () => auth.me())
  const { data: sessions } = useSWR('live-sessions', () => live.listSessions())
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  const userPlan = (me?.plan ?? 'free') as string
  const isWeddingPlan = userPlan === 'wedding' || userPlan === 'club' || userPlan === 'studio'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.event_name.trim()) return
    if (form.session_type === 'wedding' && !isWeddingPlan) {
      toast.error(t('common.weddingPaywall'))
      return
    }
    setSubmitting(true)
    try {
      const payload: any = {
        event_name: form.event_name,
        dj_name: form.dj_name || undefined,
        description: form.description || undefined,
        session_type: form.session_type,
      }
      if (form.session_type === 'wedding') {
        payload.couple_names = form.couple_names || undefined
        payload.wedding_date = form.wedding_date || undefined
        payload.venue_name = form.venue_name || undefined
        payload.screen_mode_enabled = form.screen_mode_enabled
      }
      const session = await live.createSession(payload)
      toast.success(t('sessions.created'))
      setForm(EMPTY_FORM)
      setCreating(false)
      await mutate('live-sessions')
      window.location.href = `/sessions/${session.id}`
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? err?.message ?? t('common.errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">{t('sessions.title')}</h1>
          <p className="text-sm text-white/40 mt-1">{t('sessions.subtitle')}</p>
        </div>
        {!creating && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            {t('sessions.new')}
          </Button>
        )}
      </div>

      {creating && (
        <Card className="mb-6">
          <form onSubmit={submit} className="space-y-4">
            {/* Session type */}
            <div>
              <label className="text-xs text-white/60 mb-2 block">{t('sessions.type')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, session_type: 'standard' })}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    form.session_type === 'standard'
                      ? 'border-purple-400 bg-purple-500/10 text-white'
                      : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                  }`}
                >
                  <Radio className="inline h-4 w-4 mr-1" />
                  {t('sessions.typeStandard')}
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, session_type: 'wedding' })}
                  className={`rounded-lg border px-3 py-2 text-sm transition relative ${
                    form.session_type === 'wedding'
                      ? 'border-pink-400 bg-pink-500/10 text-white'
                      : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                  }`}
                >
                  <Heart className="inline h-4 w-4 mr-1" />
                  {t('sessions.typeWedding')}
                  {!isWeddingPlan && (
                    <span className="absolute -top-2 -right-2 text-[9px] bg-pink-500 text-white rounded-full px-2 py-0.5">
                      PRO
                    </span>
                  )}
                </button>
              </div>
              {form.session_type === 'wedding' && !isWeddingPlan && (
                <div className="mt-3 rounded-lg border border-pink-400/30 bg-pink-500/5 p-3 text-xs text-pink-100/80">
                  {t('common.weddingPaywall')}{' '}
                  <Link href="/billing" className="underline">
                    {t('common.upgrade')}
                  </Link>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-white/60">{t('sessions.eventName')}</label>
              <input
                value={form.event_name}
                onChange={(e) => setForm({ ...form, event_name: e.target.value })}
                className="w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400"
                required
              />
            </div>
            <div>
              <label className="text-xs text-white/60">{t('sessions.djName')}</label>
              <input
                value={form.dj_name}
                onChange={(e) => setForm({ ...form, dj_name: e.target.value })}
                className="w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400"
              />
            </div>
            <div>
              <label className="text-xs text-white/60">{t('sessions.description')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400"
              />
            </div>

            {form.session_type === 'wedding' && (
              <div className="space-y-3 rounded-xl border border-pink-400/20 bg-pink-500/5 p-4">
                <div>
                  <label className="text-xs text-white/60">{t('sessions.coupleNames')}</label>
                  <input
                    value={form.couple_names}
                    onChange={(e) => setForm({ ...form, couple_names: e.target.value })}
                    className="w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-400"
                    placeholder="Anna & Marco"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60">{t('sessions.weddingDate')}</label>
                    <input
                      type="date"
                      value={form.wedding_date}
                      onChange={(e) => setForm({ ...form, wedding_date: e.target.value })}
                      className="w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/60">{t('sessions.venueName')}</label>
                    <input
                      value={form.venue_name}
                      onChange={(e) => setForm({ ...form, venue_name: e.target.value })}
                      className="w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-400"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.screen_mode_enabled}
                    onChange={(e) => setForm({ ...form, screen_mode_enabled: e.target.checked })}
                    className="accent-pink-500"
                  />
                  {t('sessions.screenModeEnabled')}
                </label>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                loading={submitting}
                disabled={form.session_type === 'wedding' && !isWeddingPlan}
              >
                {t('sessions.create')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!sessions || sessions.length === 0 ? (
        !creating && (
          <Card className="text-center py-12">
            <Radio className="h-10 w-10 text-white/20 mx-auto mb-4" />
            <p className="text-white/60 mb-4">{t('sessions.noneYet')}</p>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              {t('sessions.createFirst')}
            </Button>
          </Card>
        )
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <Link key={s.id} href={`/sessions/${s.id}`}>
              <Card className="px-5 py-4 flex items-center justify-between hover:bg-white/5 transition">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {s.session_type === 'wedding' && <Heart className="h-4 w-4 text-pink-400 shrink-0" />}
                    <p className="font-semibold text-white truncate">{s.event_name}</p>
                  </div>
                  <p className="text-xs text-white/40">
                    {formatRelativeTime(s.created_at)} · /live/{s.public_slug}
                  </p>
                </div>
                <Badge variant={s.is_active ? 'processing' : 'complete'}>
                  {s.is_active ? t('sessions.active') : t('sessions.closed')}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
