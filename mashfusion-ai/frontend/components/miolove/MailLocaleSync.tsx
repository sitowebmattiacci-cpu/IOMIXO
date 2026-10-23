'use client'
import { useEffect } from 'react'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useAccountRole } from '@/lib/roles'
import { useI18n } from '@/lib/i18n'
import { saveMailLocale } from '@/lib/events/ownerService'

/** MIOLOVE only: keeps users/{uid}.locale equal to the language the owner is reading the app in, so every e-mail speaks it. Once per account + language per browser tab; silent on failure. */
export function MailLocaleSync() {
  const { user } = useAuth()
  const { isCouple, ready } = useAccountRole()
  const { locale } = useI18n()
  useEffect(() => {
    if (!user || user.isAnonymous || !ready || !isCouple) return
    const key = `miolove.mailLocale.${user.uid}`
    try { if (window.sessionStorage.getItem(key) === locale) return } catch { /* private mode: just send it */ }
    saveMailLocale(locale).then(() => { try { window.sessionStorage.setItem(key, locale) } catch { /* ignore */ } }).catch(() => {})
  }, [user, ready, isCouple, locale])
  return null
}
