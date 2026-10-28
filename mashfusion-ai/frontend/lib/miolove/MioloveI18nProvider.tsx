'use client'
// MIOLOVE's translation provider, over the same context as IOMIXO's (lib/i18nContext.tsx): every component that calls `useI18n()` keeps working unchanged.
// Differences from IOMIXO's provider:
//   • its language is a `MioloveLocale` (twelve), not the shared four;
//   • the texts of the active language arrive from the SERVER with the first HTML (`messages`), so a language the browser bundle does not hold can be shown;
//   • the chosen language is also kept in a cookie, so the server renders the next request in it from the first byte.
// The bundled tables of the four published languages stay as a fallback while components migrate; a language that is not bundled never falls back to them.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { I18nContext, pick } from '@/lib/i18nContext'
import { bundledText, detectInitial, LOCALE_STORAGE_KEY } from '@/lib/i18n'
import { LANG_COOKIE } from './langCookie'
import { DEFAULT_LANG } from './langs'
import { isSharedLocale, type MioloveLocale } from './locale'

/** The MIOLOVE core texts of one language, as the server read them. */
export interface ServerMessages { locale: MioloveLocale; texts: Record<string, any> }

/** Pure lookup order of a text, shared by the provider and by the tests: server texts → bundled → page-delivered → the same for Italian → fallback / key. */
export function resolveText(
  locale: MioloveLocale, path: string, fallback: string | undefined,
  server: ServerMessages | undefined, delivered: ReadonlyMap<MioloveLocale, Record<string, any>>,
): string {
  const lookups: Array<() => unknown> = [
    () => (server?.locale === locale ? pick(server.texts, path) : undefined),
    () => bundledText(locale, path),
    () => pick(delivered.get(locale), path),
    () => (server?.locale === DEFAULT_LANG ? pick(server.texts, path) : undefined),
    () => bundledText(DEFAULT_LANG, path),
    () => pick(delivered.get(DEFAULT_LANG), path),
  ]
  for (const look of lookups) { const v = look(); if (typeof v === 'string') return v }
  return fallback ?? path
}

export function MioloveI18nProvider({ children, initialLocale, ssrLocale, messages }: {
  children: ReactNode
  /** A language chosen explicitly (URL or cookie). */
  initialLocale?: MioloveLocale
  /** What the server rendered when nothing was chosen (the browser's language). */
  ssrLocale?: MioloveLocale
  messages?: ServerMessages
}) {
  const router = useRouter()
  const [locale, setLocaleState] = useState<MioloveLocale>(initialLocale ?? ssrLocale ?? DEFAULT_LANG)
  const remember = (l: MioloveLocale) => {
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, l) } catch { /* private mode */ }
    try { document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax` } catch { /* cookies blocked */ }
  }

  useEffect(() => {
    if (!initialLocale) { setLocaleState(detectInitial()); return }
    remember(initialLocale)       // a language chosen by the URL is remembered too
  }, [initialLocale])      // eslint-disable-line react-hooks/exhaustive-deps

  const setLocale = (l: MioloveLocale) => {
    setLocaleState(l)
    if (typeof window === 'undefined') return
    remember(l)
    // A language the browser bundle does not hold can only be shown with the texts of the server: ask for the page again, now that the cookie says so.
    if (!isSharedLocale(l) && messages?.locale !== l) router.refresh()
  }

  const delivered = useRef<Map<MioloveLocale, Record<string, any>>>(new Map())
  const provide = (l: MioloveLocale, texts: Record<string, any>) => { delivered.current.set(l, texts) }
  const t = (path: string, fallback?: string) => resolveText(locale, path, fallback, messages, delivered.current)

  return <I18nContext.Provider value={{ locale, setLocale, t, provide }}>{children}</I18nContext.Provider>
}
