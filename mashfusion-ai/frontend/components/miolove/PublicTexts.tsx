'use client'
import { useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useI18n, type Locale } from '@/lib/i18n'
import { resolvePublicPath } from '@/lib/miolove/pages'

/**
 * Hands the provider the texts only the public MIOLOVE pages read (home, guide), delivered with the page by the server for the language the page was rendered in.
 * Safety net: if the page the router shows was rendered for a different language than its URL says (the router reusing a payload between two URLs of the same
 * route, e.g. "/en" → "/"), the page is not shown with texts it cannot resolve: it reloads, and the server renders it in the language of the URL.
 */
export function PublicTexts({ lang, texts, children }: { lang: Locale; texts: Record<string, any>; children: ReactNode }) {
  const { provide } = useI18n()
  const path = usePathname()
  const urlLang = path ? resolvePublicPath(path)?.lang : undefined
  const stale = !!urlLang && urlLang !== lang
  useEffect(() => { if (stale) window.location.replace(window.location.href) }, [stale])
  if (stale) return null
  provide?.(lang, texts)
  return <>{children}</>
}
