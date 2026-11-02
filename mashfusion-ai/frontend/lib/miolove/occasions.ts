// Structure of the occasion pages (wedding, birthday, baptism): which blocks exist and how the figures in their texts are filled in. All the TEXT lives in
// the public-page dictionary of each language, under `occasions.<id>.*` (original per occasion, never a translation of another page). Pure module: shared by the
// page component and by the structured data, so what the visitor reads and what the search engine is told cannot drift apart.
import { MEDIA_LIMITS } from '../media/mediaTypes'
import { GUEST_UPLOAD_CAP, TRIAL_MEDIA_LIMIT, formatAlbumPrice } from './plans'

export const STEP_KEYS = ['s1', 's2', 's3', 's4'] as const
export const MOMENT_KEYS = ['m1', 'm2', 'm3', 'm4'] as const
export const INCLUDE_KEYS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'] as const
/** FAQ of an occasion: 4 to 6 questions of its own, read from the dictionary (keys q1…q6; a missing one is skipped). */
export const OCCASION_FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const

/** Fills the figures a text may carry, all read from the product's configuration (never typed in a text): `{price}` = album price in the language's currency, `{trialLimit}` = photos and videos of the free trial, `{guestCap}` = anti-abuse cap per guest, `{videoMax}` / `{photoMax}` = largest video / photo in MB. */
export function occasionText(text: string, lang: string): string {
  const MB = 1024 * 1024
  return text.replace(/\{price\}/g, formatAlbumPrice(lang)).replace(/\{trialLimit\}/g, String(TRIAL_MEDIA_LIMIT))
    .replace(/\{guestCap\}/g, String(GUEST_UPLOAD_CAP)).replace(/\{videoMax\}/g, String(MEDIA_LIMITS.videoBytes / MB)).replace(/\{photoMax\}/g, String(MEDIA_LIMITS.photoOriginalBytes / MB))
}
