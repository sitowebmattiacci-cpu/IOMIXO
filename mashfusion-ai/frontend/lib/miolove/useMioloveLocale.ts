'use client'
// The language MIOLOVE components are shown in, as a `MioloveLocale`. Today the provider only holds the four shared languages (every `Locale` is a
// `MioloveLocale`), so this is the shared hook seen through the wider type; it is the one place that changes when the first new language goes live.
import { useI18n } from '@/lib/i18n'
import type { MioloveLocale } from './locale'

export function useMioloveLocale(): MioloveLocale {
  return useI18n().locale
}
