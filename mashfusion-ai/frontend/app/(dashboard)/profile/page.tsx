'use client'
import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import toast from 'react-hot-toast'
import { UserCircle, Save, Upload } from 'lucide-react'
import { djProfile, auth, type DjProfile } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { UpgradeGate } from '@/components/live/UpgradeGate'
import type { User } from '@/types'

const EMPTY: DjProfile = {
  display_name: '',
  bio: '',
  instagram_url: '',
  tiktok_url: '',
  spotify_url: '',
  soundcloud_url: '',
  website_url: '',
  avatar_url: '',
  public_slug: '',
}

export default function ProfilePage() {
  const { data, mutate } = useSWR('dj-profile', () => djProfile.get())
  const { data: me } = useSWR<User>('me', () => auth.me())
  const isFree = !me || me.plan === 'free'
  const [form, setForm] = useState<DjProfile>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const updated = await djProfile.uploadAvatar(file)
      await mutate(updated, { revalidate: false })
      setForm((f) => ({ ...f, avatar_url: updated.avatar_url ?? '' }))
      toast.success('Foto profilo aggiornata')
    } catch (err: any) {
      toast.error(err?.message ?? 'Upload fallito')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  useEffect(() => {
    if (data) {
      setForm({
        display_name:   data.display_name   ?? '',
        bio:            data.bio            ?? '',
        instagram_url:  data.instagram_url  ?? '',
        tiktok_url:     data.tiktok_url     ?? '',
        spotify_url:    data.spotify_url    ?? '',
        soundcloud_url: data.soundcloud_url ?? '',
        website_url:    data.website_url    ?? '',
        avatar_url:     data.avatar_url     ?? '',
        public_slug:    data.public_slug    ?? '',
      })
    }
  }, [data])

  const set = (k: keyof DjProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await djProfile.update(form)
      await mutate(updated, { revalidate: false })
      toast.success('Profilo aggiornato')
    } catch (err: any) {
      toast.error(err?.message ?? 'Errore')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-purple-500/15 text-purple-300 flex items-center justify-center">
          <UserCircle className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-white">Profilo DJ</h1>
          <p className="text-sm text-white/40">Personalizza la tua pagina pubblica.</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <Card className="space-y-4">
          <Field label="Nome d'arte">
            <input value={form.display_name ?? ''} onChange={set('display_name')} className={inputCls} placeholder="DJ Nome" />
          </Field>
          <Field label="Foto profilo" hint="JPEG, PNG o WEBP — max 5 MB.">
            <div className="flex items-center gap-3 mt-1">
              {form.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover border border-white/10" />
              ) : (
                <div className="h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/30">
                  <UserCircle className="h-8 w-8" />
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarFile}
                className="hidden"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={uploading}
                icon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => fileRef.current?.click()}
              >
                {form.avatar_url ? 'Cambia foto' : 'Carica foto'}
              </Button>
            </div>
          </Field>
          <Field label="Slug pubblico" hint="Sarà /live/tuoslug (solo lettere, numeri, trattini)">
            <input value={form.public_slug ?? ''} onChange={set('public_slug')} className={inputCls} placeholder="tuo-nome" />
          </Field>
          <Field label="Bio">
            <textarea value={form.bio ?? ''} onChange={set('bio')} rows={3} className={inputCls} placeholder="Racconta chi sei…" />
          </Field>
        </Card>

        {isFree ? (
          <UpgradeGate
            compact
            title="Link social bloccati"
            message="Mostra Instagram, TikTok, Spotify e sito web sulla tua pagina pubblica con il piano Pro."
          />
        ) : (
          <Card className="space-y-4">
            <p className="text-xs text-white/40 uppercase tracking-wide">Social</p>
            <Field label="Instagram"><input value={form.instagram_url ?? ''} onChange={set('instagram_url')} className={inputCls} placeholder="https://instagram.com/…" /></Field>
            <Field label="TikTok"><input value={form.tiktok_url ?? ''} onChange={set('tiktok_url')} className={inputCls} placeholder="https://tiktok.com/@…" /></Field>
            <Field label="Spotify"><input value={form.spotify_url ?? ''} onChange={set('spotify_url')} className={inputCls} placeholder="https://open.spotify.com/…" /></Field>
            <Field label="SoundCloud"><input value={form.soundcloud_url ?? ''} onChange={set('soundcloud_url')} className={inputCls} placeholder="https://soundcloud.com/…" /></Field>
            <Field label="Sito web"><input value={form.website_url ?? ''} onChange={set('website_url')} className={inputCls} placeholder="https://…" /></Field>
          </Card>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={saving} icon={<Save className="h-4 w-4" />}>Salva profilo</Button>
        </div>
      </form>
    </div>
  )
}

const inputCls =
  'w-full mt-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-white/60">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-white/30 mt-1">{hint}</p>}
    </div>
  )
}
