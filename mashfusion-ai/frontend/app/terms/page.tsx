import Link from 'next/link'
import { Sparkles, ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — IOMIXO',
  description: 'The terms governing your use of the IOMIXO AI music transformation service.',
}

const LAST_UPDATED = 'April 30, 2026'
const CONTACT_EMAIL = 'legal@iomixo.com'

export default function TermsPage() {
  return (
    <div className="relative min-h-screen bg-surface-400 overflow-hidden">
      <div className="pointer-events-none select-none" aria-hidden>
        <div className="bg-orb w-[600px] h-[600px] bg-purple-600 top-[-200px] left-[-200px]" />
        <div className="bg-orb w-[400px] h-[400px] bg-pink-600 bottom-[100px] right-[-150px]" />
        <div className="bg-grid absolute inset-0" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-4xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-pink-600">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-black tracking-tight text-white">
            IOMIXO<span className="text-purple-400"> AI</span>
          </span>
        </Link>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-300 mb-3">Legal</p>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">Terms of Service</h1>
          <p className="text-sm text-white/40">Last updated: {LAST_UPDATED}</p>
        </div>

        <article className="prose-invert space-y-10 text-white/70 leading-relaxed">
          <section>
            <p className="text-white/60">
              These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of IOMIXO
              (&ldquo;IOMIXO&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), an AI-powered music transformation
              service. By creating an account or using the service you agree to these Terms. If you do not
              agree, do not use the service.
            </p>
          </section>

          <Section title="1. The service">
            <p>
              IOMIXO provides software tools that use artificial intelligence to analyze, separate, transform,
              and recombine audio material that you upload. Outputs are produced on demand based on your
              inputs and the parameters you select. We do not provide a music library, master rights,
              publishing rights, or any clearance services.
            </p>
          </Section>

          <Section title="2. Eligibility and account">
            <ul>
              <li>You must be at least 16 years old (or the age of digital consent in your country) to use IOMIXO.</li>
              <li>You are responsible for keeping your credentials secure and for all activity under your account.</li>
              <li>You must provide accurate billing information and notify us of changes.</li>
            </ul>
          </Section>

          <Section title="3. Your content and your responsibility">
            <p>
              <strong>You retain ownership of audio you upload.</strong> By uploading content you grant IOMIXO
              a limited, worldwide, non-exclusive, royalty-free license to host, process, transform, and
              deliver it back to you for the sole purpose of operating the service. We do not use your audio
              to train public AI models.
            </p>
            <p className="text-white/85">
              <strong>You are solely responsible for ensuring that you hold all necessary rights, licenses,
              consents, and permissions for any audio you upload or use as a source.</strong> This includes —
              but is not limited to — copyright in the underlying composition, the sound recording, sample
              clearances, performer rights, and any rights held by record labels, publishers, or collecting
              societies. IOMIXO does not clear, license, or verify the rights status of uploaded material.
            </p>
            <p>
              You agree not to upload material that infringes third-party rights, contains illegal content,
              or violates these Terms. We may remove content and suspend or terminate accounts that we
              believe, in good faith, infringe third-party rights or violate the law.
            </p>
          </Section>

          <Section title="4. Outputs and how you may use them">
            <p>
              Subject to your compliance with these Terms, you may use AI-generated outputs for personal,
              creative, and commercial purposes <strong>provided that you have the right to do so under the
              underlying source material&apos;s licenses and applicable law</strong>. The fact that IOMIXO
              produced an output does not grant you any rights in the original sources, in third-party
              recordings, or in any composition embedded in those sources.
            </p>
            <p>
              You are responsible for any clearance, royalty, or licensing required when distributing,
              streaming, performing, or selling outputs. IOMIXO is a tool; legal responsibility for the use
              of outputs rests with you.
            </p>
          </Section>

          <Section title="5. Acceptable use">
            <p>You agree not to:</p>
            <ul>
              <li>Use the service to infringe copyright, trademark, publicity, or privacy rights.</li>
              <li>Upload malware, illegal content, hate speech, or content depicting minors in a harmful manner.</li>
              <li>Reverse engineer, scrape, or attempt to extract model weights, prompts, or proprietary internals of the service.</li>
              <li>Resell, sublicense, or expose the service as a backend to third parties without a written agreement.</li>
              <li>Circumvent usage limits, share accounts, or create accounts to evade suspension.</li>
              <li>Use the service to impersonate a real person&apos;s voice or likeness without their consent.</li>
            </ul>
          </Section>

          <Section title="6. Plans, credits, and billing">
            <ul>
              <li>Paid plans are billed monthly via Stripe. Prices are shown in USD on the pricing page.</li>
              <li>Each plan includes a monthly credit allowance for AI transformations. Unused credits do not roll over unless explicitly stated.</li>
              <li>You can cancel your subscription at any time via the Customer Portal. Cancellation takes effect at the end of the current billing period.</li>
              <li>Except where required by law, payments are non-refundable. We may, at our discretion, issue partial refunds for service incidents.</li>
              <li>VAT or other applicable taxes are added at checkout where required.</li>
            </ul>
          </Section>

          <Section title="7. Service availability">
            <p>
              We aim for high availability but do not guarantee uninterrupted service. We may perform
              maintenance, deploy updates, or experience outages. We are not liable for downtime, dropped
              jobs caused by infrastructure failures beyond our control, or third-party sub-processor
              outages, but we will make reasonable efforts to reprocess failed jobs without consuming
              additional credits.
            </p>
          </Section>

          <Section title="8. Intellectual property of IOMIXO">
            <p>
              The IOMIXO software, models, brand, UI, and documentation are owned by IOMIXO and protected by
              applicable intellectual property laws. These Terms do not grant you any ownership in IOMIXO
              itself; only a limited right to use the service per your active subscription.
            </p>
          </Section>

          <Section title="9. DMCA / takedown">
            <p>
              If you believe content processed through IOMIXO infringes your rights, send a written notice to{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-purple-300 hover:text-purple-200 underline">
                {CONTACT_EMAIL}
              </a>{' '}
              with: identification of the work, the allegedly infringing material, your contact information,
              a good-faith statement, and a statement under penalty of perjury that you are authorized to
              act. We will respond promptly and, where appropriate, remove or disable access to the
              material.
            </p>
          </Section>

          <Section title="10. Disclaimers">
            <p>
              The service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>
              without warranties of any kind, whether express or implied, including merchantability, fitness
              for a particular purpose, non-infringement, or that outputs will be free of defects or suitable
              for any specific use. AI-generated outputs may be imperfect, unexpected, or vary between runs.
            </p>
          </Section>

          <Section title="11. Limitation of liability">
            <p>
              To the maximum extent permitted by law, IOMIXO and its operators will not be liable for any
              indirect, incidental, special, consequential, or punitive damages, or for lost profits,
              revenue, data, or goodwill, arising out of or relating to your use of the service. Our total
              aggregate liability for any claim arising from these Terms or the service is limited to the
              amounts you paid to IOMIXO in the twelve (12) months preceding the event giving rise to the
              claim.
            </p>
            <p>
              Nothing in these Terms limits liability that cannot be excluded under applicable law
              (including for fraud, gross negligence, or death/personal injury caused by negligence).
            </p>
          </Section>

          <Section title="12. Indemnification">
            <p>
              You agree to indemnify and hold harmless IOMIXO, its operators, employees, and sub-processors
              from any claims, damages, losses, liabilities, and expenses (including reasonable legal fees)
              arising out of: (a) your uploaded content; (b) your use of outputs; (c) your violation of
              these Terms; or (d) your violation of any third-party rights or applicable law.
            </p>
          </Section>

          <Section title="13. Termination">
            <p>
              You may close your account at any time. We may suspend or terminate your access if you breach
              these Terms, abuse the service, or if required by law. On termination, your right to use the
              service ends. We may retain limited information as required by law (e.g., billing records).
            </p>
          </Section>

          <Section title="14. Changes to these Terms">
            <p>
              We may update these Terms from time to time. Material changes will be communicated via email
              or via a notice on the service at least 14 days before they take effect. Continued use after
              the effective date constitutes acceptance.
            </p>
          </Section>

          <Section title="15. Governing law and disputes">
            <p>
              These Terms are governed by the laws of Italy, without regard to conflict-of-law rules. The
              courts of Italy have exclusive jurisdiction over any dispute arising from these Terms or the
              service, except where mandatory consumer protection law of your country of residence grants
              you the right to bring proceedings in your local courts.
            </p>
          </Section>

          <Section title="16. Contact">
            <p>
              Questions about these Terms:{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-purple-300 hover:text-purple-200 underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </article>

        <div className="mt-16 pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/30">
          <p>© 2026 IOMIXO. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-white/60 transition-colors">Privacy Policy</Link>
            <Link href="/" className="hover:text-white/60 transition-colors">Home</Link>
          </div>
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
      <div className="space-y-3 text-white/65 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-white/85 [&_strong]:font-semibold">
        {children}
      </div>
    </section>
  )
}
