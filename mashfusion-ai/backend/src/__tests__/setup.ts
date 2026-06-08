/**
 * Jest global setup — stub out external services so tests run in-process
 * without needing Redis, Postgres, SMTP or the AI engine.
 */

// Prevent accidental real DB/SMTP connections in unit tests
process.env.DATABASE_URL       = 'postgresql://test:test@localhost:5432/test_noop'
process.env.NODE_ENV           = 'test'
// No SMTP_HOST → mailer falls into dev-mode (logs, doesn't send)
delete process.env.SMTP_HOST
