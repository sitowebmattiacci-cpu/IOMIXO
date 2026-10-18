'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useI18n, type Locale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export const MIOLOVE_LANGUAGES: Array<{ code: Locale; flag: string; name: string }> = [
  { code: 'it', flag: '🇮🇹', name: 'Italiano' },
  { code: 'en', flag: '🇬🇧', name: 'English' },
  { code: 'fr', flag: '🇫🇷', name: 'Français' },
  { code: 'es', flag: '🇪🇸', name: 'Español' },
]

/** MIOLOVE language menu: flag + full name (flag + code on small screens). The choice is stored by the i18n provider and survives a refresh. */
export function MioloveLanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const current = MIOLOVE_LANGUAGES.find((l) => l.code === locale) ?? MIOLOVE_LANGUAGES[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
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
          {MIOLOVE_LANGUAGES.map((l) => {
            const active = l.code === locale
            return (
              <button key={l.code} type="button" role="option" aria-selected={active} data-lang={l.code}
                onClick={() => { setLocale(l.code); setOpen(false); trigger.current?.focus() }}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/30',
                  active ? 'bg-wd-active font-semibold text-wd-pink' : 'text-wd-ink hover:bg-wd-active/60')}>
                <span aria-hidden className="text-lg leading-none">{l.flag}</span>
                <span className="flex-1">{l.name}</span>
                {active && <Check className="h-4 w-4" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
