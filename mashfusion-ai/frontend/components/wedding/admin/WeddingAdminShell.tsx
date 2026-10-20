'use client'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Home, Image as ImageIcon, Music2, Heart, Sparkles, ShieldCheck, Printer, Settings,
  LogOut, Menu, X, CreditCard, LayoutGrid, Camera, Tv,
} from 'lucide-react'
import { auth } from '@/lib/api'
import { useI18n, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'
import { usePortal } from '@/components/portal/PortalProvider'
import { MioloveLanguageSwitcher } from '../MioloveLanguageSwitcher'
import { useEffectiveAccess } from '@/lib/access'
import { useWeddingTitle } from '@/components/brand/MioloveLogo'
import { WeddingBrandLogo } from '@/components/brand/EventBrand'
import { cn } from '@/lib/utils'

export type WeddingNavKey = 'home' | 'photos' | 'requests' | 'dedications' | 'games' | 'booth' | 'screen' | 'privacy' | 'poster' | 'settings'

type NavItem = { key: WeddingNavKey; icon: typeof Home; label: string; /** Photo feature: MIOLOVE albums only, never shown to a DJ (IOMIXO Wedding). */ photo?: boolean }
// Two areas: couple-facing album tools and the DJ's live control room.
const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  { title: 'wdAdmin.group.couple', items: [
    { key: 'home',     icon: Home,        label: 'wdAdmin.nav.home' },
    { key: 'photos',   icon: ImageIcon,   label: 'wdAdmin.nav.photos', photo: true },
    { key: 'privacy',  icon: ShieldCheck, label: 'wdAdmin.nav.privacy' },
    { key: 'poster',   icon: Printer,     label: 'wdAdmin.nav.poster', photo: true },
    { key: 'settings', icon: Settings,    label: 'wdAdmin.nav.settings' },
  ] },
  { title: 'wdAdmin.group.dj', items: [
    { key: 'requests',    icon: Music2,   label: 'wdAdmin.nav.requests' },
    { key: 'dedications', icon: Heart,    label: 'wdAdmin.nav.dedications' },
    { key: 'games',       icon: Sparkles, label: 'wdAdmin.nav.games' },
    { key: 'booth',       icon: Camera,   label: 'wdAdmin.nav.booth', photo: true },
    { key: 'screen',      icon: Tv,       label: 'wdAdmin.nav.screen' },
  ] },
]

interface Props {
  eventName: string
  active: WeddingNavKey
  onSelect: (key: WeddingNavKey) => void
  badges?: Partial<Record<WeddingNavKey, number>>
  /** Sposi account: only the couple group is rendered (no DJ control room, no "Regia DJ" title). */
  couple?: boolean
  /** What the album is for: anything but a wedding gets a neutral navigation heading instead of "Per gli sposi". */
  occasion?: string
  children: ReactNode
}

// Full-screen wedding admin layout. Covers the shared dashboard chrome so Party/DJ UI is never affected.
export function WeddingAdminShell({ eventName, active, onSelect, badges, couple = false, occasion, children }: Props) {
  const { t, locale, setLocale } = useI18n()
  const { config: portal } = usePortal()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { user } = useEffectiveAccess()
  useWeddingTitle()

  const displayName = user?.full_name ?? user?.email?.split('@')[0] ?? ''

  const logout = async () => {
    await auth.logout()
    toast.success(t('sidebar.loggedOut'))
    router.push('/login')
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-white px-4 pt-7 pb-5 overflow-y-auto">
      <p className="mb-2.5 px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-wd-muted">{t('wdAdmin.currentEvent')}</p>
      <div className="rounded-2xl border-2 border-wd-pink px-4 py-3.5 text-center">
        <p className="truncate text-sm font-bold text-wd-pink" title={eventName}>{eventName}</p>
      </div>

      <nav className="mt-5 space-y-4" aria-label="Wedding">
        {(couple ? NAV_GROUPS.slice(0, 1) : NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.photo) }))).map((g) => (
          <div key={g.title} className="space-y-1">
            <p className="px-4 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-wd-muted">{g.title === 'wdAdmin.group.couple' && !couple ? t('wdAdmin.group.event') : g.title === 'wdAdmin.group.couple' && occasion && occasion !== 'wedding' ? t('onboarding.albumGroup') : t(g.title)}</p>
            {g.items.map(({ key, icon: Icon, label }) => {
              const isActive = key === active
              const badge = badges?.[key]
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { onSelect(key); setOpen(false) }}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-sm text-left transition-colors',
                    isActive ? 'bg-wd-active font-bold text-wd-pink' : 'font-semibold text-wd-ink hover:bg-wd-active/60',
                  )}
                >
                  <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-wd-pink' : 'text-wd-muted')} strokeWidth={1.75} />
                  <span className="flex-1">{t(label)}</span>
                  {!!badge && <span className="rounded-full bg-wd-pink px-2 py-0.5 text-[11px] font-semibold text-white">{badge}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="mt-6 border-t border-wd-border pt-5">
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-wd-active text-sm font-bold text-wd-pink">
            {user?.avatar_url
              ? <Image src={user.avatar_url} alt="avatar" width={36} height={36} className="h-full w-full object-cover" />
              : (displayName[0]?.toUpperCase() ?? '?')}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-wd-ink">{displayName}</p>
            <p className="truncate text-[11px] text-wd-muted">{user?.email}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-2">
          <Link href="/billing" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-wd-border bg-white px-2 py-2 text-xs font-semibold text-wd-ink hover:bg-wd-active whitespace-nowrap">
            <CreditCard className="h-3.5 w-3.5 shrink-0" /> {couple ? t('albumPlan.navLabel') : t('sidebar.subscription')}
          </Link>
          <button onClick={logout} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-wd-border bg-white px-2 py-2 text-xs font-semibold text-wd-ink hover:bg-wd-active">
            <LogOut className="h-3.5 w-3.5 shrink-0" /> {t('sidebar.logout')}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-wd-active p-3.5">
        <p className="mb-2.5 text-xs font-medium text-wd-pink">{t('wdAdmin.manageEvents')}</p>
        <Link href="/sessions" className="flex w-full items-center justify-center gap-2 rounded-xl bg-wd-pink px-3 py-2.5 text-xs font-bold text-white hover:bg-wd-pink-hover">
          <LayoutGrid className="h-3.5 w-3.5 shrink-0" /> {t('wdAdmin.allEvents')}
        </Link>
      </div>
    </div>
  )

  return (
    <div className="wedding-admin fixed inset-0 z-40 flex flex-col bg-wd-bg text-wd-ink font-sans antialiased">
      <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-wd-border bg-white px-4 sm:px-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setOpen(!open)} aria-label="Menu" className="md:hidden rounded-lg p-2 text-wd-ink hover:bg-wd-active">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <WeddingBrandLogo height={36} className="text-wd-ink" />
        </div>
        <div className="flex items-center gap-2.5">
          {displayName && (
            <span className="hidden sm:inline-flex rounded-full border border-wd-border bg-wd-active/60 px-4 py-1.5 text-sm text-wd-muted">
              {t('wdAdmin.welcome')}, <b className="ml-1 font-semibold text-wd-ink">{displayName}</b>
            </span>
          )}
          {portal.id === 'miolove' ? <MioloveLanguageSwitcher /> : (
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label="Language"
              className="rounded-full border border-wd-border bg-white px-3 py-1.5 text-sm font-semibold text-wd-ink focus:outline-none focus:ring-2 focus:ring-wd-pink/30"
            >
              {SUPPORTED_LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden md:block w-[255px] shrink-0 border-r border-wd-border">{sidebar}</aside>

        {open && (
          <div className="md:hidden fixed inset-x-0 bottom-0 top-[68px] z-50">
            <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-xl">{sidebar}</aside>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
