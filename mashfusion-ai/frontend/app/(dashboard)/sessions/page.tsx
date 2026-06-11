'use client'
import { useState } from 'react'
import Link from 'next/link'
import useSWR, { mutate } from 'swr'
import { Plus, Radio, Heart, PartyPopper, Sparkles, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { live } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatRelativeTime } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { useEffectiveAccess, isPremiumSession } from '@/lib/access'

type SessionType = 'standard' | 'party' | 'wedding'

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

// Step in the create-session flow.
//  - 'idle'   : list view (no form open)
//  - 'choose' : Advance users pick Party Mode vs Wedding Edition
//  - 'form'   : the actual create form (the chosen session_type is locked in)
type CreateStep = 'idle' | 'choose' | 'form'

export default function LiveSessionsPage() {
  const { t } = useI18n()
  const { data: sessions } = useSWR('live-sessions', () => live.listSessions())
  const [step, setStep] = useState<CreateStep>('idle')
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  // Accesso premium: piano Advance reale OPPURE Event Pass 24H attivo.
  const { hasAdvanceAccess: isAdvance } = useEffectiveAccess()

  const startCreate = () => {
    setForm(EMPTY_FORM)
    // Advance users get the experience picker; everyone else jumps straight
    // to the standard session form.
    if (isAdvance) {
      setStep('choose')
    } else {
      setForm((f) => ({ ...f, session_type: 'standard' }))
      setStep('form')
    }
  }

  const pickExperience = (type: 'party' | 'wedding') => {
    setForm({ ...EMPTY_FORM, session_type: type })
    setStep('form')
  }

  const cancelCreate = () => {
    setForm(EMPTY_FORM)
    setStep('idle')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.event_name.trim()) return
    if ((form.session_type === 'wedding' || form.session_type === 'party') && !isAdvance) {
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
      setStep('idle')
      await mutate('live-sessions')
      window.location.href = `/sessions/${session.id}`
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? err?.message ?? t('common.errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const isWeddingForm = form.session_type === 'wedding'
  const isPartyForm   = form.session_type === 'party'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">{t('sessions.title')}</h1>
          <p className="text-sm text-white/40 mt-1">{t('sessions.subtitle')}</p>
        </div>
        {step === 'idle' && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={startCreate}>
            {t('sessions.new')}
          </Button>
        )}
      </div>

      {/* ─── Step 1: choose experience (Advance only) ─────────────────── */}
      {step === 'choose' && (
        <Card className="mb-6">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-white">{t('sessions.chooseExperience')}</h2>
            <p className="text-xs text-white/50 mt-1">{t('sessions.chooseExperienceSubtitle')}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => pickExperience('party')}
              className="text-left rounded-2xl border border-white/10 bg-gradient-to-br from-purple-600/15 to-fuchsia-600/5 hover:border-purple-400 hover:from-purple-600/25 transition p-5"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-300">
                  <PartyPopper className="h-5 w-5" />
                </div>
                <p className="font-bold text-white">{t('sessions.partyTitle')}</p>
              </div>
              <p className="text-xs text-white/60 leading-relaxed">
                {t('sessions.partyPerfectFor')}
              </p>
            </button>

            <button
              type="button"
              onClick={() => pickExperience('wedding')}
              className="text-left rounded-2xl border border-white/10 bg-gradient-to-br from-pink-600/15 to-rose-600/5 hover:border-pink-400 hover:from-pink-600/25 transition p-5"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-xl bg-pink-500/20 flex items-center justify-center text-pink-300">
                  <Heart className="h-5 w-5" />
                </div>
                <p className="font-bold text-white">{t('sessions.weddingTitle')}</p>
              </div>
              <p className="text-xs text-white/60 leading-relaxed">
                {t('sessions.weddingPerfectFor')}
              </p>
            </button>
          </div>

          <div className="mt-4">
            <Button type="button" variant="ghost" onClick={cancelCreate}>{t('common.cancel')}</Button>
          </div>
        </Card>
      )}

      {/* ─── Step 2: actual form ──────────────────────────────────────── */}
      {step === 'form' && (
        <Card className="mb-6">
          <form onSubmit={submit} className="space-y-4">
            {/* Selected type badge */}
            <div className="flex items-center gap-2 text-xs text-white/60">
              <span>{t('sessions.type')}:</span>
              {isWeddingForm && (
                <span className="inline-flex items-center gap-1 rounded-full bg-pink-500/15 text-pink-200 px-2.5 py-0.5">
                  <Heart className="h-3 w-3" /> {t('sessions.typeWedding')}
                </span>
              )}
              {isPartyForm && (
                <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 text-purple-200 px-2.5 py-0.5">
                  <PartyPopper className="h-3 w-3" /> {t('sessions.typeParty')}
                </span>
              )}
              {!isWeddingForm && !isPartyForm && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/5 text-white/70 px-2.5 py-0.5">
                  <Radio className="h-3 w-3" /> {t('sessions.typeStandard')}
                </span>
              )}
              {isAdvance && (
                <button
                  type="button"
                  onClick={() => setStep('choose')}
                  className="ml-auto text-[11px] text-white/40 hover:text-white underline"
                >
                  {t('common.back')}
                </button>
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

            {isWeddingForm && (
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

            {isPartyForm && (
              <div className="rounded-xl border border-purple-400/20 bg-purple-500/5 p-4 text-xs text-purple-100/80 flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-purple-300 mt-0.5 shrink-0" />
                <p>{t('sessions.partyPerfectFor')}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                loading={submitting}
                disabled={(isWeddingForm || isPartyForm) && !isAdvance}
              >
                {t('sessions.create')}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelCreate}>
                {t('common.cancel')}
              </Button>
              {(isWeddingForm || isPartyForm) && !isAdvance && (
                <Link href="/billing" className="ml-auto text-xs text-pink-300 underline self-center">
                  {t('common.upgrade')}
                </Link>
              )}
            </div>
          </form>
        </Card>
      )}

      {/* ─── Sessions list ────────────────────────────────────────────── */}
      {!sessions || sessions.length === 0 ? (
        step === 'idle' && (
          <Card className="text-center py-12">
            <Radio className="h-10 w-10 text-white/20 mx-auto mb-4" />
            <p className="text-white/60 mb-4">{t('sessions.noneYet')}</p>
            <Button icon={<Plus className="h-4 w-4" />} onClick={startCreate}>
              {t('sessions.createFirst')}
            </Button>
          </Card>
        )
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const locked = isPremiumSession(s) && !isAdvance
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
                    {formatRelativeTime(s.created_at)} · /live/{s.public_slug}
                  </p>
                </div>
                {locked ? (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="failed">{t('sessions.locked.badge')}</Badge>
                    <span className="text-[10px] text-white/40">{t('sessions.locked.badgeHint')}</span>
                  </div>
                ) : (
                  <Badge variant={s.is_active ? 'processing' : 'complete'}>
                    {s.is_active ? t('sessions.active') : t('sessions.closed')}
                  </Badge>
                )}
              </Card>
            </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
