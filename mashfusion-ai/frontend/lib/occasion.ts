// What a MIOLOVE album is for, as the UI must see it. Pure module (no React): shared by the guest pages, the dashboard and the unit tests.
//
// Internally every MIOLOVE album is an event of type 'wedding'; that is an engine detail. Everything a person reads (eyebrows, labels, hints,
// placeholders, tab titles) is decided by `occasionType`, so a birthday never says "wedding".
import type { OccasionType } from './api'
export type { OccasionType }

export const OCCASION_TYPES: readonly OccasionType[] = ['wedding', 'birthday', 'baptism', 'other']

/** Anything that is not a known occasion is a wedding: albums created before the field existed were weddings. */
export const asOccasionType = (v: unknown): OccasionType => (OCCASION_TYPES.includes(v as OccasionType) ? (v as OccasionType) : 'wedding')

/** Translation of an occasion-dependent string, e.g. occasionText(t, 'birthday', 'namesLabel') → "Nome del festeggiato/a". */
export const occasionText = (t: (path: string) => string, occasion: unknown, key: string): string => t(`occasion.${asOccasionType(occasion)}.${key}`)

/** Small label above the name on the guest page: Matrimonio / Compleanno / Battesimo / Evento. */
export const occasionEyebrow = (t: (path: string) => string, occasion: unknown): string => t(`onboarding.eyebrow.${asOccasionType(occasion)}`)
