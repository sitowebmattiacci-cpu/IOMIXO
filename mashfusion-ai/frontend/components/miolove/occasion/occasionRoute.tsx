import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { isLiveLang, type MioloveLang } from '@/lib/miolove/langs'
import { isPublished, type OccasionId } from '@/lib/miolove/pages'
import { getRequestPortal } from '@/lib/portalServer'
import { MioloveOccasion } from './MioloveOccasion'
import { mioloveOccasionMetadata, mioloveOccasionStructuredData, occasionFaq } from '@/lib/miolove/seo'
import { publicTexts } from '@/lib/miolove/publicTexts'
import { PublicTexts } from '../PublicTexts'

// Server side of an occasion route (app/matrimonio, app/compleanno, app/battesimo: each is two lines). One route per occasion, one public URL per language where
// its text is published (lib/miolove/pages.ts); the middleware rewrites the other languages' URLs to the route and forwards the language in x-ml-lang. Other
// portals have no such page, and neither has a language the page is not published in: 404.
const urlLang = (): MioloveLang | undefined => { const v = headers().get('x-ml-lang'); return isLiveLang(v) ? v : undefined }
const liveLang = (id: OccasionId): MioloveLang | null => { const l = urlLang() ?? 'it'; return getRequestPortal().config.id === 'miolove' && isPublished(id, l) ? l : null }

export const occasionMetadata = (id: OccasionId) => (): Metadata => { const lang = liveLang(id); return lang ? mioloveOccasionMetadata(id, lang) : {} }

export const occasionPage = (id: OccasionId) => function OccasionPage() {
  const lang = liveLang(id)
  if (!lang) notFound()
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(mioloveOccasionStructuredData(id, lang)) }} />
      <PublicTexts lang={lang} texts={publicTexts(lang)}><MioloveOccasion occasion={id} faqKeys={occasionFaq(id, lang).map((f) => f.key)} /></PublicTexts>
    </>
  )
}
