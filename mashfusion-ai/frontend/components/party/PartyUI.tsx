'use client'
/**
 * Party Mode UI primitives — dark premium with red-wine + soft fuchsia accents.
 * Used by Party-themed pages (live, screen, booth, dashboard).
 * Not for Wedding Mode — keep visually distinct.
 */
import { ReactNode } from 'react'

export const PARTY = {
  bg:        'bg-[#0B0510]',                                  // near-black violet
  bgGrad:    'bg-gradient-to-b from-[#0B0510] via-[#1A0A1F] to-[#0B0510]',
  surface:   'bg-white/[0.04] border border-white/[0.08]',
  surfaceHi: 'bg-white/[0.07] border border-white/[0.12]',
  wine:      '#8B0E2F',
  wineSoft:  '#B82E54',
  fuchsia:   '#FF3D8A',
  fuchsiaSoft:'#FF7AB6',
  gold:      '#F7C873',
}

export function PartyShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`min-h-screen text-white ${PARTY.bgGrad} ${className}`}>
      {/* Decorative glows */}
      <div className="pointer-events-none fixed top-[-10%] left-[-10%] h-[55vh] w-[55vh] rounded-full bg-[#8B0E2F]/30 blur-[140px]" />
      <div className="pointer-events-none fixed bottom-[-10%] right-[-10%] h-[55vh] w-[55vh] rounded-full bg-[#FF3D8A]/25 blur-[140px]" />
      <div className="relative">{children}</div>
    </div>
  )
}

export function PartyCard({
  children, className = '', tone = 'default',
}: { children: ReactNode; className?: string; tone?: 'default' | 'hi' | 'wine' | 'fuchsia' }) {
  const map: Record<string, string> = {
    default:  'bg-white/[0.04] border border-white/[0.08]',
    hi:       'bg-white/[0.07] border border-white/[0.14]',
    wine:     'bg-gradient-to-br from-[#8B0E2F]/30 to-[#5B0820]/20 border border-[#8B0E2F]/40',
    fuchsia:  'bg-gradient-to-br from-[#FF3D8A]/20 to-[#8B0E2F]/20 border border-[#FF3D8A]/35',
  }
  return (
    <div className={`rounded-2xl backdrop-blur-md p-5 shadow-[0_8px_30px_rgba(139,14,47,0.18)] ${map[tone]} ${className}`}>
      {children}
    </div>
  )
}

type BtnVariant = 'wine' | 'fuchsia' | 'outline' | 'ghost'
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
    wine:    'bg-gradient-to-r from-[#8B0E2F] to-[#B82E54] hover:from-[#A0163A] hover:to-[#D04369] text-white shadow-lg shadow-[#8B0E2F]/30',
    fuchsia: 'bg-gradient-to-r from-[#FF3D8A] to-[#B82E54] hover:from-[#FF55A0] hover:to-[#D04369] text-white shadow-lg shadow-[#FF3D8A]/30',
    outline: 'bg-transparent border border-[#FF3D8A]/40 text-[#FF7AB6] hover:bg-[#FF3D8A]/10',
    ghost:   'bg-white/5 hover:bg-white/10 text-white/80 border border-white/10',
  }
  return (
    <button
      type={type} onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading ? <span className="inline-block h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function PartyBadge({ children, tone = 'wine' }: { children: ReactNode; tone?: 'wine' | 'fuchsia' | 'gold' | 'soft' }) {
  const map: Record<string, string> = {
    wine:    'bg-[#8B0E2F]/20 text-[#FF7AB6] border-[#8B0E2F]/40',
    fuchsia: 'bg-[#FF3D8A]/15 text-[#FF7AB6] border-[#FF3D8A]/35',
    gold:    'bg-[#F7C873]/15 text-[#F7C873] border-[#F7C873]/35',
    soft:    'bg-white/5 text-white/70 border-white/10',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${map[tone]}`}>
      {children}
    </span>
  )
}

export function PartyEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-[#FF7AB6]/80">
      {children}
    </p>
  )
}

export function PartyInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF3D8A]/60 focus:bg-white/[0.08] disabled:opacity-40 ${props.className ?? ''}`}
    />
  )
}

export function PartyTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#FF3D8A]/60 focus:bg-white/[0.08] disabled:opacity-40 ${props.className ?? ''}`}
    />
  )
}

export function PartyDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#FF3D8A]/40 to-transparent" />
      <span className="text-[#FF3D8A]">✦</span>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#FF3D8A]/40 to-transparent" />
    </div>
  )
}

/** Party-themed paywall card. */
export function PartyPaywall({ title, message, ctaHref = '/billing' }: { title?: string; message?: string; ctaHref?: string }) {
  return (
    <PartyCard tone="wine" className="text-center py-8">
      <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-[#FF7AB6] mb-3">
        ✦ Party Mode Premium ✦
      </p>
      <h3 className="text-xl font-black text-white mb-2">{title ?? 'Funzione bloccata'}</h3>
      <p className="text-sm text-white/70 max-w-md mx-auto mb-5">
        {message ?? 'Questa funzione è disponibile con Advance o Event Pass 24H.'}
      </p>
      <a href={ctaHref}>
        <PartyButton variant="fuchsia" size="lg">Sblocca Advance</PartyButton>
      </a>
    </PartyCard>
  )
}
