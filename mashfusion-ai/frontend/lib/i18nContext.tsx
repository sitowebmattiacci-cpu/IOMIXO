'use client'
// The translation context, shared by the two providers: IOMIXO's (lib/i18n.tsx, four languages) and MIOLOVE's (lib/miolove/MioloveI18nProvider.tsx, up to twelve).
// Holds no dictionary and no portal logic. Components keep calling `useI18n()` (lib/i18n.tsx); the provider above them decides what the texts are.
import { createContext } from 'react'
import type { Locale } from '@/lib/locales'
import type { MioloveLocale } from '@/lib/miolove/locale'

// `L` is the language type of the provider that serves the context. Methods (not properties) on purpose: a provider of the narrower type stays assignable.
export interface I18nCtx<L extends string = Locale> {
  locale: L
  setLocale(l: L): void
  t(path: string, fallback?: string): string
  /** MIOLOVE public pages: hands the provider the texts only they read (home, guide) for the language they were rendered in. Nothing else calls it. */
  provide?(locale: L, texts: Record<string, any>): void
}

/** What the context can hold: IOMIXO's provider only ever puts a `Locale` in it, MIOLOVE's any `MioloveLocale`. */
export const I18nContext = createContext<I18nCtx<MioloveLocale> | null>(null)

export function pick(dict: any, path: string): string | undefined {
  return path.split('.').reduce<any>((acc, key) => (acc != null ? acc[key] : undefined), dict)
}
