'use client'
import { createContext, useContext, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { Wifi } from 'lucide-react'
import { IomixoWeddingMark } from '@/components/brand/EventBrand'
import { cn } from '@/lib/utils'

// DJ Remote design system. One component set, two themes:
//  wedding → MIOLOVE ALBUM (light pink)   ·   party → IOMIXO Party (dark, pink + neon yellow)
export type RemoteTheme = 'wedding' | 'party'

const ThemeCtx = createContext<RemoteTheme>('wedding')
export const useRemoteTheme = () => useContext(ThemeCtx)

const T = {
  wedding: {
    page: 'bg-wd-bg text-wd-ink',
    card: 'bg-white border-wd-border',
    soft: 'bg-wd-active border-wd-border',
    text: 'text-wd-ink',
    muted: 'text-wd-muted',
    accent: 'text-wd-pink',
    primary: 'bg-wd-pink text-white hover:bg-wd-pink-hover',
    secondary: 'bg-white text-wd-ink border border-wd-border hover:bg-wd-active',
    ghost: 'bg-transparent text-wd-muted hover:bg-wd-active hover:text-wd-ink',
    tabIdle: 'bg-white text-wd-ink border border-wd-border hover:bg-wd-active',
    tabActive: 'bg-wd-pink text-white border border-wd-pink',
    ring: 'focus-visible:ring-wd-pink/40',
    on: 'bg-wd-pink text-white',
    approve: 'bg-wd-pink text-white hover:bg-wd-pink-hover',
    reject: 'bg-white text-wd-ink border border-wd-border hover:bg-wd-active',
  },
  party: {
    page: 'bg-[#0A0A0D] text-[#F8F8FA]',
    card: 'bg-[#15151B] border-[#2A2A33]',
    soft: 'bg-[#1C1C23] border-[#2A2A33]',
    text: 'text-[#F8F8FA]',
    muted: 'text-[#9A9AA3]',
    accent: 'text-[#FF2D8D]',
    primary: 'bg-[#FF2D8D] text-white hover:bg-[#E9207C]',
    secondary: 'bg-[#1C1C23] text-[#F8F8FA] border border-[#2A2A33] hover:border-[#FF2D8D]/60',
    ghost: 'bg-transparent text-[#9A9AA3] hover:bg-[#1C1C23] hover:text-[#F8F8FA]',
    tabIdle: 'bg-[#15151B] text-[#F8F8FA] border border-[#2A2A33] hover:border-[#FF2D8D]/60',
    tabActive: 'bg-[#FF2D8D] text-white border border-[#FF2D8D]',
    ring: 'focus-visible:ring-[#F4FF3A]/60',
    on: 'bg-[#F4FF3A] text-[#0A0A0D]',
    approve: 'bg-[#FF2D8D] text-white hover:bg-[#E9207C]',
    reject: 'bg-[#1C1C23] text-[#F8F8FA] border border-[#2A2A33] hover:border-[#FF2D8D]/60',
  },
} as const

export const remoteTone = (theme: RemoteTheme) => T[theme]

export function RemoteShell({ theme, children }: { theme: RemoteTheme; children: ReactNode }) {
  return (
    <ThemeCtx.Provider value={theme}>
      <div className={cn('min-h-screen w-full font-sans antialiased', T[theme].page)}>
        <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-5">{children}</div>
      </div>
    </ThemeCtx.Provider>
  )
}

export function RemoteBrand() {
  const theme = useRemoteTheme()
  // The remote is a DJ tool: IOMIXO brand on both themes, never MIOLOVE.
  if (theme === 'wedding') return <IomixoWeddingMark height={30} className="text-wd-ink" />
  return <span className="text-[17px] font-black tracking-tight text-white">IOMIXO <span className="text-[#FF2D8D]">Live Hub</span></span>
}

export function RemoteHeader({ title, subtitle, live, liveLabel, remoteLabel, languageSlot }: {
  title: string; subtitle?: string | null; live: boolean; liveLabel: string; remoteLabel: string; languageSlot?: ReactNode
}) {
  const theme = useRemoteTheme(); const c = T[theme]
  return (
    <header className="mb-5">
      <div className="flex items-center justify-between gap-3">
        <RemoteBrand />
        {languageSlot}
      </div>
      <div className="mt-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.12em]', c.soft, c.accent)}>
            <Wifi className="h-3.5 w-3.5" /> {remoteLabel}
          </span>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide', live ? c.on : cn('border', c.soft, c.muted))}>
            <span className={cn('h-2 w-2 rounded-full', live ? (theme === 'party' ? 'bg-[#0A0A0D]' : 'bg-white') : 'bg-current opacity-50')} />
            {liveLabel}
          </span>
        </div>
        <h1 className={cn('mt-4 break-words text-[26px] font-bold leading-tight tracking-tight', c.text)}>{title}</h1>
        {subtitle && <p className={cn('mt-1 text-[16px]', c.muted)}>{subtitle}</p>}
      </div>
    </header>
  )
}

export function RemoteTab({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  const c = T[useRemoteTheme()]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl px-4 text-[15px] font-semibold transition focus:outline-none focus-visible:ring-2', c.ring, active ? c.tabActive : c.tabIdle)}
    >
      {icon}
      {label}
      {!!badge && <span className={cn('rounded-full px-2 py-0.5 text-[12px] font-bold', active ? 'bg-white/25 text-inherit' : c.on)}>{badge}</span>}
    </button>
  )
}

export function RemoteCard({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const c = T[useRemoteTheme()]
  return <div {...rest} className={cn('rounded-[20px] border p-4', c.card, className)}>{children}</div>
}

export function RemoteButton({ variant = 'secondary', loading, icon, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; loading?: boolean; icon?: ReactNode }) {
  const c = T[useRemoteTheme()]
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cn('inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50', c.ring, c[variant], className)}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : icon}
      {children}
    </button>
  )
}

/** Highlighted panel for the current live state (round, question, penalty). */
export function RemoteStatus({ label, children }: { label: string; children: ReactNode }) {
  const c = T[useRemoteTheme()]
  return (
    <div className={cn('rounded-2xl border p-4 text-center', c.soft)}>
      <p className={cn('text-[12px] font-semibold uppercase tracking-[0.14em]', c.accent)}>{label}</p>
      <div className={cn('mt-1.5 text-[19px] font-semibold leading-snug', c.text)}>{children}</div>
    </div>
  )
}

export function RemoteEmpty({ children }: { children: ReactNode }) {
  const c = T[useRemoteTheme()]
  return <RemoteCard className="py-8 text-center"><p className={cn('text-[16px]', c.muted)}>{children}</p></RemoteCard>
}

/** Collapsible game row: header is a 60px touch target, open state is highlighted. */
export function RemoteAccordion({ icon, title, open, onToggle, children }: { icon: ReactNode; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const theme = useRemoteTheme(); const c = T[theme]
  return (
    <RemoteCard className={cn('p-0 overflow-hidden', open && (theme === 'party' ? 'border-[#F4FF3A]/60' : 'border-wd-pink'))}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-[60px] w-full items-center justify-between gap-3 px-4 text-left">
        <span className="flex items-center gap-3">
          <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', c.soft, c.accent)}>{icon}</span>
          <span className={cn('text-[17px] font-semibold', c.text)}>{title}</span>
        </span>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[20px] font-bold leading-none', open ? c.on : cn('border', c.soft, c.accent))}>{open ? '−' : '+'}</span>
      </button>
      {open && <div className={cn('border-t p-4', theme === 'party' ? 'border-[#2A2A33]' : 'border-wd-border')}>{children}</div>}
    </RemoteCard>
  )
}
