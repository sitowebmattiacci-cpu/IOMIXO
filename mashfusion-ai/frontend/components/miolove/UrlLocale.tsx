'use client'
import { useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useMioloveI18n } from '@/lib/miolove/useMioloveLocale'
import { resolvePublicPath } from '@/lib/miolove/pages'

/**
 * Public MIOLOVE pages (home, guide) are always shown in the language of their URL: "/" is Italian even if the visitor saved another language, "/en" is
 * English, and so on. The server already renders them that way (the first HTML carries the language); this keeps it true when the page is reached by a
 * client-side navigation from a page that was in another language. It runs before the browser paints, so nothing flashes.
 */
export function UrlLocale() {
  const path = usePathname()
  const { locale, setLocale } = useMioloveI18n()
  const hit = path ? resolvePublicPath(path) : null
  const lang = hit?.lang ?? null
  useLayoutEffect(() => { if (lang && lang !== locale) setLocale(lang) }, [lang, locale]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
