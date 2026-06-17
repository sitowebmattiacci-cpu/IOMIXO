'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import useSWR from 'swr'
import {
  LayoutDashboard, Radio, UserCircle, CalendarDays, CreditCard,
  LogOut, Settings, PanelLeftClose, PanelLeftOpen, Lock,
} from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { auth, live } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useEffectiveAccess } from '@/lib/access'
import toast from 'react-hot-toast'
import { Logo } from '@/components/Logo'

const NAV_ITEMS = [
  { href: '/dashboard', key: 'dashboard',     icon: LayoutDashboard, proOnly: false },
  { href: '/sessions',  key: 'sessionsLive',  icon: Radio,           proOnly: false },
  { href: '/profile',   key: 'profileDj',     icon: UserCircle,      proOnly: false },
  { href: '/events',    key: 'upcomingDates', icon: CalendarDays,    proOnly: true  },
  { href: '/billing',   key: 'subscription',  icon: CreditCard,      proOnly: false },
  { href: '/settings',  key: 'settings',      icon: Settings,        proOnly: false },
] as const

const SIDEBAR_STORAGE_KEY = 'iomixo.sidebar.collapsed'

export function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { t } = useI18n()

  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY)
      if (raw === '1') setCollapsed(true)
    } catch {}
  }, [])

  const { user, effectiveLabel, isFree, hasActiveEventPass, activePass } = useEffectiveAccess()

  const sessionIdMatch = pathname?.match(/^\/sessions\/([^/]+)/)
  const sessionId = sessionIdMatch?.[1]
  const { data: currentSession } = useSWR(
    sessionId ? ['session', sessionId] : null,
    () => live.getSession(sessionId!),
    { revalidateOnFocus: false, dedupingInterval: 5_000 },
  )
  const wedding = currentSession?.session_type === 'wedding'

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

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col min-h-screen transition-[width] duration-200 ease-out',
        wedding ? 'border-r border-[#E8B7C8]' : 'border-r border-white/6 bg-surface-400',
        collapsed ? 'w-[76px]' : 'w-64',
      )}
      style={wedding ? { background: '#F7F4F3' } : undefined}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-3 py-5',
        wedding ? 'border-b border-[#E8B7C8]' : 'border-b border-white/6',
        collapsed ? 'px-3' : 'px-6',
      )}>
        <Logo size={36} className="shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <p className={cn('text-sm font-bold tracking-tight', wedding ? 'text-[#2B2424]' : 'text-white')}>IOMIXO</p>
            <p className={cn('text-[10px] font-medium', wedding ? 'text-[#8F1D2C]' : 'text-purple-400')}>Live Hub</p>
          </div>
        )}
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
        {NAV_ITEMS.map(({ href, key, icon: Icon, proOnly }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname?.startsWith(href))
          const locked = proOnly && isFree
          const label = t(`sidebar.${key}`)
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
                      ? 'bg-purple-500/15 text-white'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/4'
                )}
                title={collapsed ? label : undefined}
              >
                {active && (
                  <motion.div
                    layoutId="sidebar-active"
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 rounded-r',
                      wedding ? 'bg-[#8F1D2C]' : 'bg-purple-400',
                      collapsed ? 'left-0 h-4 w-0.5' : 'left-0 h-5 w-0.5',
                    )}
                  />
                )}
                <Icon className={cn('h-4 w-4', active ? (wedding ? 'text-[#8F1D2C]' : 'text-purple-400') : '')} />
                {!collapsed && (
                  <span className="flex-1 flex items-center justify-between">
                    {label}
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
              <Link href="/billing" className={cn('text-[11px]', wedding ? 'text-[#8F1D2C] hover:text-[#741625]' : 'text-purple-300 hover:text-purple-200')}>
                {t('sidebar.upgradeToPro')}
              </Link>
            )}
          </div>
          {hasActiveEventPass && activePass && (
            <div className={cn('mt-2 pt-2 border-t', wedding ? 'border-[#E8B7C8]' : 'border-white/10')}>
              <p className={cn('text-[11px] font-medium', wedding ? 'text-[#8F1D2C]' : 'text-pink-300')}>{t('sidebar.eventPassActive')}</p>
              <p className={cn('text-[10px] mt-0.5', wedding ? 'text-[#6F6260]' : 'text-white/40')}>
                {t('sidebar.expires')}: {format(new Date(activePass.valid_until), 'd MMM, HH:mm')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* User + logout */}
      <div className={cn(
        wedding ? 'border-t border-[#E8B7C8]' : 'border-t border-white/6',
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
            wedding ? 'bg-[#FBEAF0] text-[#8F1D2C]' : 'bg-purple-500/20 text-purple-300',
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
  )
}
