import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { isLocale, type Locale } from '@/lib/locales'
import { getRequestPortal } from '@/lib/portalServer'
import { MioloveIdeas } from '@/components/miolove/ideas/MioloveIdeas'
import { mioloveIdeasMetadata, mioloveIdeasStructuredData } from '@/lib/miolove/seo'

// "Idee per usare MIOLOVE": the public guide of MIOLOVE. One route, four public URLs (/idee, /en/ideas, /fr/idees, /es/ideas: the middleware rewrites the
// last three here and forwards the language in x-ml-lang, exactly like the home). Other portals have no such page.
const urlLang = (): Locale | undefined => { const v = headers().get('x-ml-lang'); return isLocale(v) ? v : undefined }

export function generateMetadata(): Metadata {
  return getRequestPortal().config.id === 'miolove' ? mioloveIdeasMetadata(urlLang()) : {}
}

export default function IdeasPage() {
  if (getRequestPortal().config.id !== 'miolove') notFound()
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(mioloveIdeasStructuredData(urlLang() ?? 'it')) }} />
      <MioloveIdeas />
    </>
  )
}
