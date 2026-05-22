'use client'
import type { ReactNode, ButtonHTMLAttributes } from 'react'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Wedding Edition design system
// Warm · elegant · romantic · premium. NOT a dashboard.
// Palette: ivory bg · white cards · champagne borders · gold accents
// ════════════════════════════════════════════════════════════════

export function WeddingShell({
  children,
  className = '',
  variant = 'light',
}: {
  children: ReactNode
  className?: string
  variant?: 'light' | 'stage'
}) {
  if (variant === 'stage') {
    return (
      <div
        className={`min-h-screen w-full bg-gradient-to-br from-wedding-night via-[#1a1f2e] to-wedding-night text-wedding-ivory font-sans antialiased ${className}`}
      >
        {children}
      </div>
    )
  }
  return (
    <div
      className={`min-h-screen w-full font-sans antialiased ${className}`}
      style={{ background: '#FFFDFB', color: '#2B2424' }}
    >
      {children}
    </div>
  )
}

export function WeddingSection({
  title,
  subtitle,
  eyebrow,
  children,
  className = '',
  center = false,
}: {
  title?: string
  subtitle?: string
  eyebrow?: string
  children?: ReactNode
  className?: string
  center?: boolean
}) {
  return (
    <section className={`${center ? 'text-center' : ''} ${className}`}>
      {(eyebrow || title || subtitle) && (
        <header className="mb-8">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-wedding-gold mb-3">
              {eyebrow}
            </p>
          )}
          {title && (
            <h2 className="font-wedding text-3xl sm:text-4xl text-wedding-ink leading-tight tracking-wide">
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="mt-3 text-sm text-wedding-muted max-w-xl mx-auto">{subtitle}</p>
          )}
          <div className={`mt-5 h-px bg-gradient-to-r from-transparent via-wedding-gold/50 to-transparent ${center ? 'max-w-xs mx-auto' : 'max-w-[180px]'}`} />
        </header>
      )}
      {children}
    </section>
  )
}

export function WeddingCard({
  children,
  className = '',
  tone = 'ivory',
}: {
  children: ReactNode
  className?: string
  tone?: 'ivory' | 'cream' | 'night' | 'active'
}) {
  const tones: Record<string, string> = {
    ivory:
      'bg-[#F7F4F3] border-[#E7D8D2] text-[#2B2424] shadow-wedding hover:shadow-wedding-lg hover:-translate-y-0.5',
    cream:
      'bg-[#FBEAF0] border-[#E8B7C8] text-[#2B2424] shadow-wedding hover:shadow-wedding-lg hover:-translate-y-0.5',
    active:
      'bg-[#F3DCE3] border-[#E8B7C8] text-[#2B2424] shadow-lg hover:shadow-xl hover:-translate-y-0.5',
    night:
      'bg-wedding-night/90 border-wedding-gold/30 text-wedding-ivory shadow-wedding-lg',
  }
  return (
    <div
      className={`relative rounded-[18px] border p-5 transition-all duration-150 ease-out ${tones[tone]} ${className}`}
    >
      {children}
    </div>
  )
}

interface WeddingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'gold' | 'outline' | 'ghost' | 'night'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export function WeddingButton({
  children,
  variant = 'gold',
  size = 'md',
  loading = false,
  icon,
  className = '',
  disabled,
  ...rest
}: WeddingButtonProps) {
  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-2.5 text-sm',
  }
  const variants: Record<string, string> = {
    gold:
      'bg-gradient-to-br from-[#8F1D2C] to-[#A32335] text-white shadow-wedding hover:shadow-lg hover:scale-[1.03] active:scale-[0.98]',
    outline:
      'bg-[#FBEAF0] text-[#8F1D2C] border border-[#E8B7C8] hover:bg-[#E8B7C8]/50 hover:scale-[1.03] active:scale-[0.98]',
    ghost:
      'text-[#6F6260] hover:text-[#2B2424] hover:bg-[#FBEAF0] hover:scale-[1.03] active:scale-[0.98]',
    night:
      'bg-wedding-night text-wedding-ivory hover:bg-wedding-night/90 border border-wedding-gold/40',
  }
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-[0.05em] transition-all duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  )
}

export function WeddingBadge({
  children,
  tone = 'gold',
  className = '',
}: {
  children: ReactNode
  tone?: 'gold' | 'sage' | 'blush' | 'taupe' | 'ink'
  className?: string
}) {
  const tones: Record<string, string> = {
    gold:  'bg-[#FBEAF0] text-[#8F1D2C] border-[#E8B7C8]',
    sage:  'bg-[#FBEAF0] text-[#8F1D2C] border-[#E8B7C8]',
    blush: 'bg-[#FBEAF0] text-[#8F1D2C] border-[#E8B7C8]',
    taupe: 'bg-[#E8DED6] text-[#6F6260] border-[#B8A89A]/40',
    ink:   'bg-[#2B2424]/10 text-[#2B2424] border-[#2B2424]/20',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function WeddingDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 my-6 ${className}`}>
      <span className="flex-1 h-px bg-gradient-to-r from-transparent to-wedding-gold/40" />
      <span className="text-wedding-gold text-lg">✦</span>
      <span className="flex-1 h-px bg-gradient-to-l from-transparent to-wedding-gold/40" />
    </div>
  )
}

export function WeddingInput({
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`w-full rounded-xl border border-[#E8B7C8] bg-white px-4 py-3 text-sm text-[#2B2424] placeholder:text-[#6F6260]/60 focus:outline-none focus:border-[#8F1D2C] focus:ring-2 focus:ring-[#8F1D2C]/20 transition ${className}`}
    />
  )
}

export function WeddingTextarea({
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={`w-full rounded-xl border border-[#E8B7C8] bg-white px-4 py-3 text-sm text-[#2B2424] placeholder:text-[#6F6260]/60 focus:outline-none focus:border-[#8F1D2C] focus:ring-2 focus:ring-[#8F1D2C]/20 transition resize-none ${className}`}
    />
  )
}
