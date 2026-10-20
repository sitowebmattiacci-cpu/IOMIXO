// MIOLOVE ALBUM reviews on the public home. Pure module: the rule that keeps invented testimonials out of production lives here and is unit-tested.
//
// RULE: only REAL reviews (`REAL_REVIEWS`) may ever be shown as testimonials. There are none yet, so on a production build the section is HIDDEN.
// `DEMO_REVIEWS` exist only to design / QA the layout: they render in development (or when NEXT_PUBLIC_MIOLOVE_SHOW_DEMO_REVIEWS=true on a
// preview), always under a visible "DEMO" badge, and are never counted, rated or marked up as structured data. No user numbers, no awards, no press
// logos, no Trustpilot: none of that exists.
import type { Locale } from '@/lib/i18n'

export interface Review {
  id: string
  author: string
  /** What the album was for (free text per language). */
  context: Record<Locale, string>
  text: Record<Locale, string>
  /** true = invented sample for layout QA. NEVER show as a real review. */
  placeholder: boolean
}

/** Add real, verified reviews here (with the author's consent). Empty on purpose until they exist. */
export const REAL_REVIEWS: Review[] = []

export const DEMO_REVIEWS: Review[] = [
  { id: 'demo-1', author: 'Sample name A.', placeholder: true,
    context: { it: 'Matrimonio', en: 'Wedding', fr: 'Mariage', es: 'Boda' },
    text: {
      it: 'Testo di esempio: gli invitati hanno trovato subito il QR code e le foto sono comparse sullo schermo durante la cena.',
      en: 'Sample text: guests found the QR code right away and the photos showed up on the screen during dinner.',
      fr: 'Texte d’exemple : les invités ont trouvé le QR code tout de suite et les photos sont apparues à l’écran pendant le dîner.',
      es: 'Texto de ejemplo: los invitados encontraron el QR enseguida y las fotos aparecieron en la pantalla durante la cena.' } },
  { id: 'demo-2', author: 'Sample name B.', placeholder: true,
    context: { it: 'Compleanno', en: 'Birthday', fr: 'Anniversaire', es: 'Cumpleaños' },
    text: {
      it: 'Testo di esempio: nessuno ha dovuto installare niente e a fine serata avevo tutte le foto in un unico posto.',
      en: 'Sample text: nobody had to install anything and by the end of the night I had every photo in one place.',
      fr: 'Texte d’exemple : personne n’a eu à installer quoi que ce soit et en fin de soirée toutes les photos étaient au même endroit.',
      es: 'Texto de ejemplo: nadie tuvo que instalar nada y al final de la noche tenía todas las fotos en un solo lugar.' } },
  { id: 'demo-3', author: 'Sample name C.', placeholder: true,
    context: { it: 'Battesimo', en: 'Christening', fr: 'Baptême', es: 'Bautizo' },
    text: {
      it: 'Testo di esempio: anche i nonni sono riusciti a caricare le loro foto senza chiedere aiuto.',
      en: 'Sample text: even the grandparents managed to upload their photos without asking for help.',
      fr: 'Texte d’exemple : même les grands-parents ont réussi à envoyer leurs photos sans demander d’aide.',
      es: 'Texto de ejemplo: hasta los abuelos lograron subir sus fotos sin pedir ayuda.' } },
]

export interface ReviewsEnv { production: boolean; forceDemo: boolean }
export const reviewsEnv = (): ReviewsEnv => ({ production: process.env.NODE_ENV === 'production', forceDemo: process.env.NEXT_PUBLIC_MIOLOVE_SHOW_DEMO_REVIEWS === 'true' })

/** What the home may show. Demo reviews only outside production (or when explicitly forced) and they are flagged `demo`. */
export function reviewsToShow(env: ReviewsEnv, real: Review[] = REAL_REVIEWS, demo: Review[] = DEMO_REVIEWS): { items: Review[]; demo: boolean } {
  const verified = real.filter((r) => !r.placeholder)
  if (verified.length) return { items: verified, demo: false }
  if (!env.production || env.forceDemo) return { items: demo, demo: true }
  return { items: [], demo: false }
}
