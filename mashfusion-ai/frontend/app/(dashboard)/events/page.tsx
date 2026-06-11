'use client'
import { useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import toast from 'react-hot-toast'
import { CalendarDays, Plus, Trash2, MapPin, Ticket, Eye, EyeOff } from 'lucide-react'
import { djEvents, type DjEvent } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { UpgradeGate } from '@/components/live/UpgradeGate'
import { useEffectiveAccess } from '@/lib/access'
import { useI18n } from '@/lib/i18n'

const EMPTY = { title: '', event_date: '', venue_name: '', city: '', ticket_url: '', is_public: true }

export default function EventsPage() {
  const { t } = useI18n()
  const { hasProAccess } = useEffectiveAccess()
  const { data: events } = useSWR(hasProAccess ? 'dj-events' : null, () => djEvents.list())
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)

  const refresh = () => globalMutate('dj-events')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSubmitting(true)
    try {
      await djEvents.create({
        title: form.title,
        event_date: form.event_date || null,
        venue_name: form.venue_name || null,
        city: form.city || null,
        ticket_url: form.ticket_url || null,
        is_public: form.is_public,
      })
      toast.success(t('events.created'))
      setForm(EMPTY); setCreating(false)
      await refresh()
    } catch (err: any) {
      toast.error(err?.message ?? t('events.genericError'))
    } finally { setSubmitting(false) }
  }

  const toggleVisibility = async (ev: DjEvent) => {
    try {
      await djEvents.update(ev.id, { is_public: !ev.is_public })
      await refresh()
    } catch (err: any) { toast.error(err?.message ?? t('events.genericError')) }
  }

  const remove = async (ev: DjEvent) => {
    if (!confirm(t('events.confirmDelete', `Eliminare "${ev.title}"?`).replace('{title}', ev.title))) return
    try { await djEvents.remove(ev.id); await refresh() }
    catch (err: any) { toast.error(err?.message ?? t('events.genericError')) }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">{t('events.title')}</h1>
          <p className="text-sm text-white/40 mt-1">{t('events.subtitle')}</p>
        </div>
        {!creating && hasProAccess && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>{t('events.newEvent')}</Button>
        )}
      </div>

      {!hasProAccess && (
        <UpgradeGate
          title={t('events.calendarProOnly')}
          message={t('events.calendarProOnlyMsg')}
        />
      )}

      {hasProAccess && creating && (
        <Card className="mb-6">
          <form onSubmit={submit} className="space-y-3">
            <Input label={t('events.fieldTitle')} value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label={t('events.date')} type="date" value={form.event_date} onChange={(v) => setForm({ ...form, event_date: v })} />
              <Input label={t('events.venue')} value={form.venue_name} onChange={(v) => setForm({ ...form, venue_name: v })} />
              <Input label={t('events.city')} value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
              <Input label={t('events.ticketLink')} value={form.ticket_url} onChange={(v) => setForm({ ...form, ticket_url: v })} placeholder="https://…" />
            </div>
            <label className="flex items-center gap-2 text-xs text-white/60">
              <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
              {t('events.showPublic')}
            </label>
            <div className="flex gap-2">
              <Button type="submit" loading={submitting}>{t('events.create')}</Button>
              <Button type="button" variant="ghost" onClick={() => { setCreating(false); setForm(EMPTY) }}>{t('events.cancel')}</Button>
            </div>
          </form>
        </Card>
      )}

      {hasProAccess && (!events || events.length === 0 ? (
        !creating && (
          <Card className="text-center py-12">
            <CalendarDays className="h-10 w-10 text-white/20 mx-auto mb-4" />
            <p className="text-white/60 mb-4">{t('events.noEvents')}</p>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>{t('events.addFirst')}</Button>
          </Card>
        )
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <Card key={ev.id} className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-white truncate">{ev.title}</p>
                  <Badge variant={ev.is_public ? 'complete' : 'queued'}>
                    {ev.is_public ? t('events.public') : t('events.hidden')}
                  </Badge>
                </div>
                <div className="text-xs text-white/40 mt-1 flex items-center gap-3 flex-wrap">
                  {ev.event_date && <span>{new Date(ev.event_date).toLocaleDateString('it-IT')}</span>}
                  {(ev.venue_name || ev.city) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {[ev.venue_name, ev.city].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {ev.ticket_url && (
                    <a href={ev.ticket_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-purple-300 hover:text-purple-200">
                      <Ticket className="h-3 w-3" /> {t('events.tickets')}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => toggleVisibility(ev)}
                  icon={ev.is_public ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}>
                  {ev.is_public ? t('events.hide') : t('events.show')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(ev)} icon={<Trash2 className="h-3.5 w-3.5" />}>
                  {t('events.delete')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ))}
    </div>
  )
}

function Input({ label, value, onChange, type = 'text', required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; required?: boolean; placeholder?: string
}) {
  return (
    <div>
      <label className="text-xs text-white/60">{label}</label>
      <input type={type} value={value} required={required} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400" />
    </div>
  )
}
