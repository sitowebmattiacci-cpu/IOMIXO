'use client'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import Link from 'next/link'
import type { ToastOptions } from 'react-hot-toast'
import { Music2, Camera, Heart, Gamepad2, BarChart3, ChevronRight, ChevronLeft, ArrowLeft, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useWeddingTitle } from '@/components/brand/MioloveLogo'
import { WeddingBrandLogo, useEventBrandName, useWhiteLabel, WhiteLabelProvider } from '@/components/brand/EventBrand'
import { cn } from '@/lib/utils'

// Shared Wedding guest UI. Used by the real guest page (/live/[slug]) AND by the
// dashboard phone preview, so both always render the same visuals.
// Palette: wd-* tokens (pink #F06A9B, bg #FFF7FA, border #F3D7E1, ink #1F2028).

export type WeddingGuestActionKey = 'requests' | 'photos' | 'dedications' | 'games' | 'polls'

export interface WeddingGuestActionItem {
  key: WeddingGuestActionKey
  icon: ReactNode
  title: string
  desc: string
}

interface ActionDef {
  key: WeddingGuestActionKey
  /** guest_config flag controlled by the DJ. */
  flag: string
  /** Plan feature required (undefined = always available). */
  feature?: 'guestPhotoAlbum' | 'weddingDedications' | 'weddingGames' | 'livePolls'
  Icon: typeof Music2
}

const ACTION_DEFS: ActionDef[] = [
  { key: 'requests',    flag: 'requests',    Icon: Music2 },
  { key: 'photos',      flag: 'live_booth',  feature: 'guestPhotoAlbum',    Icon: Camera },
  { key: 'dedications', flag: 'dedications', feature: 'weddingDedications', Icon: Heart },
  { key: 'games',       flag: 'shoe_game',   feature: 'weddingGames',       Icon: Gamepad2 },
  { key: 'polls',       flag: 'polls',       feature: 'livePolls',          Icon: BarChart3 },
]

/** Which Wedding guest functions are visible. `features` omitted = plan gating not applied (preview of an Advance event). */
export function getWeddingGuestActionKeys(
  guestConfig: Record<string, boolean | undefined> | null | undefined,
  features?: Partial<Record<NonNullable<ActionDef['feature']>, boolean>> | null,
): WeddingGuestActionKey[] {
  const gc = guestConfig ?? {}
  const on = (flag: string) => (flag === 'requests' ? gc.requests !== false : gc[flag] === true)
  return ACTION_DEFS
    .filter((d) => on(d.flag) && (!d.feature || !features || !!features[d.feature]))
    .map((d) => d.key)
}

export function buildWeddingGuestActions(keys: WeddingGuestActionKey[], t: (k: string) => string): WeddingGuestActionItem[] {
  return keys.map((key) => {
    const def = ACTION_DEFS.find((d) => d.key === key)!
    return {
      key,
      icon: <def.Icon className="h-6 w-6" />,
      title: t(`guestMenu.${key}`),
      desc: t(`guestMenu.${key}Desc`),
    }
  })
}

const DATE_LOCALE: Record<string, string> = { it: 'it-IT', en: 'en-GB', fr: 'fr-FR', es: 'es-ES' }
/** Long date in the visitor's language (the page used to always print it in Italian). */
export function formatWeddingGuestDate(raw: string | null | undefined, locale: string = 'it'): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(DATE_LOCALE[locale] ?? 'it-IT', { dateStyle: 'long' })
}

export function WeddingGuestTopBar({ languageSlot }: { languageSlot?: ReactNode }) {
  const whiteLabel = useWhiteLabel()
  return (
    <div className="flex items-center justify-between gap-3" data-testid="guest-topbar" data-whitelabel={whiteLabel ? 'true' : 'false'}>
      {whiteLabel ? <span /> : <WeddingBrandLogo height={30} className="text-wd-ink" />}
      {languageSlot}
    </div>
  )
}

export function WeddingGuestHero({ names, date, venue, eyebrow = 'Wedding Edition' }: { names: string; date?: string | null; venue?: string | null; eyebrow?: string }) {
  return (
    <header className="px-2 pb-9 pt-12 text-center">
      <p className="text-[12px] font-semibold uppercase tracking-[0.28em] text-wd-pink">{eyebrow}</p>
      <h1 className="mt-5 break-words text-[40px] font-bold leading-[1.08] tracking-tight text-wd-ink">{names}</h1>
      <div className="mx-auto mt-6 h-[3px] w-12 rounded-full bg-wd-pink/60" />
      {date && <p className="mt-6 text-[17px] font-medium text-wd-ink">{date}</p>}
      {venue && <p className="mt-1.5 text-[15px] text-wd-muted">{venue}</p>}
    </header>
  )
}

export function WeddingGuestActionsIntro() {
  const { t } = useI18n()
  return (
    <div className="mb-5 text-center">
      <h2 className="text-[22px] font-bold leading-tight text-wd-ink">{t('guestMenu.heading')}</h2>
      <p className="mx-auto mt-1.5 max-w-[300px] text-[15px] leading-snug text-wd-muted">{t('guestMenu.subtitle')}</p>
    </div>
  )
}

export function WeddingGuestActionCard({ item, onSelect }: { item: WeddingGuestActionItem; onSelect?: (key: WeddingGuestActionKey) => void }) {
  const cls = 'flex min-h-[84px] w-full items-center gap-4 rounded-[20px] border border-wd-border bg-white p-4 text-left'
  const body = (
    <>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-wd-active text-wd-pink">{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold leading-tight text-wd-ink">{item.title}</span>
        <span className="mt-1 block text-[14px] leading-snug text-wd-muted">{item.desc}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-wd-pink/70" />
    </>
  )
  if (!onSelect) return <div className={cls}>{body}</div>
  return (
    <button type="button" onClick={() => onSelect(item.key)} className={cn(cls, 'transition active:scale-[0.99] active:bg-wd-active hover:border-wd-pink/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40')}>
      {body}
    </button>
  )
}

export function WeddingGuestActionList({ items, onSelect }: { items: WeddingGuestActionItem[]; onSelect?: (key: WeddingGuestActionKey) => void }) {
  return (
    <div className="space-y-3">
      {items.map((it) => <WeddingGuestActionCard key={it.key} item={it} onSelect={onSelect} />)}
    </div>
  )
}

/** Full guest home: top bar, hero, notices, actions. Rendered as-is inside the dashboard phone preview. */
export function WeddingGuestHome({
  names, date, venue, items, onSelect, languageSlot, notice, footer, eyebrow, emptyText,
}: {
  names: string
  date?: string | null
  venue?: string | null
  items: WeddingGuestActionItem[]
  onSelect?: (key: WeddingGuestActionKey) => void
  languageSlot?: ReactNode
  notice?: ReactNode
  footer?: ReactNode
  eyebrow?: string
  /** Shown when the owner turned every guest function off (default: the generic "available soon" text of the DJ product). */
  emptyText?: string
}) {
  const { t } = useI18n()
  return (
    <>
      <WeddingGuestTopBar languageSlot={languageSlot} />
      <WeddingGuestHero names={names} date={date} venue={venue} eyebrow={eyebrow} />
      {notice}
      {items.length === 0 ? (
        <div className="rounded-[20px] border border-wd-border bg-white p-5 text-center text-[15px] text-wd-muted">
          {emptyText ?? t('guestVisibility.emptyState')}
        </div>
      ) : (
        <>
          <WeddingGuestActionsIntro />
          <WeddingGuestActionList items={items} onSelect={onSelect} />
        </>
      )}
      {footer}
    </>
  )
}

export function WeddingGuestBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-semibold text-wd-pink hover:text-wd-pink-hover">
      <ChevronLeft className="h-5 w-5" />
      {label}
    </button>
  )
}

// ── Form primitives for the active guest sections ──────────────────────────

export function WeddingGuestPanel({ title, icon, children, className = '' }: { title?: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[20px] border border-wd-border bg-white p-5', className)}>
      {title && (
        <h2 className="mb-4 flex items-center gap-2.5 text-[20px] font-bold text-wd-ink">
          {icon && <span className="text-wd-pink">{icon}</span>}{title}
        </h2>
      )}
      {children}
    </section>
  )
}

export function WeddingGuestButton({
  children, loading, icon, className, disabled, variant = 'primary', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; icon?: ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-5 text-[16px] font-semibold transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary'
          ? 'bg-wd-pink text-white hover:bg-wd-pink-hover'
          : 'border border-wd-border bg-white text-wd-ink hover:bg-wd-active',
        className,
      )}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : icon}
      {children}
    </button>
  )
}

const FIELD = 'w-full rounded-2xl border border-wd-border bg-white px-4 py-3.5 text-[16px] text-wd-ink placeholder:text-wd-muted/70 focus:border-wd-pink focus:outline-none focus:ring-2 focus:ring-wd-pink/20 disabled:opacity-50'

export function WeddingGuestInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(FIELD, className)} />
}

export function WeddingGuestTextarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(FIELD, 'resize-none', className)} />
}

// ── Page-level shared pieces (secondary guest pages such as /booth/[slug]) ──

/** Toast style matching the Wedding guest palette (the global Toaster is dark). */
export const WEDDING_GUEST_TOAST: ToastOptions = {
  position: 'bottom-center',
  style: { background: '#FFFFFF', color: '#1F2028', border: '1px solid #F3D7E1', borderRadius: '16px', fontSize: '15px' },
  iconTheme: { primary: '#F06A9B', secondary: '#FFFFFF' },
}

/** Renders nothing; sets the tab title to the Wedding brand. */
export function WeddingGuestTitle({ prefix }: { prefix?: string }) {
  useWeddingTitle(prefix)
  return null
}

export function WeddingGuestShell({ children, languageSlot, centered = false, whiteLabel }: { children: ReactNode; languageSlot?: ReactNode; centered?: boolean; whiteLabel?: boolean }) {
  const brandName = useEventBrandName()
  const inherited = useWhiteLabel()
  const wl = whiteLabel ?? inherited
  return (
    <WhiteLabelProvider whiteLabel={wl}>
      <div className="min-h-screen w-full bg-wd-bg font-sans text-wd-ink antialiased">
        <WeddingGuestTitle />
        <div className={cn('mx-auto flex min-h-screen w-full max-w-[520px] flex-col px-5 pb-12 pt-5', centered && 'justify-center')}>
          <WeddingGuestTopBar languageSlot={languageSlot} />
          <div className="pt-6">{children}</div>
          {!wl && <p className="mt-12 text-center text-[12px] font-semibold tracking-wide text-wd-muted">{brandName}</p>}
        </div>
      </div>
    </WhiteLabelProvider>
  )
}

export function WeddingGuestPageTitle({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <header className="px-2 pb-7 pt-4 text-center">
      {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-[0.28em] text-wd-pink">{eyebrow}</p>}
      <h1 className="mt-4 break-words text-[32px] font-bold leading-[1.1] tracking-tight text-wd-ink">{title}</h1>
      {subtitle && <p className="mt-3 text-[17px] font-medium text-wd-ink">{subtitle}</p>}
    </header>
  )
}

export function WeddingGuestHelper({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'pink' }) {
  return <p className={cn('text-center text-[14px] leading-snug', tone === 'pink' ? 'text-wd-pink' : 'text-wd-muted')}>{children}</p>
}

export function WeddingGuestNotice({ tone = 'info', title, children, action }: { tone?: 'info' | 'success' | 'error'; title?: string; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertTriangle : Info
  return (
    <div className="rounded-[18px] border border-wd-border bg-wd-active px-4 py-3.5 text-left text-[15px] text-wd-ink">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-wd-pink" />
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          <div className={title ? 'mt-1 text-wd-muted' : ''}>{children}</div>
        </div>
      </div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function WeddingGuestBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mx-auto mt-8 inline-flex min-h-[44px] items-center gap-2 text-[15px] font-semibold text-wd-pink hover:text-wd-pink-hover">
      <ArrowLeft className="h-5 w-5" />
      {label}
    </Link>
  )
}
