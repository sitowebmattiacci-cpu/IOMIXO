'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Check, ChevronDown } from 'lucide-react'
import { useI18n, type Locale } from '@/lib/i18n'
import { isLocale } from '@/lib/locales'
import { LIVE_LANGS, type MioloveLang } from '@/lib/miolove/langs'
import { resolvePublicPath, switchOptions } from '@/lib/miolove/pages'
import { cn } from '@/lib/utils'

/** Name and flag of every language the menu may ever show; which ones it shows comes from the registry (published languages only, never a draft). */
const LABEL: Record<MioloveLang, { flag: string; name: string }> = {
  it: { flag: '🇮🇹', name: 'Italiano' }, en: { flag: '🇬🇧', name: 'English' }, fr: { flag: '🇫🇷', name: 'Français' }, es: { flag: '🇪🇸', name: 'Español' },
  de: { flag: '🇩🇪', name: 'Deutsch' }, 'pt-BR': { flag: '🇧🇷', name: 'Português (Brasil)' }, 'pt-PT': { flag: '🇵🇹', name: 'Português (Portugal)' },
  nl: { flag: '🇳🇱', name: 'Nederlands' }, pl: { flag: '🇵🇱', name: 'Polski' }, el: { flag: '🇬🇷', name: 'Ελληνικά' }, ja: { flag: '🇯🇵', name: '日本語' }, ko: { flag: '🇰🇷', name: '한국어' },
}

/** Languages of the app (login, dashboard, guest pages…): the published ones whose texts the i18n provider holds. */
export const MIOLOVE_LANGUAGES: Array<{ code: Locale; flag: string; name: string }> =
  LIVE_LANGS.filter((l): l is Locale => isLocale(l)).map((l) => ({ code: l, ...LABEL[l] }))

/**
 * MIOLOVE language menu: flag + full name (flag + code on small screens).
 *  • On a public SEO page (home, guide) every entry is a link to the URL of that language — the same page when it exists there, otherwise the home of that
 *    language (lib/miolove/pages.ts switchOptions) — and the page is reloaded so the server renders it in the language of its URL. Nothing is stored here:
 *    the page that opens remembers its own language.
 *  • Everywhere else (sign-in, dashboard, privacy / terms, onboarding) the choice is stored by the i18n provider and survives a refresh, as before.
 */
export function MioloveLanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n()
  const path = usePathname()
  const seoPage = path ? resolvePublicPath(path) : null
  const options = seoPage
    ? switchOptions(seoPage.page).map((o) => ({ code: o.lang, ...LABEL[o.lang], href: o.path }))
    : MIOLOVE_LANGUAGES.map((l) => ({ ...l, href: null as string | null }))
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const shown = seoPage ? seoPage.lang : locale
  const current = options.find((l) => l.code === shown) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  return (
    <div ref={root} className={cn('relative', className)} data-testid="miolove-lang">
      <button
        ref={trigger} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label="Language"
        data-testid="miolove-lang-trigger"
        className="inline-flex items-center gap-2 rounded-full border border-wd-border bg-white px-3 py-1.5 text-sm font-semibold text-wd-ink transition hover:bg-wd-active/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/30"
      >
        <span aria-hidden className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{current.name}</span>
        <span className="sm:hidden">{current.code.toUpperCase()}</span>
        <ChevronDown className={cn('h-4 w-4 text-wd-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="listbox" aria-label="Language" onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-[60] mt-2 min-w-[190px] overflow-hidden rounded-2xl border border-wd-pink/20 bg-white p-1.5 shadow-[0_10px_30px_rgba(240,106,155,0.14)]">
          {options.map((l) => {
            const active = l.code === shown
            const cls = cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/30',
              active ? 'bg-wd-active font-semibold text-wd-pink' : 'text-wd-ink hover:bg-wd-active/60')
            const inner = (<>
              <span aria-hidden className="text-lg leading-none">{l.flag}</span>
              <span className="flex-1">{l.name}</span>
              {active && <Check className="h-4 w-4" />}
            </>)
            return l.href !== null
              ? <a key={l.code} role="option" aria-selected={active} data-lang={l.code} href={l.href} hrefLang={l.code} className={cls}>{inner}</a>
              : <button key={l.code} type="button" role="option" aria-selected={active} data-lang={l.code}
                  onClick={() => { setLocale(l.code as Locale); setOpen(false); trigger.current?.focus() }} className={cls}>{inner}</button>
          })}
        </div>
      )}
    </div>
  )
}
