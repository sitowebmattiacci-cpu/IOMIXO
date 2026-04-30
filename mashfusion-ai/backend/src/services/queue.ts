import Bull from 'bull'
import Redis from 'ioredis'
import { logger } from '../config/logger'
import axios from 'axios'

export interface MashupJobPayload {
  job_id:                string
  project_id:            string
  user_id:               string
  user_plan:             string   // free | pro | studio — used for priority + WAV gating
  track_a_s3_key:        string
  track_b_s3_key:        string
  remix_style:           string
  output_quality:        string
  remix_prompt?:         string
  remix_director_params?: Record<string, unknown>
  // Preview/Full split
  mode:                  'preview' | 'full'
  preview_duration_sec?: number
  cached_analysis?:      Record<string, unknown> | null
  parent_job_id?:        string
}

// ── Plan priority (lower = dispatched first) ──────────────────
const PLAN_PRIORITY: Record<string, number> = {
  studio: 1,
  pro:    5,
  free:   10,
}

// ── Free user concurrency cap ─────────────────────────────────
// When the gpu_heavy queue has >= N free-plan jobs pending/active,
// additional free-plan jobs get an extra 30-second dispatch delay.
const FREE_CONCURRENCY_CAP = 2

const REDIS_URL  = process.env.REDIS_URL ?? 'redis://localhost:6379'
const REDIS_OPTS = {
  lazyConnect:          true,
  enableOfflineQueue:   false,
  maxRetriesPerRequest: 0,
  retryStrategy:        () => null as null,
}

function makeSilentClient(type: string) {
  const opts = type === 'client'
    ? { ...REDIS_OPTS, maxRetriesPerRequest: 0 as const }
    : { lazyConnect: true, enableReadyCheck: false, enableOfflineQueue: false, maxRetriesPerRequest: null as null, retryStrategy: () => null as null }
  const c = new Redis(REDIS_URL, opts)
  c.on('error', () => {})
  return c
}

// Bull queue — mirrors the Celery gpu_heavy queue name
export const mashupQueue = new Bull<MashupJobPayload>('gpu_heavy', {
  createClient: (type) => makeSilentClient(type),
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail:     30,
  },
})

mashupQueue.on('error', () => {})

/**
 * Count active + waiting free-plan jobs in the Bull queue.
 * Used for throttle decision on free users.
 */
async function countActiveFreeJobs(): Promise<number> {
  try {
    const [active, waiting] = await Promise.all([
      mashupQueue.getActiveCount(),
      mashupQueue.getWaitingCount(),
    ])
    // Rough proxy: assume ~50% of queue are free jobs when we can't inspect data
    // (Bull doesn't expose per-plan counts without scanning jobs)
    return Math.floor((active + waiting) * 0.5)
  } catch {
    return 0
  }
}

/**
 * Dispatch a mashup job to the AI engine.
 *
 * Priority routing:
 *   studio → priority 1  (front of queue)
 *   pro    → priority 5
 *   free   → priority 10 (back of queue, optional delay if cap reached)
 */
export async function queueMashupJob(payload: MashupJobPayload): Promise<void> {
  const priority = PLAN_PRIORITY[payload.user_plan] ?? PLAN_PRIORITY.free
  let   delay    = 0

  // Throttle free users when cap is reached
  if (payload.user_plan === 'free') {
    const activeFree = await countActiveFreeJobs()
    if (activeFree >= FREE_CONCURRENCY_CAP) {
      delay = 30_000  // 30-second defer
      logger.info(`Free user throttle applied for job ${payload.job_id} (active_free≈${activeFree})`)
    }
  }

  try {
    // Preferred path: call AI engine HTTP API directly.
    // The AI engine runs the pipeline synchronously and only responds when the
    // job is complete (Cloud Run scales the instance to zero otherwise). We
    // fire-and-forget the call so the backend can return 202 to the client
    // immediately — pipeline progress is reported back via /internal/job-update
    // webhooks during execution.
    axios
      .post(
        `${process.env.AI_ENGINE_URL}/api/v1/jobs/process`,
        payload,
        {
          headers: { 'X-Internal-API-Key': process.env.AI_ENGINE_API_KEY },
          timeout: 3_600_000,  // 60 min — Cloud Run hard limit
        }
      )
      .then(() => logger.info(`AI engine completed job ${payload.job_id}`))
      .catch((err) => logger.warn(`AI engine call ended with error for job ${payload.job_id}`, { err: err?.message }))

    logger.info(`Job ${payload.job_id} dispatched to AI engine (plan=${payload.user_plan}, priority=${priority})`)
  } catch (engineErr) {
    // Fallback: push to Bull queue (AI engine Celery workers pull from Redis)
    logger.warn('AI engine unreachable, pushing to Bull queue', { err: engineErr })
    try {
      await mashupQueue.add(payload, {
        jobId:    payload.job_id,
        priority,
        delay,
      })
      logger.info(`Job ${payload.job_id} enqueued in Bull (Redis fallback)`)
    } catch (queueErr) {
      // Both AI engine and Redis are unavailable in local/dev environment.
      // The job is already persisted in the DB with status 'queued'; a
      // Celery worker or manual retry will pick it up when infrastructure
      // becomes available.  Do NOT propagate — return 202 to the client.
      logger.warn(`Bull queue unavailable for job ${payload.job_id} — job saved in DB for later pickup`, { err: queueErr })
    }
  }
}

// Bull fallback processor — forwards to AI engine when it becomes reachable
mashupQueue.process(async (job) => {
  const { data } = job
  logger.info(`Processing queued job ${data.job_id} (plan=${data.user_plan})`)
  await axios.post(
    `${process.env.AI_ENGINE_URL}/api/v1/jobs/process`,
    data,
    { headers: { 'X-Internal-API-Key': process.env.AI_ENGINE_API_KEY } }
  )
})

mashupQueue.on('failed', (job, err) => {
  logger.error(`Queue job failed: ${job.id}`, { err })
})
