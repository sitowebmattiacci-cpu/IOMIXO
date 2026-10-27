'use client'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import it from '@/locales/it.json'
import en from '@/locales/en.json'
import es from '@/locales/es.json'
import fr from '@/locales/fr.json'
// MIOLOVE-only strings live in their own files (locales/miolove/*): these files hold the CORE texts (everything but home / guide / service-page titles, which live in a separate file per language and are delivered by the server).
import { type Locale, LOCALES } from '@/lib/locales'
import { LANG_COOKIE } from '@/lib/miolove/langCookie'
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
const LOCALE_STORAGE_KEY = 'iomixo.locale'
const SUPPORTED: Locale[] = LOCALES

interface I18nCtx {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (path: string, fallback?: string) => string
  /** MIOLOVE public pages: hands the provider the texts only they read (home, guide) for the language they were rendered in. Nothing else calls it. */
  provide?: (locale: Locale, texts: Record<string, any>) => void
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

/**
 * `initialLocale`: an explicit language chosen by the URL (?lang=) wins over the stored / browser one; without it nothing changes.
 * MIOLOVE only (the layout passes them, IOMIXO never does, so for IOMIXO this provider behaves exactly as it always did):
 *  • `ssrLocale`: the language the server rendered when nothing was chosen explicitly (the browser's, from Accept-Language), so the first HTML is not Italian
 *    for a visitor who reads another language; a saved language that differs still wins after hydration, as before.
 *  • `rememberInCookie`: also keep the chosen language in a cookie, so the server can render the next request in it from the first byte.
 */
export function I18nProvider({ children, initialLocale, ssrLocale, rememberInCookie }: { children: ReactNode; initialLocale?: Locale; ssrLocale?: Locale; rememberInCookie?: boolean }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? ssrLocale ?? 'it')
  const remember = (l: Locale) => {
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, l) } catch { /* private mode */ }
    if (rememberInCookie) { try { document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax` } catch { /* cookies blocked */ } }
  }

  useEffect(() => {
    if (!initialLocale) { setLocaleState(detectInitial()); return }
    // A language chosen by the URL is remembered too, so the pages the visitor opens next stay in it.
    remember(initialLocale)
  }, [initialLocale])      // eslint-disable-line react-hooks/exhaustive-deps

  const setLocale = (l: Locale) => {
    setLocaleState(l)
    if (typeof window !== 'undefined') { if (rememberInCookie) remember(l); else window.localStorage.setItem(LOCALE_STORAGE_KEY, l) }
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

  return <Ctx.Provider value={{ locale, setLocale, t, provide }}>{children}</Ctx.Provider>
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
