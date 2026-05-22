'use client'
import { Globe } from 'lucide-react'
import { useI18n, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'

const LABELS: Record<Locale, string> = {
  it: 'IT', en: 'EN', es: 'ES', fr: 'FR',
}

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n()
  return (
    <div className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 ${className}`}>
      <Globe className="h-3.5 w-3.5 text-white/40" />
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`text-xs font-semibold px-2 py-0.5 rounded-full transition ${
            locale === l ? 'bg-purple-500 text-white' : 'text-white/60 hover:text-white'
          }`}
          aria-pressed={locale === l}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
