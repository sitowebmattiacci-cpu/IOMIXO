'use client'
// The language MIOLOVE components are shown in, as a `MioloveLocale`: the truthful value of the context, which under MIOLOVE's provider may be a language the
// shared `Locale` does not have. Outside any provider (SSR pre-hydration) it is Italian, like `useI18n()`.
import { useContext } from 'react'
import { I18nContext, type I18nCtx } from '@/lib/i18nContext'
import { DEFAULT_LANG } from './langs'
import type { MioloveLocale } from './locale'

export function useMioloveLocale(): MioloveLocale {
  return useContext(I18nContext)?.locale ?? DEFAULT_LANG
}

/** The whole context (`t`, `setLocale`, `provide`) typed with `MioloveLocale`: what MIOLOVE components migrate to from `useI18n()`. */
export function useMioloveI18n(): I18nCtx<MioloveLocale> {
  const c = useContext(I18nContext)
  return c ?? { locale: DEFAULT_LANG, setLocale: () => {}, t: (path, fallback) => fallback ?? path }
}
