import type { Metadata } from 'next'
import { LegalDocument } from '@/components/legal/LegalDocument'
import { getRequestPortal } from '@/lib/portalServer'

export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  return config.id === 'miolove'
    ? { title: `Privacy Policy — ${config.brand}`, description: `How ${config.brand} collects, processes, and protects your data.` }
    : { title: 'Privacy Policy', description: 'How IOMIXO collects, processes, and protects your data.' }
}

export default function PrivacyPage() {
  const { config } = getRequestPortal()
  return <LegalDocument kind="privacy" config={config} />
}
