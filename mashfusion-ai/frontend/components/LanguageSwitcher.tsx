'use client'
import { Globe } from 'lucide-react'
import { useI18n, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'

const LABELS: Record<Locale, string> = {
  it: 'IT', en: 'EN', es: 'ES', fr: 'FR',
}

export function LanguageSwitcher({
  className = '',
  variant = 'dark',
}: {
  className?: string
  variant?: 'dark' | 'light'
}) {
  const { locale, setLocale } = useI18n()
  const isLight = variant === 'light'
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
        isLight ? 'border-black/10 bg-black/5' : 'border-white/10 bg-white/5'
      } ${className}`}
    >
      <Globe className={`h-3.5 w-3.5 ${isLight ? 'text-black/40' : 'text-white/40'}`} />
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`text-xs font-semibold px-2 py-0.5 rounded-full transition ${
            locale === l
              ? isLight
                ? 'bg-wedding-gold text-white'
                : 'bg-purple-500 text-white'
              : isLight
                ? 'text-black/50 hover:text-black'
                : 'text-white/60 hover:text-white'
          }`}
          aria-pressed={locale === l}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
