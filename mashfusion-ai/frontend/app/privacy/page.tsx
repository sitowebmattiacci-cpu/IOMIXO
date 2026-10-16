import type { Metadata } from 'next'
import { LegalMail, LegalPage, LegalSection as Section } from '@/components/legal/LegalPage'
import { getRequestPortal } from '@/lib/portalServer'

const LAST_UPDATED = 'October 16, 2026'
const CONTACT_EMAIL = 'privacy@iomixo.com'

export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  return config.id === 'miolove'
    ? { title: `Privacy Policy — ${config.brand}`, description: `How ${config.brand} collects, processes, and protects your data.` }
    : { title: 'Privacy Policy', description: 'How IOMIXO collects, processes, and protects your data.' }
}

export default function PrivacyPage() {
  const { config } = getRequestPortal()
  const miolove = config.id === 'miolove'
  const name = miolove ? config.brand : 'IOMIXO'
  const service = miolove ? 'digital wedding and event photo album service' : 'live event interaction service'
  const eventContent = miolove
    ? 'photos that guests upload through the Live Booth, and any dedications or messages they send'
    : 'content you and your guests submit during live events, such as music requests, dedications, poll responses, game answers, and photos'
  return (
    <LegalPage config={config} title="Privacy Policy" updated={LAST_UPDATED} otherLink={{ href: '/terms', label: 'Terms of Service' }}>
      <section>
        <p className="text-[color:var(--lg-lead)]">
          This Privacy Policy describes how {name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, and protects
          information when you use {config.brand}, our {service}. By using {name} you agree
          to the practices described here. If you do not agree, do not use the service.
        </p>
      </section>

      <Section title="1. Data we collect">
        <p>We collect the data needed to operate the service:</p>
        <ul>
          <li><strong>Account data</strong> — email address, the name you provide, and account creation data. Sign-in is handled by Firebase Authentication; we do not see or store your password.</li>
          <li><strong>{miolove ? 'Album content' : 'Event content'}</strong> — {eventContent}.</li>
          <li><strong>Guest participation</strong> — guests join through a QR code or link without creating an account; they are signed in anonymously with a random identifier, plus any name or text they choose to enter.</li>
          <li><strong>Billing data</strong> — handled by Stripe (we never see or store full card details). We retain plan, subscription status, customer ID, and payment history metadata.</li>
          <li><strong>Technical data</strong> — IP address, user agent, and security signals from App Check and reCAPTCHA Enterprise, used to keep the service working and to prevent abuse.</li>
        </ul>
      </Section>

      <Section title="2. How we use your data">
        <ul>
          <li>{miolove ? 'To run your albums and display the photos and messages guests submit.' : 'To run your live events and display the content you and your guests submit.'}</li>
          <li>To manage your subscription and billing.</li>
          <li>To provide customer support and respond to your requests.</li>
          <li>To detect abuse, fraud, and violations of our Terms of Service.</li>
          <li>To comply with legal obligations (tax records, lawful requests from authorities).</li>
        </ul>
        <p>We do <strong>not</strong> sell your data or use {miolove ? 'your photos' : 'your event content'} for advertising.</p>
      </Section>

      <Section title="3. Storage and retention">
        <ul>
          <li><strong>{miolove ? 'Album content' : 'Event content'}</strong> remains available in your account until you delete it or your account is closed.</li>
          <li><strong>Account and billing records</strong> are retained as long as your account is active, plus the period required by tax and accounting law.</li>
          <li><strong>Technical logs</strong> are retained only as long as needed for security, operation and abuse prevention.</li>
        </ul>
      </Section>

      <Section title="4. Service providers">
        <p>We share data only with providers needed to operate the service:</p>
        <ul>
          <li><strong>Google Firebase / Google Cloud</strong> — Firebase Authentication, Cloud Firestore (database), Firebase Storage (files and photos), Cloud Functions (backend) and Firebase App Hosting (web hosting). Our Cloud Functions run in europe-west1 and our web hosting in europe-west4.</li>
          <li><strong>Google App Check and reCAPTCHA Enterprise</strong> — protection against abuse and fraud.</li>
          <li><strong>Stripe</strong> — payment processing. Stripe&apos;s privacy policy applies to card data.</li>
        </ul>
        <p>Each provider acts under data protection terms compatible with GDPR.</p>
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
          We use TLS encryption in transit and access rules on our database and storage that limit who can read or change data.
          No system is perfectly secure: if we discover a breach affecting your data, we will notify you and the relevant
          authorities as required by law.
        </p>
      </Section>

      <Section title="7. Cookies and local storage">
        <p>
          We use only what is needed for the service to work: your sign-in session and your language and interface
          preferences{miolove ? '' : ', and a note on your device that you already voted in a poll'}. Google reCAPTCHA
          Enterprise may use cookies or similar technologies for security. We do not use advertising cookies or analytics trackers.
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
