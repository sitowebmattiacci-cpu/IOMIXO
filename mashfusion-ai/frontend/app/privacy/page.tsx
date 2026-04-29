import Link from 'next/link'
import { Sparkles, ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — IOMIXO',
  description: 'How IOMIXO collects, processes, and protects your data.',
}

const LAST_UPDATED = 'April 30, 2026'
const CONTACT_EMAIL = 'privacy@iomixo.com'

export default function PrivacyPage() {
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
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">Privacy Policy</h1>
          <p className="text-sm text-white/40">Last updated: {LAST_UPDATED}</p>
        </div>

        <article className="prose-invert space-y-10 text-white/70 leading-relaxed">
          <section>
            <p className="text-white/60">
              This Privacy Policy describes how IOMIXO (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, and protects
              information when you use our AI music transformation services. By using IOMIXO you agree to the
              practices described here. If you do not agree, do not use the service.
            </p>
          </section>

          <Section title="1. Data we collect">
            <p>We collect the minimum data needed to operate the service:</p>
            <ul>
              <li><strong>Account data</strong> — email address, hashed password, account creation date.</li>
              <li><strong>Uploaded audio</strong> — files you upload as source material for AI transformations.</li>
              <li><strong>Generated outputs</strong> — files produced by our AI engine from your sources.</li>
              <li><strong>Billing data</strong> — handled by Stripe (we never see or store full card details). We retain plan, subscription status, customer ID, and payment history metadata.</li>
              <li><strong>Usage data</strong> — number of transformations, plan, login timestamps, basic technical logs (IP address, user agent) for security and abuse prevention.</li>
            </ul>
          </Section>

          <Section title="2. How we use your data">
            <ul>
              <li>To run AI analysis and produce transformed audio outputs you request.</li>
              <li>To manage your subscription, credits, and billing.</li>
              <li>To provide customer support and respond to your requests.</li>
              <li>To detect abuse, fraud, and violations of our Terms of Service.</li>
              <li>To comply with legal obligations (tax records, lawful requests from authorities).</li>
            </ul>
            <p>We do <strong>not</strong> use your uploaded audio or generated outputs to train public AI models.</p>
          </Section>

          <Section title="3. Storage and retention">
            <ul>
              <li><strong>Source uploads</strong> are processed for the requested transformation and automatically deleted from active storage within a short window after processing completes (typically 24-72 hours).</li>
              <li><strong>Generated outputs</strong> remain available in your account until you delete them or close your account.</li>
              <li><strong>Account and billing records</strong> are retained as long as your account is active, plus the period required by tax and accounting law (typically up to 10 years for invoices in the EU).</li>
              <li><strong>Logs</strong> are retained for up to 90 days unless required longer for security investigations.</li>
            </ul>
          </Section>

          <Section title="4. Sub-processors">
            <p>We share data only with vendors strictly required to operate the service:</p>
            <ul>
              <li><strong>Supabase</strong> — database and authentication (EU region).</li>
              <li><strong>Google Cloud (Cloud Run, Cloud Storage)</strong> — backend hosting and audio file storage.</li>
              <li><strong>Stripe</strong> — payment processing. Stripe&apos;s privacy policy applies to card data.</li>
              <li><strong>Vercel</strong> — frontend hosting.</li>
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
              To exercise any of these rights, contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-purple-300 hover:text-purple-200 underline">
                {CONTACT_EMAIL}
              </a>
              . We respond within 30 days.
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
              IOMIXO is not directed to children under 16. If you become aware that a minor has provided us
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
              Questions about this policy or your data:{' '}
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
            <Link href="/terms" className="hover:text-white/60 transition-colors">Terms of Service</Link>
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
