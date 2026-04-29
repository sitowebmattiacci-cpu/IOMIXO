'use client'
import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Plus, Music2, Clock, Trash2, ArrowRight, Search } from 'lucide-react'
import useSWR from 'swr'
import { projects } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatRelativeTime, truncate } from '@/lib/utils'
import toast from 'react-hot-toast'
import type { Project } from '@/types'

export default function ProjectsPage() {
  const [search, setSearch] = useState('')
  const [page,   setPage]   = useState(1)
  const [deleting, setDeleting] = useState<string | null>(null)

  const { data, mutate, isLoading } = useSWR(
    `projects-${page}`,
    () => projects.list(page, 20)
  )

  const filtered = (data?.data ?? []).filter((p: Project) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  )

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this project and all associated files? This cannot be undone.')) return
    setDeleting(id)
    try {
      await projects.delete(id)
      toast.success('Project deleted')
      mutate()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  const statusMap: Record<string, 'processing' | 'complete' | 'failed' | 'queued' | 'default'> = {
    complete:  'complete',
    failed:    'failed',
    queued:    'queued',
    analyzing: 'processing',
    composing: 'processing',
    mastering: 'processing',
    rendering: 'processing',
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Projects</h1>
          <p className="text-sm text-white/40 mt-1">
            {data?.total ?? 0} total projects
          </p>
        </div>
        <Link href="/studio/new">
          <Button icon={<Plus className="h-4 w-4" />} size="sm">New Mashup</Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
          className="input-field pl-10 w-full max-w-sm"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="glass rounded-xl h-16 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-16 text-center">
          <Music2 className="h-10 w-10 text-white/20 mx-auto mb-3" />
          <p className="font-semibold text-white/50">No projects found</p>
          {search && (
            <p className="text-sm text-white/30 mt-1">Try a different search term.</p>
          )}
          {!search && (
            <Link href="/studio/new">
              <Button className="mt-6" icon={<Plus className="h-4 w-4" />}>Create your first mashup</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((project: Project) => {
            const status  = project.latest_job?.status
            const badge   = status ? (statusMap[status] ?? 'processing') : 'default'
            const jobId   = project.latest_job?.id

            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-xl px-5 py-4 flex items-center gap-4 group"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-purple-500/10">
                  <Music2 className="h-5 w-5 text-purple-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white truncate">{truncate(project.title, 45)}</p>
                  <p className="text-xs text-white/30 flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(project.updated_at)}
                    {project.track_a && ` · ${project.track_a.original_filename}`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {status && (
                    <Badge
                      variant={badge as 'processing' | 'complete' | 'failed' | 'queued' | 'default'}
                      pulse={badge === 'processing'}
                    >
                      {status.replace(/_/g, ' ')}
                    </Badge>
                  )}

                  {jobId && (
                    <Link href={`/studio/${jobId}`}>
                      <button className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors opacity-0 group-hover:opacity-100">
                        Open <ArrowRight className="h-3 w-3" />
                      </button>
                    </Link>
                  )}

                  <button
                    onClick={() => handleDelete(project.id)}
                    disabled={deleting === project.id}
                    className="text-white/15 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {data && data.has_more && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={() => setPage(p => p + 1)}>Load more</Button>
        </div>
      )}
    </div>
  )
}
