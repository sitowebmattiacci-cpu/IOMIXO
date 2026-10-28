import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { isLiveLang, type MioloveLang } from '@/lib/miolove/langs'
import { getRequestPortal } from '@/lib/portalServer'
import { IomixoLanding } from '@/components/portal/IomixoLanding'
import { MioloveHome } from '@/components/miolove/home/MioloveHome'
import { mioloveHomeMetadata, mioloveStructuredData } from '@/lib/miolove/seo'
import { publicTexts } from '@/lib/miolove/publicTexts'
import { PublicTexts } from '@/components/miolove/PublicTexts'

// "/" belongs to the portal of the request host: MIOLOVE gets its own public home, every other host (IOMIXO, localhost, previews) keeps the IOMIXO landing.
// The home is rendered in the language of its URL: / (Italian), /en, /fr, /es (middleware rewrites them to "/" and forwards the language in x-ml-lang);
// without one the visitor's saved or browser language applies exactly as everywhere else.
const urlLang = (): MioloveLang | undefined => { const v = headers().get('x-ml-lang'); return isLiveLang(v) ? v : undefined }

export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  // IOMIXO: nothing here, the root layout metadata applies unchanged.
  return config.id === 'miolove' ? mioloveHomeMetadata(urlLang()) : {}
}

export default function HomePage() {
  const { config } = getRequestPortal()
  if (config.id !== 'miolove') return <IomixoLanding />
  const lang = urlLang() ?? 'it'
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(mioloveStructuredData(lang)) }} />
      <PublicTexts lang={lang} texts={publicTexts(lang)}><MioloveHome /></PublicTexts>
    </>
  )
}
