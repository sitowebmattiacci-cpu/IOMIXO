import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { isLiveLang, type MioloveLang } from '@/lib/miolove/langs'
import { isPublished } from '@/lib/miolove/pages'
import { getRequestPortal } from '@/lib/portalServer'
import { MioloveOccasion } from '@/components/miolove/occasion/MioloveOccasion'
import { mioloveOccasionMetadata, mioloveOccasionStructuredData, occasionFaq } from '@/lib/miolove/seo'
import { publicTexts } from '@/lib/miolove/publicTexts'
import { PublicTexts } from '@/components/miolove/PublicTexts'

// Wedding page of MIOLOVE: one route, one public URL per language where its text is published (/matrimonio today; the middleware rewrites the others here and
// forwards the language in x-ml-lang). Other portals have no such page, and neither has a language it is not published in (404).
const urlLang = (): MioloveLang | undefined => { const v = headers().get('x-ml-lang'); return isLiveLang(v) ? v : undefined }
const live = (): MioloveLang | null => { const l = urlLang() ?? 'it'; return getRequestPortal().config.id === 'miolove' && isPublished('wedding', l) ? l : null }

export function generateMetadata(): Metadata {
  const lang = live()
  return lang ? mioloveOccasionMetadata('wedding', lang) : {}
}

export default function WeddingPage() {
  const lang = live()
  if (!lang) notFound()
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(mioloveOccasionStructuredData('wedding', lang)) }} />
      <PublicTexts lang={lang} texts={publicTexts(lang)}><MioloveOccasion occasion="wedding" faqKeys={occasionFaq('wedding', lang).map((f) => f.key)} /></PublicTexts>
    </>
  )
}
