'use client'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// Wedding admin design system (dashboard only). Light pink, white cards, no gradients.

const PAGE_WIDTH = { narrow: 'max-w-[660px]', default: 'max-w-[920px]', wide: 'max-w-[1120px]' }

export function WdPage({
  title, subtitle, actions, children, width = 'default',
}: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; width?: keyof typeof PAGE_WIDTH }) {
  return (
    <div className={cn('w-full px-5 sm:px-9 pt-8 pb-12', PAGE_WIDTH[width])}>
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] sm:text-[28px] font-bold tracking-tight text-wd-ink leading-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-wd-muted max-w-[560px]">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </header>
      <div className="space-y-5">{children}</div>
    </div>
  )
}

export function WdCard({
  children, className = '', title, description, action,
}: { children: ReactNode; className?: string; title?: string; description?: string; action?: ReactNode }) {
  return (
    <section className={cn('rounded-[20px] border border-wd-border bg-white p-6 sm:p-7', className)}>
      {(title || action) && (
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold text-wd-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-wd-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
interface WdButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: 'sm' | 'md'
  icon?: ReactNode
}
export function WdButton({ variant = 'primary', size = 'md', icon, className, children, ...rest }: WdButtonProps) {
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-wd-pink text-white hover:bg-wd-pink-hover border border-transparent',
    secondary: 'bg-white text-wd-ink border border-wd-border hover:bg-wd-active',
    ghost: 'bg-transparent text-wd-muted border border-transparent hover:bg-wd-active hover:text-wd-ink',
    danger: 'bg-white text-red-600 border border-wd-border hover:bg-red-50',
  }
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' }
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant], sizes[size], className,
      )}
    >
      {icon}{children}
    </button>
  )
}

export function WdLinkButton({
  href, variant = 'secondary', size = 'md', icon, children, external = true,
}: { href: string; variant?: BtnVariant; size?: 'sm' | 'md'; icon?: ReactNode; children: ReactNode; external?: boolean }) {
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-wd-pink text-white hover:bg-wd-pink-hover border border-transparent',
    secondary: 'bg-white text-wd-ink border border-wd-border hover:bg-wd-active',
    ghost: 'bg-transparent text-wd-muted border border-transparent hover:bg-wd-active hover:text-wd-ink',
    danger: 'bg-white text-red-600 border border-wd-border hover:bg-red-50',
  }
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' }
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40', variants[variant], sizes[size])}
    >
      {icon}{children}
    </a>
  )
}

export function WdToggle({
  checked, onChange, disabled, label,
}: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40 disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-wd-pink' : 'bg-gray-200',
      )}
    >
      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  )
}

export function WdToggleRow({
  icon, title, description, checked, onChange, disabled, status, section = false,
}: {
  icon?: ReactNode; title: string; description?: string; checked: boolean; onChange: (next: boolean) => void
  disabled?: boolean; status?: string; section?: boolean
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4', section ? 'px-6 sm:px-7 py-6' : 'py-3.5')}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && <span className="mt-0.5 text-wd-pink shrink-0">{icon}</span>}
        <div className="min-w-0">
          <p className="text-sm font-bold text-wd-ink">{title}</p>
          {description && <p className="mt-1 text-[13px] leading-relaxed text-wd-muted">{description}</p>}
          {status && <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-wd-muted">{status}</p>}
        </div>
      </div>
      <WdToggle checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  )
}

export function WdSectionCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-[20px] border border-wd-border bg-white divide-y divide-wd-border overflow-hidden', className)}>{children}</div>
}

export function WdSection({
  title, description, children, action,
}: { title?: string; description?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="px-6 sm:px-7 py-6">
      {(title || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-bold text-wd-ink">{title}</h3>}
            {description && <p className="mt-1 text-[13px] text-wd-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children && <div className={title ? 'mt-4' : ''}>{children}</div>}
    </section>
  )
}

export function WdDivided({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-wd-border">{children}</div>
}

export function WdPills<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: ReactNode; count?: number }> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-wd-pink border-wd-pink text-white' : 'bg-white border-wd-border text-wd-ink hover:bg-wd-active',
            )}
          >
            {o.icon}{o.label}
            {typeof o.count === 'number' && <span className={cn('text-xs', active ? 'text-white/80' : 'text-wd-muted')}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

const fieldBase =
  'w-full rounded-xl border border-wd-border bg-white px-4 py-3 text-sm text-wd-ink placeholder:text-wd-muted/70 ' +
  'focus:outline-none focus:border-wd-pink focus:ring-2 focus:ring-wd-pink/25 transition disabled:opacity-60'

export function WdInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(fieldBase, className)} />
}

export function WdSelect({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cn(fieldBase, className)} />
}

export function WdField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-wd-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-wd-muted">{hint}</span>}
    </label>
  )
}

export function WdBadge({ children, tone = 'pink' }: { children: ReactNode; tone?: 'pink' | 'neutral' | 'green' }) {
  const tones = {
    pink: 'bg-wd-active text-wd-pink-hover border-wd-border',
    neutral: 'bg-white text-wd-muted border-wd-border',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  )
}

export const wdStatusLabel = (t: (k: string, f?: string) => string, status?: string | null) =>
  status ? t(`wdAdmin.status.${status}`, status) : ''
