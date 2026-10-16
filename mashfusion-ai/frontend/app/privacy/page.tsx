import type { Metadata } from 'next'
import { LegalMail, LegalPage, LegalSection as Section } from '@/components/legal/LegalPage'
import { getRequestPortal } from '@/lib/portalServer'

const LAST_UPDATED = 'April 30, 2026'
const CONTACT_EMAIL = 'privacy@iomixo.com'

export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  return config.id === 'miolove'
    ? { title: `Privacy Policy — ${config.brand}`, description: `How ${config.brand} collects, processes, and protects your data.` }
    : { title: 'Privacy Policy', description: 'How IOMIXO collects, processes, and protects your data.' }
}

export default function PrivacyPage() {
  const { config } = getRequestPortal()
  const name = config.id === 'miolove' ? config.brand : 'IOMIXO'
  return (
    <LegalPage config={config} title="Privacy Policy" updated={LAST_UPDATED} otherLink={{ href: '/terms', label: 'Terms of Service' }}>
      <section>
        <p className="text-[color:var(--lg-lead)]">
          This Privacy Policy describes how {name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, and protects
          information when you use {config.brand}, our live event interaction service. By using {name} you agree
          to the practices described here. If you do not agree, do not use the service.
        </p>
      </section>

      <Section title="1. Data we collect">
        <p>We collect the minimum data needed to operate the service:</p>
        <ul>
          <li><strong>Account data</strong> — email address, hashed password, account creation date.</li>
          <li><strong>Event content</strong> — content you and your guests submit during live events, such as messages, dedications, poll responses, game answers, and photos.</li>
          <li><strong>Billing data</strong> — handled by Stripe (we never see or store full card details). We retain plan, subscription status, customer ID, and payment history metadata.</li>
          <li><strong>Usage data</strong> — plan, login timestamps, and basic technical logs (IP address, user agent) for security and abuse prevention.</li>
        </ul>
      </Section>

      <Section title="2. How we use your data">
        <ul>
          <li>To run your live events and display the content you and your guests submit.</li>
          <li>To manage your subscription and billing.</li>
          <li>To provide customer support and respond to your requests.</li>
          <li>To detect abuse, fraud, and violations of our Terms of Service.</li>
          <li>To comply with legal obligations (tax records, lawful requests from authorities).</li>
        </ul>
        <p>We do <strong>not</strong> sell your data or use your event content for advertising.</p>
      </Section>

      <Section title="3. Storage and retention">
        <ul>
          <li><strong>Event content</strong> remains available in your account until you delete it or close your account.</li>
          <li><strong>Account and billing records</strong> are retained as long as your account is active, plus the period required by tax and accounting law (typically up to 10 years for invoices in the EU).</li>
          <li><strong>Logs</strong> are retained for up to 90 days unless required longer for security investigations.</li>
        </ul>
      </Section>

      <Section title="4. Sub-processors">
        <p>We share data only with vendors strictly required to operate the service:</p>
        <ul>
          <li><strong>Google Firebase</strong> — database, authentication, file storage, and backend functions (EU region, europe-west1).</li>
          <li><strong>Vercel</strong> — frontend hosting.</li>
          <li><strong>Stripe</strong> — payment processing. Stripe&apos;s privacy policy applies to card data.</li>
        </ul>
        <p>Each sub-processor is contractually bound to data protection terms compatible with GDPR.</p>
      </Section>

      <Section title="5. Your rights (GDPR)">
        <p>If you are in the European Economic Area you have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you.</li>
          <li>Correct inaccurate data.</li>
          <li>Request deletion of your account and associated data (subject to legal retention obligations).</li>
          <li>Export your data in a portable format.</li>
          <li>Object to processing or withdraw consent where processing is based on consent.</li>
          <li>Lodge a complaint with your local supervisory authority.</li>
        </ul>
        <p>
          To exercise any of these rights, contact us at <LegalMail address={CONTACT_EMAIL} />. We respond within 30 days.
        </p>
      </Section>

      <Section title="6. Security">
        <p>
          We use TLS encryption in transit, encrypted storage at rest, scoped database access, and row-level
          security policies to limit data access. No system is perfectly secure: if we discover a breach
          affecting your data, we will notify you and the relevant authorities as required by law.
        </p>
      </Section>

      <Section title="7. Cookies">
        <p>
          We use essential cookies for authentication and session management. We do not use third-party
          advertising cookies or cross-site tracking. Analytics, if any, are aggregated and anonymized.
        </p>
      </Section>

      <Section title="8. Children">
        <p>
          {name} is not directed to children under 16. If you become aware that a minor has provided us
          personal data without parental consent, contact us and we will delete it.
        </p>
      </Section>

      <Section title="9. Changes to this policy">
        <p>
          We may update this Privacy Policy. Material changes will be communicated via email to active
          account holders or via a notice on the service at least 14 days before they take effect.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Questions about this policy or your data: <LegalMail address={CONTACT_EMAIL} />.
        </p>
      </Section>
    </LegalPage>
  )
}
