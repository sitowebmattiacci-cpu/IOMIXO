import { Response } from 'express'
import Redis from 'ioredis'
import { logger } from '../config/logger'

const REDIS_OPTS = {
  lazyConnect:          true,
  enableOfflineQueue:   false,
  maxRetriesPerRequest: 0,
  retryStrategy:        () => null as null,
}

// Separate Redis subscriber instance (can't use shared connection while subscribed)
const publisher  = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', REDIS_OPTS)
const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', REDIS_OPTS)

// Silence connection errors — SSE/Redis is optional in dev
publisher.on('error',  () => {})
subscriber.on('error', () => {})

// Map<jobId, Set<SSE Response>>
const clients = new Map<string, Set<Response>>()

// ── Subscribe Redis to job channels as needed ───────────────────
subscriber.on('message', (channel: string, message: string) => {
  const jobId = channel.replace('job:', '')
  const sseSet = clients.get(jobId)
  if (!sseSet) return
  for (const res of sseSet) {
    try {
      res.write(`data: ${message}\n\n`)
    } catch {
      sseSet.delete(res)
    }
  }
})

// ── Register an SSE client for a job ──────────────────────────
export function addSseClient(jobId: string, res: Response): void {
  if (!clients.has(jobId)) {
    clients.set(jobId, new Set())
    subscriber.subscribe(`job:${jobId}`, (err) => {
      if (err) logger.error('Redis subscribe error', { jobId, err })
    })
  }
  clients.get(jobId)!.add(res)

  res.on('close', () => {
    const set = clients.get(jobId)
    if (set) {
      set.delete(res)
      if (set.size === 0) {
        clients.delete(jobId)
        subscriber.unsubscribe(`job:${jobId}`)
      }
    }
  })
}

// ── Publish a job update from internal webhook ─────────────────
export async function publishJobUpdate(jobId: string, data: object): Promise<void> {
  try {
    await publisher.publish(`job:${jobId}`, JSON.stringify(data))
  } catch (err) {
    logger.error('Redis publish error', { jobId, err })
  }
}
