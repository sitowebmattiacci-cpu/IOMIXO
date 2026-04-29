import Redis from 'ioredis'
import { logger } from './logger'

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 0,
  enableReadyCheck:     false,
  enableOfflineQueue:   false,
  lazyConnect:          true,
  connectTimeout:       2000,
  retryStrategy:        () => null,
})

let _redisErrorLogged = false
redis.on('error', (err) => {
  if (!_redisErrorLogged) {
    logger.warn('Redis unavailable — queue/SSE features disabled', { code: (err as any).code })
    _redisErrorLogged = true
  }
})
redis.on('connect', () => {
  _redisErrorLogged = false
  logger.info('✓ Redis connected')
})

/** Non-throwing ping — returns true if Redis is reachable. */
export async function pingRedis(): Promise<boolean> {
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2000)
      ),
    ])
    return result === 'PONG'
  } catch {
    return false
  }
}
