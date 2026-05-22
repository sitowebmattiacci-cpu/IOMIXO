'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import it from '@/locales/it.json'
import en from '@/locales/en.json'
import es from '@/locales/es.json'
import fr from '@/locales/fr.json'

export type Locale = 'it' | 'en' | 'es' | 'fr'

const DICTS: Record<Locale, any> = { it, en, es, fr }
const LOCALE_STORAGE_KEY = 'iomixo.locale'
const SUPPORTED: Locale[] = ['it', 'en', 'es', 'fr']

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

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('it')

  useEffect(() => { setLocaleState(detectInitial()) }, [])

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
