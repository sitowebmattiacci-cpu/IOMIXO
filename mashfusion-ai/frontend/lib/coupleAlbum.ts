// Pure helpers of the MIOLOVE album onboarding (no React / Firebase imports: shared by the UI and the unit tests).
import type { OccasionType } from './api'
export type { OccasionType }

export const OCCASIONS: readonly OccasionType[] = ['wedding', 'birthday', 'baptism', 'other']
export const OCCASION_EMOJI: Record<OccasionType, string> = { wedding: '💍', birthday: '🎉', baptism: '🕊️', other: '✨' }

/** Where a Sposi account with no album yet is sent (and where it never stays once it has one). */
export const ONBOARDING_PATH = '/onboarding'

/** Song requests are moderated by the DJ only; a Sposi album starts with them off and the photo entry point on. */
export const COUPLE_DEFAULT_GUEST_CONFIG = { requests: false, live_booth: true } as const

/** First word of the account name ("Anna e Marco" → "Anna"); the e-mail local part when there is no name; '' when neither. */
export function firstNameOf(fullName: string | null | undefined, email?: string | null): string {
  const raw = (fullName ?? '').trim() || (email ?? '').split('@')[0].trim()
  return raw.split(/\s+/)[0] ?? ''
}

type T = (path: string, fallback?: string) => string
const fill = (s: string, name: string) => s.replace('{name}', name)

/**
 * Album name proposed for an occasion. Baptism is the child's name, never the account holder's: it returns '' so the field shows its
 * "Battesimo di [nome]" placeholder and the user has to write it.
 */
export function suggestAlbumName(occasion: OccasionType, firstName: string, t: T): string {
  if (occasion === 'baptism') return ''
  if (occasion === 'other') return t('onboarding.name.other')
  const key = `onboarding.name.${occasion}`
  return firstName ? fill(t(key), firstName) : t(`${key}NoName`)
}

/** Placeholder of the name field: the example the user sees when the field is empty. */
export function albumNamePlaceholder(occasion: OccasionType, t: T): string {
  if (occasion === 'baptism') return t('onboarding.name.baptismPlaceholder')
  if (occasion === 'other') return t('onboarding.name.other')
  return fill(t(`onboarding.name.${occasion}`), t('onboarding.exampleName'))
}
