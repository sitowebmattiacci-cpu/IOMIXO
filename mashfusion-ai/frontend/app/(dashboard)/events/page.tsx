'use client'
import { useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import toast from 'react-hot-toast'
import { CalendarDays, Plus, Trash2, MapPin, Ticket, Eye, EyeOff } from 'lucide-react'
import { djEvents, auth, type DjEvent } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { UpgradeGate } from '@/components/live/UpgradeGate'
import type { User } from '@/types'

const EMPTY = { title: '', event_date: '', venue_name: '', city: '', ticket_url: '', is_public: true }

export default function EventsPage() {
  const { data: me } = useSWR<User>('me', () => auth.me())
  const isFree = !me || me.plan === 'free'
  const { data: events } = useSWR(!isFree ? 'dj-events' : null, () => djEvents.list())
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
      toast.success('Evento creato')
      setForm(EMPTY); setCreating(false)
      await refresh()
    } catch (err: any) {
      toast.error(err?.message ?? 'Errore')
    } finally { setSubmitting(false) }
  }

  const toggleVisibility = async (ev: DjEvent) => {
    try {
      await djEvents.update(ev.id, { is_public: !ev.is_public })
      await refresh()
    } catch (err: any) { toast.error(err?.message ?? 'Errore') }
  }

  const remove = async (ev: DjEvent) => {
    if (!confirm(`Eliminare "${ev.title}"?`)) return
    try { await djEvents.remove(ev.id); await refresh() }
    catch (err: any) { toast.error(err?.message ?? 'Errore') }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Prossime date</h1>
          <p className="text-sm text-white/40 mt-1">Mostrale sulla tua pagina pubblica.</p>
        </div>
        {!creating && !isFree && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuovo evento</Button>
        )}
      </div>

      {isFree && (
        <UpgradeGate
          title="Calendario eventi solo Pro"
          message="Pubblica le tue prossime serate sulla pagina richieste. Disponibile con il piano Pro."
        />
      )}

      {!isFree && creating && (
        <Card className="mb-6">
          <form onSubmit={submit} className="space-y-3">
            <Input label="Titolo *" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Data" type="date" value={form.event_date} onChange={(v) => setForm({ ...form, event_date: v })} />
              <Input label="Locale" value={form.venue_name} onChange={(v) => setForm({ ...form, venue_name: v })} />
              <Input label="Città" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
              <Input label="Link biglietti" value={form.ticket_url} onChange={(v) => setForm({ ...form, ticket_url: v })} placeholder="https://…" />
            </div>
            <label className="flex items-center gap-2 text-xs text-white/60">
              <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
              Mostra sulla pagina pubblica
            </label>
            <div className="flex gap-2">
              <Button type="submit" loading={submitting}>Crea evento</Button>
              <Button type="button" variant="ghost" onClick={() => { setCreating(false); setForm(EMPTY) }}>Annulla</Button>
            </div>
          </form>
        </Card>
      )}

      {!isFree && (!events || events.length === 0 ? (
        !creating && (
          <Card className="text-center py-12">
            <CalendarDays className="h-10 w-10 text-white/20 mx-auto mb-4" />
            <p className="text-white/60 mb-4">Nessun evento ancora.</p>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Aggiungi il primo</Button>
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
                    {ev.is_public ? 'Pubblico' : 'Nascosto'}
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
                      <Ticket className="h-3 w-3" /> Biglietti
                    </a>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => toggleVisibility(ev)}
                  icon={ev.is_public ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}>
                  {ev.is_public ? 'Nascondi' : 'Mostra'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(ev)} icon={<Trash2 className="h-3.5 w-3.5" />}>
                  Elimina
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
