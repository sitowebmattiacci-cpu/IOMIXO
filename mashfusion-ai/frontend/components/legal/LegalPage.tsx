'use client'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { MioloveLanguageSwitcher } from '@/components/wedding/MioloveLanguageSwitcher'
import { Logo } from '@/components/Logo'
import { MioloveLogo } from '@/components/brand/MioloveLogo'
import type { PortalConfig } from '@/lib/portal'

// Colors come from CSS variables so the shared Section / LegalMail helpers follow the portal without prop drilling.
const THEMES: Record<PortalConfig['id'], Record<string, string>> = {
  iomixo: {
    '--lg-bg': '#0A0A0D', '--lg-title': '#FFFFFF', '--lg-eyebrow': '#FF9BC8', '--lg-meta': 'rgba(255,255,255,0.4)', '--lg-lead': 'rgba(255,255,255,0.6)',
    '--lg-body': 'rgba(255,255,255,0.65)', '--lg-strong': 'rgba(255,255,255,0.85)', '--lg-link': '#FF9BC8', '--lg-link-hover': '#FFC2DE',
    '--lg-back': 'rgba(255,255,255,0.5)', '--lg-back-hover': '#FFFFFF', '--lg-border': 'rgba(255,255,255,0.06)', '--lg-foot': 'rgba(255,255,255,0.3)', '--lg-foot-hover': 'rgba(255,255,255,0.6)',
  },
  miolove: {
    '--lg-bg': '#FFF7FA', '--lg-title': '#1F2028', '--lg-eyebrow': '#E8538A', '--lg-meta': '#85858C', '--lg-lead': 'rgba(31,32,40,0.7)',
    '--lg-body': 'rgba(31,32,40,0.75)', '--lg-strong': '#1F2028', '--lg-link': '#E8538A', '--lg-link-hover': '#F06A9B',
    '--lg-back': '#85858C', '--lg-back-hover': '#1F2028', '--lg-border': '#F3D7E1', '--lg-foot': '#85858C', '--lg-foot-hover': '#1F2028',
  },
}

/** Public legal page frame (Privacy / Terms) in the look and brand of the portal the visitor is on. */
export function LegalPage({ config, title, updated, otherLink, children }: {
  config: PortalConfig
  title: string
  updated: string
  otherLink: { href: string; label: string }
  children: ReactNode
}) {
  const miolove = config.id === 'miolove'
  const { t } = useI18n()
  return (
    <div className="relative min-h-screen overflow-hidden bg-[color:var(--lg-bg)]" style={THEMES[config.id] as CSSProperties}>
      <div className="pointer-events-none select-none" aria-hidden>
        {miolove ? (
          <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-[#F06A9B]/10 blur-3xl" />
        ) : (
          <>
            <div className="bg-orb w-[600px] h-[600px] bg-purple-600 top-[-200px] left-[-200px]" />
            <div className="bg-orb w-[400px] h-[400px] bg-pink-600 bottom-[100px] right-[-150px]" />
            <div className="bg-grid absolute inset-0" />
          </>
        )}
      </div>

      <header className="relative z-20 flex items-center justify-between px-6 py-5 max-w-4xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5" aria-label={config.brand}>
          {miolove ? (
            <MioloveLogo height={36} variant="onLight" />
          ) : (
            <>
              <Logo variant="party" size={36} />
              <span className="text-lg font-black tracking-tight text-white">
                IOMIXO<span className="text-[#FF2D8D]"> Live Hub</span>
              </span>
            </>
          )}
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/" aria-label={t('legal.back')} className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-[color:var(--lg-back)] hover:text-[color:var(--lg-back-hover)] transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{t('legal.back')}</span>
          </Link>
          {miolove ? <MioloveLanguageSwitcher /> : <LanguageSwitcher />}
        </div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--lg-eyebrow)] mb-3">{t('legal.legal')}</p>
          <h1 className="text-4xl md:text-5xl font-black text-[color:var(--lg-title)] tracking-tight mb-3">{title}</h1>
          <p className="text-sm text-[color:var(--lg-meta)]">{t('legal.lastUpdated')}: {updated}</p>
        </div>

        <article className="space-y-10 text-[color:var(--lg-body)] leading-relaxed">{children}</article>

        <div className="mt-16 pt-8 border-t border-[color:var(--lg-border)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[color:var(--lg-foot)]">
          <p>© 2026 {miolove ? config.brand : 'IOMIXO'}. {t('legal.rights')}</p>
          <div className="flex gap-4">
            <Link href={otherLink.href} className="hover:text-[color:var(--lg-foot-hover)] transition-colors">{otherLink.label}</Link>
            <Link href="/" className="hover:text-[color:var(--lg-foot-hover)] transition-colors">{t('legal.home')}</Link>
          </div>
        </div>
      </main>
    </div>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-[color:var(--lg-title)] tracking-tight">{title}</h2>
      <div className="space-y-3 text-[color:var(--lg-body)] [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-[color:var(--lg-strong)] [&_strong]:font-semibold">
        {children}
      </div>
    </section>
  )
}

export function LegalMail({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className="text-[color:var(--lg-link)] hover:text-[color:var(--lg-link-hover)] underline">
      {address}
    </a>
  )
}
