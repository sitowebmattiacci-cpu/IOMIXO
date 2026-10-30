'use client'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import it from '@/locales/it.json'
import en from '@/locales/en.json'
import es from '@/locales/es.json'
import fr from '@/locales/fr.json'
// MIOLOVE-only strings live in their own files (locales/miolove/*): these files hold the CORE texts (everything but home / guide / service-page titles, which live in a separate file per language and are delivered by the server).
import { type Locale, LOCALES } from '@/lib/locales'
import { I18nContext, pick, type I18nCtx } from '@/lib/i18nContext'
import mlIt from '@/locales/miolove/it.json'
import mlEn from '@/locales/miolove/en.json'
import mlEs from '@/locales/miolove/es.json'
import mlFr from '@/locales/miolove/fr.json'

export type { Locale }

function deepMerge(base: any, over: any): any {
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v
  }
  return out
}

// MIOLOVE core texts over the platform ones, exactly as before; the home / guide texts (read by no other page) arrive with those pages (see `provide`).
const DICTS: Record<Locale, any> = { it: deepMerge(it, mlIt), en: deepMerge(en, mlEn), es: deepMerge(es, mlEs), fr: deepMerge(fr, mlFr) }
export const LOCALE_STORAGE_KEY = 'iomixo.locale'
const SUPPORTED: Locale[] = LOCALES

/** A text of the bundled dictionaries (the four shared languages), or undefined. The MIOLOVE provider reads through this while it migrates off the bundled tables. */
export function bundledText(locale: string, path: string): string | undefined {
  const dict = (DICTS as Record<string, any>)[locale]
  const v = dict ? pick(dict, path) : undefined
  return typeof v === 'string' ? v : undefined
}

export function detectInitial(): Locale {
  if (typeof window === 'undefined') return 'it'
  let stored: Locale | null = null
  try { stored = window.localStorage.getItem(LOCALE_STORAGE_KEY) as Locale | null } catch { /* storage refused (restrictive in-app browser, blocked site data): the page must still render */ }
  if (stored && SUPPORTED.includes(stored)) return stored
  const nav = (navigator.language || 'it').slice(0, 2).toLowerCase()
  return (SUPPORTED as string[]).includes(nav) ? (nav as Locale) : 'it'
}

/**
 * IOMIXO's provider (the four shared languages, bundled dictionaries). `initialLocale`: an explicit language chosen by the URL (?lang=) wins over the stored /
 * browser one; without it nothing changes. MIOLOVE has its own provider (lib/miolove/MioloveI18nProvider.tsx) over the same context.
 */
export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? 'it')

  useEffect(() => {
    if (!initialLocale) { setLocaleState(detectInitial()); return }
    // A language chosen by the URL is remembered too, so the pages the visitor opens next stay in it.
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, initialLocale) } catch { /* private mode */ }
  }, [initialLocale])

  const setLocale = (l: Locale) => {
    setLocaleState(l)
    if (typeof window !== 'undefined') { try { window.localStorage.setItem(LOCALE_STORAGE_KEY, l) } catch { /* storage refused: the language just is not remembered */ } }
  }

  // Texts delivered by the server with a page (MIOLOVE home / guide), per language. Read at call time; empty everywhere else, IOMIXO included.
  const delivered = useRef<Map<Locale, any>>(new Map())
  const provide = (l: Locale, texts: Record<string, any>) => { delivered.current.set(l, texts) }

  const t = (path: string, fallback?: string): string => {
    const fromLocale = pick(DICTS[locale], path)
    if (typeof fromLocale === 'string') return fromLocale
    const fromDelivered = pick(delivered.current.get(locale), path)
    if (typeof fromDelivered === 'string') return fromDelivered
    const fromIt = pick(DICTS.it, path)
    if (typeof fromIt === 'string') return fromIt
    const fromItDelivered = pick(delivered.current.get('it'), path)
    if (typeof fromItDelivered === 'string') return fromItDelivered
    return fallback ?? path
  }

  return <I18nContext.Provider value={{ locale, setLocale, t, provide }}>{children}</I18nContext.Provider>
}

/**
 * Shared hook, typed with the shared `Locale`. Under IOMIXO's provider that is exact. Under MIOLOVE's it is exact for the published languages; a language only
 * MIOLOVE has (de…) is read with `useMioloveLocale()` instead, which is why that hook exists. `t` and `setLocale` are the same in both.
 */
export function useI18n(): I18nCtx {
  const c = useContext(I18nContext) as I18nCtx | null
  if (!c) {
    // Fallback (renders outside the provider during SSR pre-hydration)
    return {
      locale: 'it',
      setLocale: () => {},
      t: (path: string, fallback?: string) => (pick(DICTS.it, path) as string) ?? fallback ?? path,
    }
  }
  return c
}

export const SUPPORTED_LOCALES = SUPPORTED
