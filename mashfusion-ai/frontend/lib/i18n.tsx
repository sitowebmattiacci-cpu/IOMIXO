'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import it from '@/locales/it.json'
import en from '@/locales/en.json'
import es from '@/locales/es.json'
import fr from '@/locales/fr.json'
// MIOLOVE-only strings live in their own files (locales/miolove/*): merged over the shared dictionaries, never replacing a string IOMIXO reads.
import { type Locale, LOCALES } from '@/lib/locales'
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

const DICTS: Record<Locale, any> = { it: deepMerge(it, mlIt), en: deepMerge(en, mlEn), es: deepMerge(es, mlEs), fr: deepMerge(fr, mlFr) }
const LOCALE_STORAGE_KEY = 'iomixo.locale'
const SUPPORTED: Locale[] = LOCALES

interface I18nCtx {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (path: string, fallback?: string) => string
}

const Ctx = createContext<I18nCtx | null>(null)

function pick(dict: any, path: string): string | undefined {
  return path.split('.').reduce<any>((acc, key) => (acc != null ? acc[key] : undefined), dict)
}

function detectInitial(): Locale {
  if (typeof window === 'undefined') return 'it'
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY) as Locale | null
  if (stored && SUPPORTED.includes(stored)) return stored
  const nav = (navigator.language || 'it').slice(0, 2).toLowerCase()
  return (SUPPORTED as string[]).includes(nav) ? (nav as Locale) : 'it'
}

/** `initialLocale`: an explicit language chosen by the URL (?lang=) wins over the stored / browser one; without it nothing changes. */
export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? 'it')

  useEffect(() => {
    if (!initialLocale) { setLocaleState(detectInitial()); return }
    // A language chosen by the URL is remembered too, so the pages the visitor opens next stay in it.
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, initialLocale) } catch { /* private mode */ }
  }, [initialLocale])

  const setLocale = (l: Locale) => {
    setLocaleState(l)
    if (typeof window !== 'undefined') window.localStorage.setItem(LOCALE_STORAGE_KEY, l)
  }

  const t = (path: string, fallback?: string): string => {
    const fromLocale = pick(DICTS[locale], path)
    if (typeof fromLocale === 'string') return fromLocale
    const fromIt = pick(DICTS.it, path)
    if (typeof fromIt === 'string') return fromIt
    return fallback ?? path
  }

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx)
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
