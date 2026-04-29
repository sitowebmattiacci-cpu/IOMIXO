'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'
import useSWR from 'swr'
import {
  LayoutDashboard, FolderOpen, CreditCard,
  LogOut, Plus, Sparkles, Zap, Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { auth } from '@/lib/api'
import toast from 'react-hot-toast'
import type { User } from '@/types'

const NAV_ITEMS = [
  { href: '/dashboard',  label: 'Dashboard', icon: LayoutDashboard },
  { href: '/studio/new', label: 'New Mashup',icon: Plus },
  { href: '/projects',   label: 'Projects',  icon: FolderOpen },
  { href: '/billing',    label: 'Billing',   icon: CreditCard },
  { href: '/settings',   label: 'Settings',  icon: Settings },
]

const PLAN_MAX: Record<string, number> = { free: 1, pro: 30, studio: 100 }

export function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()

  const { data: user } = useSWR<User>('me', () => auth.me(), {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
  })

  const handleLogout = async () => {
    await auth.logout()
    toast.success('Signed out')
    router.push('/login')
  }

  const maxCredits = PLAN_MAX[user?.plan ?? 'free'] ?? 1
  const creditPct  = Math.min(100, ((user?.credits_remaining ?? 0) / maxCredits) * 100)

  return (
    <aside className="hidden md:flex flex-col w-64 min-h-screen border-r border-white/6 bg-surface-400">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-white/6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-neon-purple">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-white tracking-tight">IOMIXO</p>
          <p className="text-[10px] text-purple-400 font-medium">AI Studio</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link key={href} href={href}>
              <motion.div
                whileTap={{ scale: 0.98 }}
                className={cn(
                  'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  active
                    ? 'bg-purple-500/15 text-white'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/4'
                )}
              >
                {active && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-purple-400 rounded-r"
                  />
                )}
                <Icon className={cn('h-4 w-4', active ? 'text-purple-400' : '')} />
                {label}
                {href === '/studio/new' && (
                  <span className="ml-auto text-[10px] bg-purple-500/30 text-purple-300 rounded-full px-1.5 py-0.5">
                    New
                  </span>
                )}
              </motion.div>
            </Link>
          )
        })}
      </nav>

      {/* Credits widget */}
      {user && (
        <div className="mx-3 mb-3 glass rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-xs font-semibold text-white/70">Credits</p>
            <span className="ml-auto text-xs font-bold text-amber-400">{user.credits_remaining}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-500"
              style={{ width: `${creditPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-white/25 capitalize">{user.plan} plan</p>
        </div>
      )}

      {/* User + logout */}
      <div className="border-t border-white/6 p-3">
        <div className="flex items-center gap-2.5 rounded-xl p-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-sm font-semibold text-purple-300 overflow-hidden">
            {user?.avatar_url ? (
              <Image src={user.avatar_url} alt="avatar" width={32} height={32} className="object-cover w-full h-full" />
            ) : (
              user?.full_name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{user?.full_name ?? user?.email ?? 'Loading…'}</p>
            <p className="text-[10px] text-white/30 capitalize">{user?.plan ?? ''}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-white/20 hover:text-red-400 transition-colors"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
