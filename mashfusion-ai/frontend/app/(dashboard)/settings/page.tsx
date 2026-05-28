'use client'
import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  User, Mail, Save, Camera, Loader2, CheckCircle2,
  Lock, AlertCircle, Trash2, Globe,
} from 'lucide-react'
import useSWR, { mutate } from 'swr'
import { auth, user as userApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useI18n } from '@/lib/i18n'
import toast from 'react-hot-toast'
import type { User as UserType } from '@/types'
import Image from 'next/image'

// ── Costanti ──────────────────────────────────────────────────
const MAX_SIZE_MB  = 5
const PLAN_COLORS: Record<string, string> = {
  free:    'bg-white/5 text-white/40',
  pro:     'bg-purple-500/20 text-purple-300',
  studio:  'bg-amber-500/20 text-amber-300',
}

export default function SettingsPage() {
  const { t } = useI18n()
  const { data: me, isLoading } = useSWR<UserType>('me', () => auth.me())

  // ── Profile form state ────────────────────────────────────────
  const [fullName,    setFullName]    = useState('')
  const [savingName,  setSavingName]  = useState(false)
  const [nameSaved,   setNameSaved]   = useState(false)

  // Sync initial value once data arrives
  const initialized = useRef(false)
  if (me && !initialized.current) {
    setFullName(me.full_name ?? '')
    initialized.current = true
  }

  // ── Avatar state ──────────────────────────────────────────────
  const fileInputRef          = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarPreview,   setAvatarPreview]   = useState<string | null>(null)

  // ── Handlers ──────────────────────────────────────────────────
  const handleSaveName = async () => {
    if (!fullName.trim()) { toast.error(t('settings.nameEmpty')); return }
    setSavingName(true)
    try {
      await userApi.updateProfile({ full_name: fullName.trim() })
      await mutate('me')
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2500)
      toast.success(t('settings.nameUpdated'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('settings.saveFailed'))
    } finally {
      setSavingName(false)
    }
  }

  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`${t('settings.imageTooLarge')} ${MAX_SIZE_MB} MB`)
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error(t('settings.onlyImages'))
      return
    }

    // Mostra anteprima immediata
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(file)

    setUploadingAvatar(true)
    try {
      await userApi.uploadAvatar(file)
      await mutate('me')
      toast.success(t('settings.avatarUpdated'))
    } catch (err: unknown) {
      setAvatarPreview(null)
      toast.error(err instanceof Error ? err.message : t('settings.uploadFailed'))
    } finally {
      setUploadingAvatar(false)
      // Reset input so lo stesso file può essere riselezionato
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [t])

  const handleRemoveAvatar = async () => {
    try {
      await userApi.updateProfile({ avatar_url: '' })
      await mutate('me')
      setAvatarPreview(null)
      toast.success(t('settings.avatarRemoved'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('settings.removeAvatarFailed'))
    }
  }

  // ── Loading skeleton ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-7 w-7 text-purple-400 animate-spin" />
      </div>
    )
  }

  const displayAvatar = avatarPreview ?? me?.avatar_url ?? null
  const initials = (me?.full_name ?? me?.email ?? '?')[0].toUpperCase()

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-2xl mx-auto w-full">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl font-black text-white">{t('settings.title')}</h1>
        <p className="text-sm text-white/40 mt-1">{t('settings.subtitle')}</p>
      </motion.div>

      <div className="space-y-5">

        {/* ── Avatar ──────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <div className="glass rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-white/70 mb-5 flex items-center gap-2">
              <Camera className="h-4 w-4 text-purple-400" /> {t('settings.profilePicture')}
            </h2>

            <div className="flex items-center gap-5">
              {/* Avatar preview */}
              <div className="relative flex-shrink-0">
                <div className="h-20 w-20 rounded-2xl overflow-hidden border-2 border-white/10 bg-purple-500/20 flex items-center justify-center">
                  {displayAvatar ? (
                    <Image
                      src={displayAvatar}
                      alt="Avatar"
                      width={80}
                      height={80}
                      className="object-cover w-full h-full"
                      unoptimized={!!avatarPreview} // blob URLs non vengono ottimizzate
                    />
                  ) : (
                    <span className="text-2xl font-bold text-purple-300">{initials}</span>
                  )}
                </div>
                {uploadingAvatar && (
                  <div className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  </div>
                )}
              </div>

              {/* Upload controls */}
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  loading={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  icon={<Camera className="h-3.5 w-3.5" />}
                >
                  {uploadingAvatar ? t('settings.uploading') : t('settings.changePicture')}
                </Button>
                {displayAvatar && (
                  <button
                    onClick={handleRemoveAvatar}
                    className="flex items-center gap-1.5 text-xs text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" /> {t('settings.remove')}
                  </button>
                )}
                <p className="text-[11px] text-white/20">{t('settings.imageHint')} {MAX_SIZE_MB} MB</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Profile info ─────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-white/70 flex items-center gap-2">
              <User className="h-4 w-4 text-purple-400" /> {t('settings.profileInformation')}
            </h2>

            {/* Full name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50">{t('settings.displayName')}</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => { setFullName(e.target.value); setNameSaved(false) }}
                    placeholder={t('settings.yourName')}
                    className="input-field pl-10"
                    maxLength={80}
                  />
                </div>
                <Button
                  size="sm"
                  loading={savingName}
                  disabled={fullName === (me?.full_name ?? '') || !fullName.trim()}
                  onClick={handleSaveName}
                  icon={nameSaved ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <Save className="h-3.5 w-3.5" />}
                >
                  {nameSaved ? t('settings.saved') : t('settings.save')}
                </Button>
              </div>
            </div>

            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50">{t('settings.emailAddress')}</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                <input
                  type="email"
                  value={me?.email ?? ''}
                  readOnly
                  className="input-field pl-10 opacity-50 cursor-not-allowed select-none"
                />
              </div>
              <p className="text-[11px] text-white/20">{t('settings.emailCannotChange')}</p>
            </div>
          </div>
        </motion.div>

        {/* ── Account info ─────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-white/70 flex items-center gap-2">
              <Lock className="h-4 w-4 text-purple-400" /> {t('settings.account')}
            </h2>

            <div className="flex flex-wrap gap-3 items-center text-sm">
              <div className="flex items-center gap-2 text-white/50">
                {t('settings.memberSince')}
                <span className="text-white/70 font-medium">
                  {me?.created_at ? new Date(me.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}
                </span>
              </div>
              <span className="text-white/10">·</span>
              <div className="flex items-center gap-2">
                <span className="text-white/50">{t('settings.plan')}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[me?.plan ?? 'free']}`}>
                  {me?.plan ?? 'free'}
                </span>
              </div>
            </div>

            {/* Cambio password via forgot-password flow */}
            <div className="p-3 rounded-xl bg-white/3 border border-white/6 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-white/70 font-medium">{t('settings.password')}</p>
                <p className="text-xs text-white/30 mt-0.5">{t('settings.passwordDesc')}</p>
              </div>
              <a href={`/forgot-password`}>
                <Button size="sm" variant="ghost" icon={<Lock className="h-3.5 w-3.5" />}>
                  {t('settings.change')}
                </Button>
              </a>
            </div>
          </div>
        </motion.div>

        {/* ── Language ───────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-white/70 flex items-center gap-2">
              <Globe className="h-4 w-4 text-purple-400" /> {t('settings.language')}
            </h2>
            <p className="text-xs text-white/40">{t('settings.languageDesc')}</p>
            <LanguageSwitcher />
          </div>
        </motion.div>

        {/* ── Danger zone ──────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="glass rounded-2xl p-6 border border-red-500/10">
            <h2 className="text-sm font-semibold text-red-400/70 flex items-center gap-2 mb-4">
              <AlertCircle className="h-4 w-4" /> {t('settings.dangerZone')}
            </h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-white/60 font-medium">{t('settings.deleteAccount')}</p>
                <p className="text-xs text-white/30 mt-0.5">{t('settings.deleteAccountDesc')}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400 hover:text-red-300 border-red-500/20 hover:bg-red-500/10"
                onClick={() => toast.error(t('settings.deleteContactSupport'))}
                icon={<Trash2 className="h-3.5 w-3.5" />}
              >
                {t('settings.delete')}
              </Button>
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  )
}
