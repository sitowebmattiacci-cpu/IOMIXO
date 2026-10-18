import type { Metadata } from 'next'
import { LegalDocument } from '@/components/legal/LegalDocument'
import { getRequestPortal } from '@/lib/portalServer'

export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  return config.id === 'miolove'
    ? { title: `Terms of Service — ${config.brand}`, description: `The terms governing your use of ${config.brand}.` }
    : { title: 'Terms of Service', description: 'The terms governing your use of the IOMIXO Live Hub interactive service.' }
}

export default function TermsPage() {
  const { config } = getRequestPortal()
  return <LegalDocument kind="terms" config={config} />
}
