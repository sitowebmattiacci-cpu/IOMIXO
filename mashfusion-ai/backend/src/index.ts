import 'dotenv/config'
import { app } from './app'
import { logger } from './config/logger'
import { verifySmtpConnection } from './services/mailer'

const PORT = parseInt(process.env.PORT ?? '4000', 10)

process.on('unhandledRejection', (reason) => {
  logger.warn('Unhandled rejection (non-fatal)', { reason: String(reason) })
})

async function bootstrap() {
  // ── Verify SMTP (optional — non-fatal) ─────────────────────
  await verifySmtpConnection()

  // ── Start server ───────────────────────────────────────────
  const server = app.listen(PORT, () => {
    logger.info(`🚀 IOMIXO backend running on port ${PORT}`)
  })

  // ── Graceful shutdown ──────────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`)
    server.close(() => {
      logger.info('Server closed')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', { err })
    process.exit(1)
  })
  process.on('unhandledRejection', (reason: any) => {
    if (process.env.NODE_ENV === 'production') {
      logger.error('Unhandled rejection', { reason }); process.exit(1)
    } else {
      logger.warn('Unhandled rejection (ignored in dev)', { reason })
    }
  })
}

bootstrap()
