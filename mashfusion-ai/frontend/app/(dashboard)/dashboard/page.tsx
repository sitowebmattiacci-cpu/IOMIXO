'use client'
import { useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import useSWR, { mutate } from 'swr'
import { Plus, Zap, Music2, Clock, TrendingUp, ArrowRight, Sparkles } from 'lucide-react'
import { auth, projects, user as userApi } from '@/lib/api'
import { getSupabaseClient } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatRelativeTime, truncate } from '@/lib/utils'
import toast from 'react-hot-toast'
import type { Project, User } from '@/types'

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <Card className="flex items-center gap-4">
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-black text-white">{value}</p>
        <p className="text-xs text-white/40">{label}</p>
      </div>
    </Card>
  )
}

function DashboardContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const { data: me, error: meError } = useSWR<User>('me', () => auth.me())
  const { data: projectList }        = useSWR('projects-recent', () => projects.list(1, 5))
  const { data: credits }            = useSWR('credits', () => userApi.getCredits())

  useEffect(() => {
    if (!meError) return
    // Non redirigere se il backend è temporaneamente down ma la sessione Supabase è valida.
    // L'interceptor axios gestisce già il redirect su 401 (token scaduto/non valido).
    getSupabaseClient().auth.getSession().then(({ data }) => {
      if (!data.session) router.push('/login')
    })
  }, [meError, router])

  // Toast di benvenuto dopo upgrade Stripe
  useEffect(() => {
    if (searchParams.get('upgraded') === 'true') {
      toast.success('🎉 Plan upgraded! Your new credits are ready.')
      mutate('me')
      mutate('credits')
      // Rimuove il query param senza reload
      const url = new URL(window.location.href)
      url.searchParams.delete('upgraded')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams])

  const statusMap: Record<string, 'processing' | 'complete' | 'failed' | 'queued'> = {
    complete:        'complete',
    failed:          'failed',
    queued:          'queued',
    uploading:       'processing',
    analyzing:       'processing',
    separating_stems:'processing',
    harmonizing:     'processing',
    composing:       'processing',
    modernizing:     'processing',
    mastering:       'processing',
    rendering:       'processing',
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">
            Welcome back{me?.full_name ? `, ${me.full_name.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="text-sm text-white/40 mt-1">Your AI music studio awaits</p>
        </div>
        <Link href="/studio/new">
          <Button icon={<Plus className="h-4 w-4" />}>New Mashup</Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Credits remaining"
          value={String(credits?.remaining ?? me?.credits_remaining ?? '—')}
          icon={<Zap className="h-5 w-5 text-amber-400" />}
          color="bg-amber-500/10"
        />
        <StatCard
          label="Total projects"
          value={String(projectList?.total ?? '—')}
          icon={<Music2 className="h-5 w-5 text-purple-400" />}
          color="bg-purple-500/10"
        />
        <StatCard
          label="This month"
          value={String(projectList?.data?.filter(p => {
            const d = new Date(p.created_at)
            const now = new Date()
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
          }).length ?? '—')}
          icon={<TrendingUp className="h-5 w-5 text-green-400" />}
          color="bg-green-500/10"
        />
        <StatCard
          label="Current plan"
          value={me?.plan ? (me.plan.charAt(0).toUpperCase() + me.plan.slice(1)) : '—'}
          icon={<Sparkles className="h-5 w-5 text-pink-400" />}
          color="bg-pink-500/10"
        />
      </div>

      {/* Recent projects */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-bold text-white">Recent Projects</h2>
        <Link href="/projects">
          <button className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 transition-colors">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </Link>
      </div>

      {(!projectList || projectList.data.length === 0) ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass rounded-2xl p-12 text-center"
        >
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-500/10 mb-4">
            <Music2 className="h-8 w-8 text-purple-400" />
          </div>
          <h3 className="font-semibold text-white mb-2">No projects yet</h3>
          <p className="text-sm text-white/40 mb-6">Create your first AI mashup in minutes.</p>
          <Link href="/studio/new">
            <Button icon={<Plus className="h-4 w-4" />}>Create your first mashup</Button>
          </Link>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {projectList.data.map((project: Project) => {
            const jobStatus = project.latest_job?.status
            const badge = statusMap[jobStatus ?? ''] ?? 'default'
            return (
              <Link key={project.id} href={`/studio/${project.latest_job?.id ?? project.id}`}>
                <motion.div
                  whileHover={{ x: 4 }}
                  className="glass glass-hover rounded-xl px-5 py-4 flex items-center gap-4"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-purple-500/10">
                    <Music2 className="h-5 w-5 text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{truncate(project.title, 40)}</p>
                    <p className="text-xs text-white/30 mt-0.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(project.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {jobStatus && (
                      <Badge
                        variant={badge as 'processing' | 'complete' | 'failed' | 'queued'}
                        pulse={badge === 'processing'}
                      >
                        {jobStatus}
                      </Badge>
                    )}
                    <ArrowRight className="h-4 w-4 text-white/20" />
                  </div>
                </motion.div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Quick credits upgrade */}
      {me?.plan === 'free' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 glass rounded-2xl p-6 border border-purple-500/20 flex items-center justify-between gap-4"
        >
          <div>
            <p className="font-semibold text-white">Unlock unlimited creativity</p>
            <p className="text-sm text-white/40 mt-1">Upgrade to Pro for 20 HD mashups/month + WAV export.</p>
          </div>
          <Link href="/billing">
            <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />}>Upgrade</Button>
          </Link>
        </motion.div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" /></div>}>
      <DashboardContent />
    </Suspense>
  )
}
