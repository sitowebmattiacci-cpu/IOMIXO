'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useI18n } from '@/lib/i18n'
import type { PortalConfig } from '@/lib/portal'
import { PRIVACY } from '@/lib/legal/privacy'
import { TERMS } from '@/lib/legal/terms'
import { LEGAL_DATE, legalEmail, type LegalVars } from '@/lib/legal/types'
import { LegalMail, LegalPage, LegalSection } from './LegalPage'

/** **bold**, {{mail}}, {{privacy:link text}} → React nodes. */
function inline(text: string, email: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\{\{mail\}\}|\{\{privacy:[^}]+\}\})/).filter(Boolean).map((part, i) => {
    if (part === '{{mail}}') return <LegalMail key={i} address={email} />
    if (part.startsWith('{{privacy:')) return <Link key={i} href="/privacy" className="underline">{part.slice(10, -2)}</Link>
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    return part
  })
}

/** Privacy Policy / Terms of Service in the visitor's language, branded for the portal they are on. */
export function LegalDocument({ kind, config }: { kind: 'privacy' | 'terms'; config: PortalConfig }) {
  const { locale, t } = useI18n()
  const miolove = config.id === 'miolove'
  const vars: LegalVars = { miolove, brand: config.brand, name: miolove ? config.brand : 'IOMIXO', short: miolove ? 'MIOLOVE' : 'IOMIXO' }
  const doc = (kind === 'privacy' ? PRIVACY : TERMS)[locale](vars)
  const email = legalEmail(kind, miolove)
  const other = kind === 'privacy' ? { href: '/terms', label: t('legal.termsTitle') } : { href: '/privacy', label: t('legal.privacyTitle') }
  return (
    <LegalPage config={config} title={t(kind === 'privacy' ? 'legal.privacyTitle' : 'legal.termsTitle')} updated={LEGAL_DATE[locale]} otherLink={other}>
      <section><p className="text-[color:var(--lg-lead)]">{inline(doc.lead, email)}</p></section>
      {doc.sections.map((s) => (
        <LegalSection key={s.title} title={s.title}>
          {s.blocks.map((b, i) => 'ul' in b
            ? <ul key={i}>{b.ul.map((li, j) => <li key={j}>{inline(li, email)}</li>)}</ul>
            : <p key={i}>{inline(b.p, email)}</p>)}
        </LegalSection>
      ))}
    </LegalPage>
  )
}
