// Supported UI languages. Pure module (no 'use client'): server components (layout, pages, metadata) can import it, unlike lib/i18n.tsx.
export type Locale = 'it' | 'en' | 'es' | 'fr'
export const LOCALES: Locale[] = ['it', 'en', 'es', 'fr']
export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as string[]).includes(v)
