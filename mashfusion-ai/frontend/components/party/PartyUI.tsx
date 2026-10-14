'use client'
/**
 * Party / DJ Mode UI primitives — near-black surfaces, pink primary, neon-yellow accent used sparingly.
 * Used by Party-themed pages (live, screen, booth, dashboard). Not for Wedding Mode.
 */
import { ReactNode } from 'react'

export const PARTY = {
  bg:        'bg-[#0A0A0D]',
  bgGrad:    'bg-[#0A0A0D]',
  surface:   'bg-[#15151B] border border-[#2A2A33]',
  surfaceHi: 'bg-[#1C1C23] border border-[#2A2A33]',
  wine:      '#E9207C',
  wineSoft:  '#E9207C',
  fuchsia:   '#FF2D8D',
  fuchsiaSoft: '#FF2D8D',
  gold:      '#F4FF3A',
}

export function PartyShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`min-h-screen text-[#F8F8FA] bg-[#0A0A0D] ${className}`}>
      <div className="relative">{children}</div>
    </div>
  )
}

export function PartyCard({
  children, className = '', tone = 'default',
}: { children: ReactNode; className?: string; tone?: 'default' | 'hi' | 'wine' | 'fuchsia' }) {
  const map: Record<string, string> = {
    default:  'bg-[#15151B] border border-[#2A2A33]',
    hi:       'bg-[#1C1C23] border border-[#2A2A33]',
    wine:     'bg-[#15151B] border border-[#FF2D8D]/25',
    fuchsia:  'bg-[#15151B] border border-[#FF2D8D]/25',
  }
  return <div className={`rounded-2xl p-5 ${map[tone]} ${className}`}>{children}</div>
}

type BtnVariant = 'wine' | 'fuchsia' | 'outline' | 'ghost' | 'accent'
export function PartyButton({
  children, onClick, type = 'button', disabled, loading, icon,
  variant = 'wine', size = 'md', className = '',
}: {
  children: ReactNode; onClick?: () => void; type?: 'button' | 'submit';
  disabled?: boolean; loading?: boolean; icon?: ReactNode;
  variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; className?: string;
}) {
  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3.5 text-base',
  }
  const variants: Record<string, string> = {
    wine:    'bg-[#FF2D8D] hover:bg-[#E9207C] text-white border border-transparent',
    fuchsia: 'bg-[#FF2D8D] hover:bg-[#E9207C] text-white border border-transparent',
    accent:  'bg-[#F4FF3A] hover:brightness-95 text-[#0A0A0D] border border-transparent',
    outline: 'bg-[#15151B] border border-[#2A2A33] text-[#F8F8FA] hover:border-[#FF2D8D]/60 hover:bg-[#1C1C23]',
    ghost:   'bg-transparent text-[#9A9AA3] border border-transparent hover:bg-white/5 hover:text-[#F8F8FA]',
  }
  return (
    <button
      type={type} onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF2D8D]/50 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading ? <span className="inline-block h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function PartyBadge({ children, tone = 'wine' }: { children: ReactNode; tone?: 'wine' | 'fuchsia' | 'gold' | 'soft' | 'success' | 'danger' }) {
  const map: Record<string, string> = {
    wine:    'bg-[#FF2D8D]/12 text-[#FF2D8D] border-[#FF2D8D]/35',
    fuchsia: 'bg-[#FF2D8D]/12 text-[#FF2D8D] border-[#FF2D8D]/35',
    gold:    'bg-[#F4FF3A]/10 text-[#F4FF3A] border-[#F4FF3A]/30',
    success: 'bg-[#43E08D]/10 text-[#43E08D] border-[#43E08D]/30',
    danger:  'bg-[#FF5C75]/10 text-[#FF5C75] border-[#FF5C75]/30',
    soft:    'bg-white/5 text-[#9A9AA3] border-[#2A2A33]',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${map[tone]}`}>
      {children}
    </span>
  )
}

/** LIVE pill: yellow accent with a gently pulsing dot. */
export function PartyLivePill({ live = true, label }: { live?: boolean; label?: string }) {
  return live ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4FF3A] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[#0A0A0D]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#0A0A0D] animate-pulse" />{label ?? 'LIVE'}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-[#2A2A33] bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#9A9AA3]">{label ?? 'CHIUSA'}</span>
  )
}

export function PartyEyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[#9A9AA3]">{children}</p>
}

const fieldCls = 'w-full rounded-xl bg-[#15151B] border border-[#2A2A33] px-4 py-2.5 text-sm text-[#F8F8FA] placeholder-[#9A9AA3]/70 focus:outline-none focus:border-[#FF2D8D] focus:ring-2 focus:ring-[#FF2D8D]/20 disabled:opacity-40'

export function PartyInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldCls} ${props.className ?? ''}`} />
}

export function PartyTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldCls} ${props.className ?? ''}`} />
}

export function PartyDivider({ className = '' }: { className?: string }) {
  return <div className={`h-px w-full bg-[#2A2A33] ${className}`} />
}

/** Party-themed paywall card. */
export function PartyPaywall({ title, message, ctaHref = '/billing' }: { title?: string; message?: string; ctaHref?: string }) {
  return (
    <PartyCard tone="wine" className="text-center py-8">
      <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[#F4FF3A] mb-3">Party Mode Premium</p>
      <h3 className="text-xl font-black text-[#F8F8FA] mb-2">{title ?? 'Funzione bloccata'}</h3>
      <p className="text-sm text-[#9A9AA3] max-w-md mx-auto mb-5">
        {message ?? 'Questa funzione è disponibile con Advance o Event Pass 24H.'}
      </p>
      <a href={ctaHref}>
        <PartyButton variant="fuchsia" size="lg">Sblocca Advance</PartyButton>
      </a>
    </PartyCard>
  )
}
