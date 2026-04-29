import 'dotenv/config'
import { app } from './app'
import { logger } from './config/logger'
import { redis, pingRedis } from './config/redis'
import { startCreditResetScheduler } from './services/creditScheduler'
import { verifySmtpConnection } from './services/mailer'

const PORT = parseInt(process.env.PORT ?? '4000', 10)

// Catch any unhandled promise rejections (e.g. ioredis AggregateError on startup)
// so they don't crash the process — Redis is non-critical in dev.
process.on('unhandledRejection', (reason) => {
  logger.warn('Unhandled rejection (non-fatal)', { reason: String(reason) })
})

async function bootstrap() {
  // ── Verify Redis (optional — non-fatal in dev) ─────────────
  const redisOk = await pingRedis()
  if (redisOk) {
    logger.info('✓ Redis connected')
  } else {
    logger.warn('Redis unavailable — queue/SSE features disabled')
  }

  // ── Verify SMTP (optional — non-fatal) ─────────────────────
  await verifySmtpConnection()

  // ── Start server ───────────────────────────────────────────
  const server = app.listen(PORT, () => {
    logger.info(`🚀 IOMIXO backend running on port ${PORT}`)
    try { startCreditResetScheduler() } catch { /* skip if Redis unavailable */ }
  })

  // ── Graceful shutdown ──────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`)
    server.close(async () => {
      try { redis.disconnect() } catch { /* Redis might already be disconnected */ }
      logger.info('Server closed')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
  process.on('uncaughtException', (err) => {
    // AggregateError from ioredis on connection failure is non-fatal — Redis is optional in dev
    if (err.constructor?.name === 'AggregateError' || (err as any).code === 'ECONNREFUSED') {
      logger.warn('Redis connection error (non-fatal, server continues)', { err: err.message })
      return
    }
    logger.error('Uncaught exception — shutting down', { err })
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    // Redis/queue rejections are non-fatal — log but don't crash
    const msg = String(reason)
    if (msg.includes('ECONNREFUSED') || msg.includes('AggregateError') || msg.includes('redis')) {
      logger.warn('Redis unhandled rejection (non-fatal)', { reason: msg })
      return
    }
    if (process.env.NODE_ENV === 'production') {
      logger.error('Unhandled rejection', { reason }); process.exit(1)
    } else {
      logger.warn('Unhandled rejection (ignored in dev)', { reason })
    }
  })
}

bootstrap()
