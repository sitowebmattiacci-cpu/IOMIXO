import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalMail, LegalPage, LegalSection as Section } from '@/components/legal/LegalPage'
import { getRequestPortal } from '@/lib/portalServer'

const LAST_UPDATED = 'October 16, 2026'
const CONTACT_EMAIL = 'legal@iomixo.com'

export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  return config.id === 'miolove'
    ? { title: `Terms of Service — ${config.brand}`, description: `The terms governing your use of ${config.brand}.` }
    : { title: 'Terms of Service', description: 'The terms governing your use of the IOMIXO Live Hub interactive service.' }
}

const PrivacyLink = () => <Link href="/privacy" className="underline">Privacy Policy</Link>

function IomixoTerms() {
  return (
    <>
      <section>
        <p className="text-[color:var(--lg-lead)]">
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of IOMIXO Live Hub
          (&ldquo;IOMIXO&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), an interactive platform for live events. By creating an
          account or using the service you agree to these Terms. If you do not agree, do not use the service.
        </p>
      </section>

      <Section title="1. The service">
        <p>
          IOMIXO lets a host (for example a DJ or an event organizer) create live events in Party or Wedding mode and share
          them with guests through a QR code or link. Depending on the plan and the settings chosen by the host, guests can
          send music requests, dedications and messages, answer polls, play games and upload photos through the Live Booth,
          and the host can show content on a TV or projector with Screen Mode. Guests do not need to install an app.
        </p>
        <p>
          IOMIXO does not stream, distribute or license music. Music requests are text messages sent to the host.
        </p>
      </Section>

      <Section title="2. Eligibility and account">
        <ul>
          <li>You must be at least 16 years old (or the age of digital consent in your country) to use IOMIXO.</li>
          <li>You are responsible for keeping your credentials secure and for all activity under your account.</li>
          <li>You must provide accurate account and billing information and keep it up to date.</li>
        </ul>
      </Section>

      <Section title="3. Content and your responsibility">
        <p>
          <strong>You retain ownership of the content you submit</strong>, such as requests, dedications, answers and photos.
          By submitting content you grant IOMIXO a limited, worldwide, non-exclusive, royalty-free license to host, process and
          display it for the sole purpose of operating the service, including showing it to the participants of the event, on
          Screen Mode and in the event&apos;s photo collection.
        </p>
        <p>
          <strong>You are solely responsible for the content you submit or publish through your events</strong>, and for having
          all rights, licenses and consents needed for it. If photos show other people, you are responsible for having the
          permission and giving the notices that the law requires. Hosts are responsible for the content shared by guests
          at their events and can use the moderation tools available in the service.
        </p>
        <p>
          Any music you play at an event, and any licence or fee required to play it publicly, is your responsibility and
          is outside the service.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Submit or publish unlawful, offensive, hateful, defamatory or sexually explicit content, or content that harms minors.</li>
          <li>Infringe copyright, trademark, publicity or privacy rights of others.</li>
          <li>Upload malware or interfere with the security or operation of the service.</li>
          <li>Reverse engineer, scrape or abuse the service or its limits, or use it to send spam.</li>
          <li>Share accounts or create accounts to evade a suspension.</li>
        </ul>
        <p>
          We may remove content and suspend or close accounts that we believe, in good faith, violate these Terms or the law.
        </p>
      </Section>

      <Section title="5. Plans and billing">
        <ul>
          <li>IOMIXO offers a free plan, paid monthly plans and a one-time 24-hour Event Pass. Features depend on the plan. Prices and what each plan includes are shown on the pricing page and at checkout.</li>
          <li>Payments are processed by Stripe. We do not see or store your full card details.</li>
          <li>Where a free trial is offered, its length and conditions are shown at checkout; a trial may end without a payment method being charged.</li>
          <li>You can cancel a subscription at any time from the billing portal; cancellation takes effect at the end of the current billing period.</li>
          <li>Except where required by law, payments are non-refundable. VAT or other applicable taxes are added where required.</li>
        </ul>
      </Section>

      <Section title="6. Service availability">
        <p>
          We aim for high availability but do not guarantee uninterrupted service. The service can be affected by maintenance,
          updates, outages, network conditions at the venue and the availability of third-party providers. Do not rely on it
          as the only means to run a critical moment of your event.
        </p>
      </Section>

      <Section title="7. Intellectual property of IOMIXO">
        <p>
          The IOMIXO software, brand, interface and documentation are owned by IOMIXO and protected by applicable intellectual
          property laws. These Terms give you only a limited right to use the service according to your plan.
        </p>
      </Section>

      <Section title="8. Reporting content">
        <p>
          If you believe that content shown through IOMIXO infringes your rights or is unlawful, write to{' '}
          <LegalMail address={CONTACT_EMAIL} /> identifying the content and explaining the issue. We will review it and, where
          appropriate, remove or disable access to it.
        </p>
      </Section>

      <Section title="9. Disclaimers">
        <p>
          The service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong> without warranties of any
          kind, to the extent permitted by law, including fitness for a particular purpose and uninterrupted or error-free operation.
        </p>
      </Section>

      <Section title="10. Limitation of liability">
        <p>
          To the maximum extent permitted by law, IOMIXO will not be liable for indirect, incidental, special or consequential
          damages, or for lost profits, revenue, data or goodwill, arising from your use of the service. Our total liability for
          any claim relating to these Terms or the service is limited to the amount you paid to IOMIXO in the twelve (12) months
          before the event giving rise to the claim.
        </p>
        <p>
          Nothing in these Terms limits liability that cannot be excluded under applicable law, including for fraud, gross
          negligence, or death or personal injury caused by negligence.
        </p>
      </Section>

      <Section title="11. Indemnification">
        <p>
          To the extent permitted by law, you agree to hold IOMIXO harmless from claims, damages and expenses arising from
          content you or your guests submit through your events, from your violation of these Terms, or from your violation of
          third-party rights or applicable law.
        </p>
      </Section>

      <Section title="12. Suspension and closure">
        <p>
          You may stop using the service and ask us to close your account at any time. We may suspend or close your account if
          you breach these Terms, abuse the service, or if required by law. We may keep limited information as required by law
          (for example billing records).
        </p>
      </Section>

      <Section title="13. Privacy">
        <p>How we handle personal data is described in our <PrivacyLink />.</p>
      </Section>

      <Section title="14. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will be communicated by email or by a notice on the
          service at least 14 days before they take effect. Continued use after that date means you accept the changes.
        </p>
      </Section>

      <Section title="15. Governing law and disputes">
        <p>
          These Terms are governed by the laws of Italy, without regard to conflict-of-law rules. The courts of Italy have
          exclusive jurisdiction over disputes arising from these Terms or the service, except where mandatory consumer
          protection law of your country of residence gives you the right to bring proceedings in your local courts.
        </p>
      </Section>

      <Section title="16. Contact">
        <p>Questions about these Terms: <LegalMail address={CONTACT_EMAIL} />.</p>
      </Section>
    </>
  )
}

function MioloveTerms() {
  return (
    <>
      <section>
        <p className="text-[color:var(--lg-lead)]">
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of MIOLOVE ALBUM
          (&ldquo;MIOLOVE&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), a service that lets couples collect their wedding or event
          photos from guests in a digital album. By creating an account or using the service you agree to these Terms. If you
          do not agree, do not use the service.
        </p>
      </section>

      <Section title="1. The service">
        <p>
          A couple creates an account and an album for their wedding or event, and shares a QR code or link with the guests.
          Guests open it from their phone, without installing an app, and can upload photos through the Live Booth and, where
          enabled, send dedications or messages. The photos can be shown in a live slideshow on a TV or projector and are
          collected in the digital album of the event.
        </p>
      </Section>

      <Section title="2. Eligibility and account">
        <ul>
          <li>You must be at least 16 years old (or the age of digital consent in your country) to create an account.</li>
          <li>You are responsible for keeping your credentials secure and for all activity under your account.</li>
          <li>You must provide accurate account and billing information and keep it up to date.</li>
        </ul>
      </Section>

      <Section title="3. Albums, photos and your responsibility">
        <p>
          <strong>Whoever takes a photo keeps the rights in it.</strong> By uploading a photo or message to an album, the
          uploader grants MIOLOVE a limited, worldwide, non-exclusive, royalty-free license to host, process and display it
          for the sole purpose of operating the service: showing it in the album and in the slideshow of the event, and
          making it available to the owner of the album.
        </p>
        <p>
          <strong>You are solely responsible for the content you upload or publish, and for the album you create.</strong> The
          owner of an album is responsible for informing the guests about the collection of photos and for the permissions
          that the law requires when photos show people. Guests are responsible for the photos they upload and must hold the
          rights to them.
        </p>
        <p>
          The owner of an album can remove photos and messages from it. We may also remove content, at our reasonable
          discretion or on a justified report.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Upload or publish unlawful, offensive, hateful, defamatory or sexually explicit content, or content that harms minors.</li>
          <li>Upload images you do not have the right to use, or that violate the privacy or image rights of others.</li>
          <li>Upload malware or interfere with the security or operation of the service.</li>
          <li>Scrape or abuse the service or its limits.</li>
          <li>Share accounts or create accounts to evade a suspension.</li>
        </ul>
        <p>
          We may remove content and suspend or close accounts that we believe, in good faith, violate these Terms or the law.
        </p>
      </Section>

      <Section title="5. Free and paid plans">
        <ul>
          <li>MIOLOVE may offer a free plan, trial periods and paid plans or passes. What each one includes, its price and any trial conditions are shown in the service and at checkout.</li>
          <li>Payments are processed by Stripe. We do not see or store your full card details.</li>
          <li>You can cancel a subscription at any time from the billing page; cancellation takes effect at the end of the current billing period.</li>
          <li>Except where required by law, payments are non-refundable. VAT or other applicable taxes are added where required.</li>
        </ul>
      </Section>

      <Section title="6. Service availability">
        <p>
          We aim for high availability but do not guarantee uninterrupted service. The service can be affected by maintenance,
          updates, outages, network conditions at the venue and the availability of third-party providers. Keep your own
          copy of photos that are important to you.
        </p>
      </Section>

      <Section title="7. Deleting content and closing your account">
        <p>
          You can delete your albums and moderate their content from your account. You may ask us to close your account at any
          time. How account data and content are handled after closure is described in the <PrivacyLink />; we may keep
          limited information where the law requires it (for example billing records).
        </p>
      </Section>

      <Section title="8. Intellectual property of MIOLOVE">
        <p>
          The MIOLOVE ALBUM software, brand, interface and documentation are owned by MIOLOVE and protected by applicable
          intellectual property laws. These Terms give you only a limited right to use the service.
        </p>
      </Section>

      <Section title="9. Reporting content">
        <p>
          If you believe that a photo or message shown through MIOLOVE infringes your rights, your privacy or image rights, or
          is unlawful, write to <LegalMail address={CONTACT_EMAIL} /> identifying the content and explaining the issue. We will
          review it and, where appropriate, remove or disable access to it.
        </p>
      </Section>

      <Section title="10. Disclaimers">
        <p>
          The service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong> without warranties of any
          kind, to the extent permitted by law, including fitness for a particular purpose and uninterrupted or error-free operation.
        </p>
      </Section>

      <Section title="11. Limitation of liability">
        <p>
          To the maximum extent permitted by law, MIOLOVE will not be liable for indirect, incidental, special or consequential
          damages, or for lost profits, revenue, data or goodwill, arising from your use of the service. Our total liability for
          any claim relating to these Terms or the service is limited to the amount you paid to MIOLOVE in the twelve (12) months
          before the event giving rise to the claim.
        </p>
        <p>
          Nothing in these Terms limits liability that cannot be excluded under applicable law, including for fraud, gross
          negligence, or death or personal injury caused by negligence.
        </p>
      </Section>

      <Section title="12. Suspension and termination">
        <p>
          We may suspend or close your account if you breach these Terms, abuse the service, or if required by law. We may keep
          limited information as required by law.
        </p>
      </Section>

      <Section title="13. Privacy">
        <p>How we handle personal data, including guests&apos; photos, is described in our <PrivacyLink />.</p>
      </Section>

      <Section title="14. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will be communicated by email or by a notice on the
          service at least 14 days before they take effect. Continued use after that date means you accept the changes.
        </p>
      </Section>

      <Section title="15. Governing law and disputes">
        <p>
          These Terms are governed by the laws of Italy, without regard to conflict-of-law rules. The courts of Italy have
          exclusive jurisdiction over disputes arising from these Terms or the service, except where mandatory consumer
          protection law of your country of residence gives you the right to bring proceedings in your local courts.
        </p>
      </Section>

      <Section title="16. Contact">
        <p>Questions about these Terms: <LegalMail address={CONTACT_EMAIL} />.</p>
      </Section>
    </>
  )
}

export default function TermsPage() {
  const { config } = getRequestPortal()
  return (
    <LegalPage config={config} title="Terms of Service" updated={LAST_UPDATED} otherLink={{ href: '/privacy', label: 'Privacy Policy' }}>
      {config.id === 'miolove' ? <MioloveTerms /> : <IomixoTerms />}
    </LegalPage>
  )
}
