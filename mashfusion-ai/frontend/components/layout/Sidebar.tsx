'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import useSWR from 'swr'
import {
  LayoutDashboard, Radio, UserCircle, CalendarDays, CreditCard,
  LogOut, Settings, PanelLeftClose, PanelLeftOpen, Lock, Menu, X,
} from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { auth, live } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useEffectiveAccess } from '@/lib/access'
import toast from 'react-hot-toast'
import { Logo } from '@/components/Logo'
import { MioloveLogo } from '@/components/brand/MioloveLogo'
import { useAccountRole } from '@/lib/roles'
import { useAlbumPlan } from '@/lib/miolove/useAlbumPlan'

const NAV_ITEMS = [
  { href: '/dashboard', key: 'dashboard',     icon: LayoutDashboard, proOnly: false },
  { href: '/sessions',  key: 'sessionsLive',  icon: Radio,           proOnly: false },
  { href: '/profile',   key: 'profileDj',     icon: UserCircle,      proOnly: false },
  { href: '/events',    key: 'upcomingDates', icon: CalendarDays,    proOnly: true  },
  { href: '/billing',   key: 'subscription',  icon: CreditCard,      proOnly: false },
  { href: '/settings',  key: 'settings',      icon: Settings,        proOnly: false },
] as const

// Sposi: album tools only (the album itself opens on its Home tab).
const COUPLE_NAV_ITEMS = [
  { href: '/sessions', key: 'albums',       icon: LayoutDashboard, proOnly: false },
  { href: '/billing',  key: 'plan',         icon: CreditCard,      proOnly: false },
  { href: '/settings', key: 'settings',     icon: Settings,        proOnly: false },
] as const

const SIDEBAR_STORAGE_KEY = 'iomixo.sidebar.collapsed'

export function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { t } = useI18n()
  const { isCouple } = useAccountRole()
  const NAV = isCouple ? COUPLE_NAV_ITEMS : NAV_ITEMS

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY)
      if (raw === '1') setCollapsed(true)
    } catch {}
  }, [])

  const { user, effectiveLabel: ownLabel, isFree: ownIsFree, hasActiveEventPass: ownPass, activePass } = useEffectiveAccess()
  // MIOLOVE: the plan is the album's (free trial / full album), never an IOMIXO plan or Event Pass.
  const { state: albumState } = useAlbumPlan()
  const planKey = { none: 'albumPlan.statusNone', trial: 'albumPlan.trialName', trialEnded: 'albumPlan.statusTrialEnded', active: 'albumPlan.albumName' }[albumState.kind]
  const effectiveLabel = isCouple ? t(planKey) : ownLabel
  const isFree = isCouple ? false : ownIsFree
  const hasActiveEventPass = isCouple ? false : ownPass

  const sessionIdMatch = pathname?.match(/^\/sessions\/([^/]+)/)
  const sessionId = sessionIdMatch?.[1]
  const { data: currentSession } = useSWR(
    sessionId ? ['session', sessionId] : null,
    () => live.getSession(sessionId!),
    { revalidateOnFocus: false, dedupingInterval: 5_000 },
  )
  const weddingPage = currentSession?.session_type === 'wedding'
  // Sposi always get the light MIOLOVE look, even outside an album.
  const wedding = weddingPage || isCouple

  useEffect(() => { setMobileOpen(false) }, [pathname])

  const handleLogout = async () => {
    await auth.logout()
    toast.success(t('sidebar.loggedOut'))
    router.push('/login')
  }

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  // Wedding sessions render their own full-screen layout (WeddingAdminShell); the MIOLOVE onboarding is a standalone screen.
  if (weddingPage || pathname === '/onboarding') return null

  const mobileNav = (
    <div className="md:hidden">
      <header className={cn('sticky top-0 z-30 flex h-14 items-center justify-between border-b px-3', isCouple ? 'border-[#E8B7C8] bg-white' : 'border-[#2A2A33] bg-[#0A0A0D]')}>
        <div className="flex items-center gap-2.5 min-w-0">
          {isCouple ? <MioloveLogo height={28} /> : (<>
          <Logo variant="party" size={28} className="shrink-0" />
          <p className="truncate text-sm font-bold text-white">
            {currentSession?.event_name ?? 'IOMIXO'}
          </p></>)}
          {currentSession?.is_active && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#F4FF3A] px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[#0A0A0D]"><span className="h-1 w-1 rounded-full bg-[#0A0A0D] animate-pulse" />Live</span>
          )}
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
          aria-expanded={mobileOpen}
          className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border', isCouple ? 'border-[#E8B7C8] bg-white text-[#2B2424]' : 'border-[#2A2A33] bg-[#15151B] text-white')}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {mobileOpen && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <nav className={cn('absolute inset-y-0 left-0 flex w-[300px] max-w-[88vw] flex-col overflow-y-auto border-r p-3', isCouple ? 'border-[#E8B7C8] bg-white' : 'border-[#2A2A33] bg-[#0A0A0D]')} aria-label="Menu">
            <div className="flex-1 space-y-1.5">
              {NAV.map(({ href, key, icon: Icon, proOnly }) => {
                const active = pathname === href || (href !== '/dashboard' && pathname?.startsWith(href))
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex min-h-[48px] items-center gap-3 rounded-xl px-4 text-sm font-semibold',
                      isCouple
                        ? (active ? 'bg-[#FBEAF0] text-[#8F1D2C]' : 'text-[#6F6260] hover:bg-[#FBEAF0]/60')
                        : (active ? 'bg-[#FF2D8D] text-white' : 'text-[#9A9AA3] hover:bg-white/5 hover:text-white'),
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="flex-1">{key === 'albums' ? t('roles.myAlbums') : key === 'plan' ? t('albumPlan.navLabel') : t(`sidebar.${key}`)}</span>
                    {key === 'sessionsLive' && currentSession?.is_active && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#F4FF3A] px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[#0A0A0D]">Live</span>
                    )}
                    {proOnly && isFree && <Lock className="h-3.5 w-3.5 text-white/30" />}
                  </Link>
                )
              })}
            </div>
            <div className={cn('mt-4 border-t pt-3', isCouple ? 'border-[#E8B7C8]' : 'border-[#2A2A33]')}>
              <div className="flex items-center gap-3 px-2 pb-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#FF2D8D]/15 text-sm font-semibold text-[#FF2D8D]">
                  {user?.avatar_url ? <Image src={user.avatar_url} alt="avatar" width={36} height={36} className="h-full w-full object-cover" /> : (user?.full_name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?')}
                </div>
                <div className="min-w-0">
                  <p className={cn('truncate text-sm font-medium', isCouple ? 'text-[#2B2424]' : 'text-white')}>{user?.full_name ?? user?.email ?? '...'}</p>
                  <p className={cn('text-[11px] capitalize', isCouple ? 'text-[#6F6260]' : 'text-[#9A9AA3]')}>{effectiveLabel}</p>
                </div>
              </div>
              <button onClick={handleLogout} className={cn('flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold', isCouple ? 'border-[#E8B7C8] bg-white text-[#2B2424]' : 'border-[#2A2A33] bg-[#15151B] text-white')}>
                <LogOut className="h-4 w-4" /> {t('sidebar.logout')}
              </button>
            </div>
          </nav>
        </div>
      )}
    </div>
  )

  return (
    <>
    {mobileNav}
    <aside
      className={cn(
        'hidden md:flex flex-col min-h-screen transition-[width] duration-200 ease-out',
        wedding ? 'border-r border-[#E8B7C8]' : 'border-r border-[#2A2A33] bg-[#0A0A0D]',
        collapsed ? 'w-[76px]' : 'w-64',
      )}
      style={wedding ? { background: '#F7F4F3' } : undefined}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-3 py-5',
        wedding ? 'border-b border-[#E8B7C8]' : 'border-b border-[#2A2A33]',
        collapsed ? 'px-3' : 'px-6',
      )}>
        {isCouple ? (!collapsed && <MioloveLogo height={32} />) : (<>
        <Logo variant="party" size={36} className="shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <p className={cn('text-sm font-bold tracking-tight', wedding ? 'text-[#2B2424]' : 'text-white')}>IOMIXO</p>
            <p className={cn('text-[10px] font-medium', wedding ? 'text-[#8F1D2C]' : 'text-[#FF2D8D]')}>Live Hub</p>
          </div>
        )}</>)}
        <button
          onClick={toggleCollapsed}
          className={cn(
            'ml-auto h-7 w-7 rounded-md flex items-center justify-center transition-colors',
            wedding
              ? 'text-[#6F6260] hover:text-[#2B2424] hover:bg-[#FBEAF0]'
              : 'text-white/40 hover:text-white/80 hover:bg-white/5',
            collapsed && 'ml-0',
          )}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-label={collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 py-5 space-y-1', collapsed ? 'px-2' : 'px-3')}>
        {NAV.map(({ href, key, icon: Icon, proOnly }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname?.startsWith(href))
          const locked = proOnly && isFree
          const label = key === 'albums' ? t('roles.myAlbums') : key === 'plan' ? t('albumPlan.navLabel') : t(`sidebar.${key}`)
          return (
            <Link key={href} href={href}>
              <motion.div
                whileTap={{ scale: 0.98 }}
                className={cn(
                  'relative flex items-center rounded-xl py-2.5 text-sm font-medium transition-all',
                  collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                  wedding
                    ? active
                      ? 'bg-[#FBEAF0] text-[#8F1D2C]'
                      : 'text-[#6F6260] hover:text-[#2B2424] hover:bg-[#FBEAF0]/60'
                    : active
                      ? 'bg-[#FF2D8D] text-white'
                      : 'text-[#9A9AA3] hover:text-white hover:bg-white/5'
                )}
                title={collapsed ? label : undefined}
              >
                {active && (
                  <motion.div
                    layoutId="sidebar-active"
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 rounded-r',
                      wedding ? 'bg-[#8F1D2C]' : 'bg-[#F4FF3A]',
                      collapsed ? 'left-0 h-4 w-0.5' : 'left-0 h-5 w-0.5',
                    )}
                  />
                )}
                <Icon className={cn('h-4 w-4', active ? (wedding ? 'text-[#8F1D2C]' : 'text-white') : '')} />
                {!collapsed && (
                  <span className="flex-1 flex items-center justify-between">
                    {label}
                    {key === 'sessionsLive' && currentSession?.is_active && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#F4FF3A] px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[#0A0A0D]"><span className="h-1 w-1 rounded-full bg-[#0A0A0D] animate-pulse" />Live</span>
                    )}
                    {locked && <Lock className={cn('h-3 w-3', wedding ? 'text-[#6F6260]/60' : 'text-white/30')} />}
                  </span>
                )}
              </motion.div>
            </Link>
          )
        })}
      </nav>

      {/* Plan badge */}
      {user && !collapsed && (
        <div className={cn(
          'mx-3 mb-3 rounded-xl p-3',
          wedding ? 'bg-white border border-[#E8B7C8]' : 'glass',
        )}>
          <p className={cn('text-[10px] uppercase tracking-wide mb-1', wedding ? 'text-[#6F6260]' : 'text-white/40')}>{t('sidebar.currentPlan')}</p>
          <div className="flex items-center justify-between">
            <p className={cn('text-sm font-semibold', wedding ? 'text-[#2B2424]' : 'text-white')}>{effectiveLabel}</p>
            {isFree && (
              <Link href="/billing" className={cn('text-[11px]', wedding ? 'text-[#8F1D2C] hover:text-[#741625]' : 'text-[#FF2D8D] hover:text-[#E9207C]')}>
                {t('sidebar.upgradeToPro')}
              </Link>
            )}
          </div>
          {hasActiveEventPass && activePass && (
            <div className={cn('mt-2 pt-2 border-t', wedding ? 'border-[#E8B7C8]' : 'border-[#2A2A33]')}>
              <p className={cn('text-[11px] font-medium', wedding ? 'text-[#8F1D2C]' : 'text-[#F4FF3A]')}>{t('sidebar.eventPassActive')}</p>
              <p className={cn('text-[10px] mt-0.5', wedding ? 'text-[#6F6260]' : 'text-white/40')}>
                {t('sidebar.expires')}: {format(new Date(activePass.valid_until), 'd MMM, HH:mm')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* User + logout */}
      <div className={cn(
        wedding ? 'border-t border-[#E8B7C8]' : 'border-t border-[#2A2A33]',
        collapsed ? 'p-2' : 'p-3',
      )}>
        <div
          className={cn(
            'flex items-center rounded-xl',
            collapsed ? 'flex-col gap-2 p-1.5' : 'gap-2.5 p-2',
          )}
        >
          <div className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold overflow-hidden',
            wedding ? 'bg-[#FBEAF0] text-[#8F1D2C]' : 'bg-[#FF2D8D]/15 text-[#FF2D8D]',
          )}>
            {user?.avatar_url ? (
              <Image src={user.avatar_url} alt="avatar" width={32} height={32} className="object-cover w-full h-full" />
            ) : (
              user?.full_name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'
            )}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className={cn('text-xs font-medium truncate', wedding ? 'text-[#2B2424]' : 'text-white')}>{user?.full_name ?? user?.email ?? '...'}</p>
              <p className={cn('text-[10px] capitalize', wedding ? 'text-[#6F6260]' : 'text-white/30')}>{effectiveLabel}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className={cn('transition-colors', wedding ? 'text-[#6F6260] hover:text-[#8F1D2C]' : 'text-white/20 hover:text-red-400')}
            title={t('sidebar.logout')}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
    </>
  )
}
